import type {Bindings} from "./index";
import {ensureDao} from "./db";
import type {Dao, ApplyRow} from "./db/dao";
import {assertCaAvailable, assertDcvAvailable, caCapabilities, dcvCapability, normalizeDomains} from "./capabilities";
import {readConf} from "./db/conf";
import {seal, unseal, validateSelections} from "./resources";

export interface OrderWork {
    status: "queued" | "running" | "waiting" | "action_required" | "complete" | "failed" | "cancelled";
    updatedAt: number;
    attempts: number;
    nextRun: number;
    startedAt: number;
    revision: string;
    intent: "process" | "verify" | "retry" | "cancel" | "update" | "deploy" | "edit" | "cleanup";
    domains?: string[];
    detail: string;
    errors: number;
    targetId?: string;
    editingUntil?: number;
    reason?: 'timeout';
}

export async function readOrderWork(dao: Dao, uuid: string): Promise<OrderWork | undefined> {
    const raw = await dao.getConf(`ORDER_WORK:${uuid}`);
    try { return raw ? JSON.parse(raw) : undefined; } catch { return undefined; }
}

async function saveWork(dao: Dao, uuid: string, work: OrderWork, supersede = false): Promise<OrderWork | undefined> {
    const name = `ORDER_WORK:${uuid}`;
    if (supersede) {
        await dao.upsertConf(name, JSON.stringify(work), work.updatedAt);
        return work;
    }
    const previous = await dao.getConf(name);
    if (!previous) return undefined;
    const current: OrderWork = JSON.parse(previous);
    if (current.revision !== work.revision) return current;
    if (!dao.updateConfIfUnchanged) throw new Error('Background processing requires conditional persistence');
    if (!await dao.updateConfIfUnchanged(name, previous, JSON.stringify(work), work.updatedAt)) return readOrderWork(dao, uuid);
    return work;
}

export async function queueOrder(env: Bindings, uuid: string, intent: OrderWork["intent"] = "process", domains?: string[], targetId?: string): Promise<OrderWork> {
    const dao = await ensureDao(env);
    if (intent === 'retry') {
        const row = await dao.getApply(uuid);
        if (row?.cert && row.keys && Number(row.flag) === 5) {
            const saved = await seal(env.AUTOMATION_KEY, `ORDER_PREVIOUS:${uuid}`, {certificate: row.cert, privateKey: row.keys, next: String(row.next)});
            await dao.upsertConf(`ORDER_PREVIOUS:${uuid}`, saved, Date.now());
        }
    }
    const work: OrderWork = {status: "queued", updatedAt: Date.now(), attempts: 0, nextRun: Date.now(),
        startedAt: Date.now(), revision: crypto.randomUUID(), intent, domains, targetId, errors: 0,
        detail: intent === "cancel" ? "正在取消申请，原记录将保留" : intent === "update" ? "正在保存更改并重新安排验证" : "已受理，后台处理中"};
    if (intent === 'edit') { work.editingUntil = Date.now() + 10 * 60000; work.detail = '正在编辑，后台处理暂时暂停'; }
    await saveWork(dao, uuid, work, true);
    await wakeOrder(env, uuid);
    return work;
}

async function wakeOrder(env: Bindings, uuid: string) {
    if (env.ORDER_WORKFLOW) {
        const object = env.ORDER_WORKFLOW.get(env.ORDER_WORKFLOW.idFromName(uuid));
        try {
            const response = await object.fetch("https://order.internal/start", {
                method: "POST", body: JSON.stringify({uuid}), signal: AbortSignal.timeout(10000),
            });
            if (!response.ok) console.error("Order scheduling needs recovery", uuid);
        } catch { console.error("Order scheduling needs recovery", uuid); }
    }
}

export async function validatedEdit(env: Bindings, mail: string, payload: any) {
    const dao = await ensureDao(env);
    const domains = normalizeDomains(payload.domains);
    const ca = payload.globals?.ca ?? "lets-encrypt";
    const encryption = payload.globals?.encryption ?? "eccp256";
    if (!["rsa2048", "eccp256", "eccp384"].includes(encryption)) throw new Error("Unsupported certificate key algorithm");
    assertCaAvailable(await caCapabilities((name) => readConf(env, name)), ca, domains.map((domain) => domain.name));
    assertDcvAvailable(await dcvCapability((name) => readConf(env, name)), domains);
    const targetIds = await validateSelections(dao, mail, domains, payload.targetIds, env);
    return {domains, targetIds, globals: {ca, encryption, auto_renew: !!payload.globals?.auto_renew}, subject: payload.subject ?? {}};
}

async function cleanup(env: Bindings, row: ApplyRow) {
    const {cleanupDomainDns} = await import("./certs");
    for (const domain of JSON.parse(row.list || "[]")) {
        if (domain.dnsHandle || domain.legacyRecordId) await cleanupDomainDns(env, row.mail, domain);
    }
}

async function restorePrevious(env: Bindings, dao: Dao, uuid: string) {
    const stored = await dao.getConf(`ORDER_PREVIOUS:${uuid}`);
    if (!stored) return false;
    const previous = await unseal(env.AUTOMATION_KEY, `ORDER_PREVIOUS:${uuid}`, stored);
    await dao.updateApply(uuid, {flag: 5, cert: previous.certificate, keys: previous.privateKey, next: Number(previous.next), text: '处理已停止，原证书和私钥已保留'});
    await dao.deleteConf(`ORDER_PREVIOUS:${uuid}`);
    return true;
}

export async function runOrderStep(env: Bindings, uuid: string,
    advance = async () => (await import("./certs")).processOne(env, uuid, {oneStep: true, throwOnError: true})): Promise<OrderWork | undefined> {
    const dao = await ensureDao(env);
    const work = await readOrderWork(dao, uuid);
    if (!work || ["complete", "cancelled", "failed"].includes(work.status) || work.status === 'action_required' && work.intent !== 'edit') return work;
    if (work.intent === 'edit') {
        if ((work.editingUntil ?? 0) > Date.now()) return saveWork(dao, uuid, {...work, status: 'action_required',
            nextRun: work.editingUntil!, updatedAt: Date.now()});
        work.intent = 'process';
        work.startedAt = Date.now();
    }
    const token = crypto.randomUUID();
    const lease = `ORDER_WORK_LEASE:${uuid}`;
    if (!dao.claimConfLease || !dao.releaseConfLease) throw new Error("Background processing requires atomic order leases");
    if (!await dao.claimConfLease(lease, token, Date.now() + 16 * 60000, Date.now())) return {...work, nextRun: Date.now() + 5000};
    let row: ApplyRow | null = null;
    try {
        row = await dao.getApply(uuid);
        if (!row) return saveWork(dao, uuid, {...work, status: "complete", nextRun: 0, detail: "申请不存在", updatedAt: Date.now()});
        const user = await dao.getUser(row.mail);
        if (!user || Number(user.flag) !== 1) throw new Error("Account is inactive");
        if (work.intent === 'process' && Number(row.flag) < 5 && Date.now() - work.startedAt > 2 * 3600000) {
            const unavailable = JSON.parse(row.list || '[]').some((domain: any) => domain.dnsStatus === 'resolver_unavailable');
            return saveWork(dao, uuid, {...work, status: 'action_required', reason: 'timeout', nextRun: 0, updatedAt: Date.now(),
                detail: unavailable ? '公开 DNS 查询服务持续不可用，自动检查已暂停，可稍后重试' : '自动检查已暂停：长时间未完成，请检查 DNS 解析或 CAA 设置后重试'});
        }
        const started = await saveWork(dao, uuid, {...work, status: "running", updatedAt: Date.now()});
        if (!started || started.revision !== work.revision) return started;
        if (work.intent === "cancel") {
            await cleanup(env, row);
            if (!await restorePrevious(env, dao, uuid)) await dao.updateApply(uuid, {flag: row.cert ? 5 : -1, text: row.cert ? "已停止处理，现有证书已保留" : "申请已取消，记录已保留"});
            await dao.deleteConf(`ORDER_EDIT:${uuid}`);
            return saveWork(dao, uuid, {...work, status: "cancelled", nextRun: 0, detail: "申请已取消，记录已保留", updatedAt: Date.now()});
        }
        if (work.intent === "update") {
            if (Number(row.flag) === 5 || row.cert) throw new Error("The original certificate is already issued; it has been preserved");
            const pending = JSON.parse(await dao.getConf(`ORDER_EDIT:${uuid}`) ?? "null");
            if (!pending || pending.mail !== row.mail) throw new Error("Application update is unavailable");
            const payload = await validatedEdit(env, row.mail, pending.payload);
            await cleanup(env, row);
            await dao.updateApply(uuid, {flag: 0, list: JSON.stringify(payload.domains), main: JSON.stringify(payload.subject),
                sign: payload.globals.ca as any, type: payload.globals.encryption as any, auto: Number(payload.globals.auto_renew),
                data: "", keys: "", text: "申请已更新，后台处理中"});
            await dao.upsertConf(`ORDER_DEPLOYMENT:${uuid}`, JSON.stringify(payload.targetIds), Date.now());
            await dao.deleteConf(`ORDER_EDIT:${uuid}`);
            work.intent = "process";
            row = (await dao.getApply(uuid))!;
        }
        if (work.intent === "retry") {
            await cleanup(env, row);
            await dao.updateApply(uuid, {flag: 0, data: "", list: JSON.stringify(normalizeDomains(JSON.parse(row.list))), text: "已安排后台重试"});
            work.intent = "process";
            row = (await dao.getApply(uuid))!;
        }
        if (Number(row.flag) < 0) return saveWork(dao, uuid, {...work, status: "failed", nextRun: 0, detail: row.text || "处理失败", updatedAt: Date.now()});
        if (Number(row.flag) === 5) {
            if (work.intent === "deploy") {
                const {pushSelectedOrder, deploymentStates} = await import("./deployment");
                await pushSelectedOrder(env, row, {targetId: work.targetId, manual: !!work.targetId});
                const states = (await deploymentStates(dao, uuid)).filter((state) => !work.targetId || state.targetId === work.targetId);
                const pending = states.filter((state) => state.status !== "ok" && state.attempts < 3);
                if (pending.length) return saveWork(dao, uuid, {...work, status: "waiting", intent: "deploy", updatedAt: Date.now(),
                    detail: "证书已签发，正在后台部署", nextRun: Math.max(Date.now() + 1000, Math.min(...pending.map((state) => state.nextAttempt || Date.now())))});
            }
            const domains = JSON.parse(row.list || '[]');
            if (domains.some((domain: any) => domain.dnsStatus === 'cleanup_pending')) {
                work.intent = 'cleanup';
                const {cleanupDomainDns} = await import('./certs');
                let count = 0;
                for (const domain of domains) {
                    if (domain.dnsStatus !== 'cleanup_pending' || count++ >= 8) continue;
                    try { await cleanupDomainDns(env, row.mail, domain); } catch {}
                }
                const next = JSON.stringify(domains);
                if (next !== row.list) {
                    if (!dao.updateApplyListIfUnchanged || !await dao.updateApplyListIfUnchanged(uuid, row.list, next)) {
                        return saveWork(dao, uuid, {...work, status: 'waiting', detail: '正在同步验证记录清理状态', nextRun: Date.now() + 5000, updatedAt: Date.now()});
                    }
                }
                if (domains.some((domain: any) => domain.dnsStatus === 'cleanup_pending')) {
                    const attempts = work.attempts + 1;
                    return saveWork(dao, uuid, {...work, attempts, status: attempts < 5 ? 'waiting' : 'action_required',
                        detail: attempts < 5 ? '证书已签发，正在重试清理验证记录' : '证书已签发，验证记录清理未完成，请检查 DNS 账户授权',
                        nextRun: attempts < 5 ? Date.now() + Math.min(300000, 10000 * 2 ** attempts) : 0, updatedAt: Date.now()});
                }
            }
            return saveWork(dao, uuid, {...work, status: "complete", nextRun: 0, detail: "证书已签发", updatedAt: Date.now()});
        }
        if (work.intent === "verify" && Number(row.flag) === 2) {
            await (await import("./certs")).opDomain(env, user, row, work.domains?.length ? work.domains : ["all"]);
            work.intent = "process";
        } else await advance();
        const latestWork = await readOrderWork(dao, uuid);
        if (latestWork?.revision !== work.revision) return latestWork;
        const fresh = (await dao.getApply(uuid))!;
        if (Number(fresh.flag) === 5) {
            await dao.deleteConf(`ORDER_PREVIOUS:${uuid}`);
            const states = await (await import("./deployment")).deploymentStates(dao, uuid);
            if (states.some((state) => state.status !== "ok" && state.attempts < 3)) return saveWork(dao, uuid, {...work,
                intent: "deploy", status: "waiting", detail: "证书已签发，正在后台部署", nextRun: Date.now() + 1000, updatedAt: Date.now()});
            if (JSON.parse(fresh.list || '[]').some((domain: any) => domain.dnsStatus === 'cleanup_pending')) return saveWork(dao, uuid, {...work,
                intent: 'cleanup', status: 'waiting', attempts: 0, detail: '证书已签发，正在清理验证记录', nextRun: Date.now() + 1000, updatedAt: Date.now()});
        }
        const domains = JSON.parse(fresh.list || "[]");
        if (domains.some((domain: any) => domain.dnsStatus === 'access_denied')) {
            await dao.updateApply(uuid, {flag: -1, text: 'DNS 账户授权已失效，请检查账户或选择其他账户'});
            return saveWork(dao, uuid, {...work, status: 'failed', nextRun: 0, updatedAt: Date.now(), detail: 'DNS 账户授权已失效，请检查账户或选择其他账户'});
        }
        const providerFailure = domains.some((domain: any) => domain.dnsStatus === 'provider_failed');
        const resolverUnavailable = domains.some((domain: any) => domain.dnsStatus === 'resolver_unavailable');
        if (providerFailure && domains.some((domain: any) => Number(domain.dnsAttempts) >= 4)) {
            await dao.updateApply(uuid, {flag: -1, text: 'DNS 记录写入连续失败，请检查账户权限后重试'});
            return saveWork(dao, uuid, {...work, status: 'failed', nextRun: 0, updatedAt: Date.now(), detail: 'DNS 记录写入连续失败，请检查账户权限后重试'});
        }
        const manual = domains.some((domain: any) => !["dns-api", "dns-auto"].includes(domain.type) && Number(domain.flag ?? 0) < 3);
        const automatedPending = domains.some((domain: any) => ["dns-api", "dns-auto"].includes(domain.type) && Number(domain.flag ?? 0) < 3);
        const needsCname = domains.some((domain: any) => domain.dnsStatus === "waiting_delegation");
        const status: OrderWork["status"] = Number(fresh.flag) === 5 ? "complete" : Number(fresh.flag) < 0 ? "failed"
            : Number(fresh.flag) === 2 && (needsCname || manual && !automatedPending) ? "action_required" : "waiting";
        const detail = status === "complete" ? "证书已签发" : status === "failed" ? fresh.text || "验证失败"
            : status === "action_required" ? needsCname ? "等待首次配置 CNAME 委派记录" : "等待添加验证记录"
                : providerFailure ? 'DNS 记录写入失败，后台将重试' : resolverUnavailable ? '公开 DNS 查询暂不可用，后台将自动重试'
                    : Number(fresh.flag) <= 1 ? "正在准备验证记录" : Number(fresh.flag) === 2 ? "等待 DNS 记录生效，将自动复查"
                    : Number(fresh.flag) === 3 ? "签发机构正在验证域名" : "正在签发证书";
        const attempts = Number(fresh.flag) !== Number(row.flag) ? 0 : work.attempts + 1;
        return saveWork(dao, uuid, {...work, status, detail, attempts, errors: 0, updatedAt: Date.now(),
            nextRun: status === "waiting" ? Date.now() + (attempts ? Math.min(60000, 5000 * 2 ** Math.min(attempts, 4)) : 1000) : 0});
    } catch (error) {
        const latestWork = await readOrderWork(dao, uuid);
        if (latestWork?.revision !== work.revision) return latestWork;
        const errors = work.errors + 1;
        const reason = String((error as Error).message || "Processing failed").slice(0, 500);
        const retry = errors < 4 && !/Account is inactive|outside.*scope|grant.*revoked|Unsupported|already issued|Application update is unavailable|expired.*EAB/i.test(reason);
        if (row && Number(row.flag) !== 5 && !['update', 'deploy', 'cleanup'].includes(work.intent)) {
            const restored = !retry && await restorePrevious(env, dao, uuid);
            if (!restored) await dao.updateApply(uuid, {flag: retry ? Number(row.flag) : -1,
                text: retry ? "暂时无法完成当前步骤，后台将自动重试" : reason});
        }
        return saveWork(dao, uuid, {...work, status: retry ? "waiting" : "failed", errors, updatedAt: Date.now(),
            nextRun: retry ? Date.now() + 10000 * 2 ** errors : 0,
            detail: retry ? "连接暂时异常，后台将自动重试" : reason});
    } finally { await dao.releaseConfLease(lease, token); }
}

export async function resumePendingOrders(env: Bindings) {
    const dao = await ensureDao(env);
    if (env.DB_CF && env.ORDER_WORKFLOW) {
        const due = await env.DB_CF.prepare("SELECT name FROM Confs WHERE name GLOB 'ORDER_WORK:*' AND json_valid(data) AND json_extract(data,'$.nextRun') > 0 AND json_extract(data,'$.nextRun') <= ? AND json_extract(data,'$.status') IN ('queued','waiting') ORDER BY json_extract(data,'$.nextRun') LIMIT 8")
            .bind(Date.now()).all<{name: string}>();
        const orphaned = await env.DB_CF.prepare("SELECT a.uuid FROM Apply a LEFT JOIN Confs c ON c.name = 'ORDER_WORK:' || a.uuid WHERE (a.flag BETWEEN 0 AND 4 AND c.name IS NULL) OR (a.flag=5 AND (c.name IS NULL OR json_extract(c.data,'$.status')='complete') AND EXISTS (SELECT 1 FROM json_each(a.list) d WHERE json_extract(d.value,'$.dnsStatus')='cleanup_pending')) ORDER BY a.time LIMIT 8")
            .all<{uuid: string}>();
        for (const item of due.results) await wakeOrder(env, item.name.slice("ORDER_WORK:".length));
        for (const item of orphaned.results) await queueOrder(env, item.uuid);
        return [...due.results, ...orphaned.results];
    }
    const {rows} = await dao.listApplies({gte: {flag: 0}, lte: {flag: 4}}, {page: 1, pageSize: 50, orderBy: "time", orderDesc: false});
    const results = [];
    for (const row of rows) {
        const work = await readOrderWork(dao, row.uuid);
        if (work && (work.nextRun > Date.now() || ["action_required", "failed", "cancelled"].includes(work.status))) continue;
        if (env.ORDER_WORKFLOW) { await wakeOrder(env, row.uuid); results.push(row.uuid); }
        else {
            if (!work) await queueOrder(env, row.uuid);
            results.push(await runOrderStep(env, row.uuid));
        }
    }
    return results;
}

export class CertificateWorkflow {
    constructor(protected state: DurableObjectState, protected env: Bindings) {}

    protected async advance(uuid: string) {
        return (await import('./certs')).processOne(this.env, uuid, {oneStep: true, throwOnError: true});
    }

    async fetch(request: Request) {
        if (request.method !== "POST") return new Response("Not found", {status: 404});
        const {uuid} = await request.json() as {uuid: string};
        if (typeof uuid !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(uuid)) return new Response("Invalid request", {status: 400});
        await this.state.storage.put("uuid", uuid);
        await this.state.storage.setAlarm(Date.now() + 100);
        return Response.json({accepted: true}, {status: 202});
    }

    async alarm() {
        try {
        const uuid = await this.state.storage.get<string>("uuid");
        if (!uuid) return;
        const work = await runOrderStep(this.env, uuid, () => this.advance(uuid));
        if (work?.nextRun) await this.state.storage.setAlarm(work.nextRun);
        else await this.state.storage.deleteAlarm();
        } catch {
            console.error('Background order scheduling will retry');
            await this.state.storage.setAlarm(Date.now() + 60000);
        }
    }
}

export async function deleteSavedOrder(env: Bindings, uuid: string, mail: string, confirmation: string) {
    if (confirmation !== uuid) throw new Error('请输入完整订单 ID 以确认');
    const dao = await ensureDao(env);
    const row = await dao.getApply(uuid);
    if (!row || row.mail.toLowerCase() !== mail.toLowerCase()) throw new Error('申请不存在或无权删除');
    if (!dao.claimConfLease || !dao.releaseConfLease) throw new Error('Order locking is unavailable');
    const lease = `ORDER_WORK_LEASE:${uuid}`;
    const token = crypto.randomUUID();
    if (!await dao.claimConfLease(lease, token, Date.now() + 120000, Date.now())) throw new Error('申请正在执行，请稍后再删除');
    try {
        const records = await dao.listConfs();
        if (records.some((record) => record.name.startsWith(`DEPLOY_LEASE:${uuid}:`) && Number(record.time) > Date.now())) {
            throw new Error('部署正在执行，请稍后再删除');
        }
        await cleanup(env, row);
        const keys = new Set([`ORDER_WORK:${uuid}`, `ORDER_EDIT:${uuid}`, `ORDER_DEPLOYMENT:${uuid}`,
            `ORDER_PREVIOUS:${uuid}`, `LEGO_STATE:${uuid}`]);
        const prefixes = [`DEPLOY_STATE:${uuid}:`, `DEPLOY_LEASE:${uuid}:`, `CLOUD_CERT:${uuid}:`];
        for (const record of records) {
            if (keys.has(record.name) || prefixes.some((prefix) => record.name.startsWith(prefix))) await dao.deleteConf(record.name);
        }
        const log = JSON.parse(await dao.getConf('AUTO_LOG') ?? '[]');
        if (Array.isArray(log) && log.some((item: any) => item.order === uuid)) await dao.upsertConf('AUTO_LOG', JSON.stringify(log.filter((item: any) => item.order !== uuid)), Date.now());
        const legacy = JSON.parse(await dao.getConf('EDGE_STATE') ?? '{}');
        if (legacy[uuid]) { delete legacy[uuid]; await dao.upsertConf('EDGE_STATE', JSON.stringify(legacy), Date.now()); }
        await dao.deleteApply(uuid);
    } finally { await dao.releaseConfLease(lease, token); }
}