/**
 * Edge certificate deployment.
 * -------------------------------------------------------------------------
 * Pushes an issued certificate to edge platforms that terminate TLS with a
 * user-managed certificate:
 *
 *   edgeone  腾讯云 EdgeOne   —— 上传证书到 SSL 控制台 + ModifyHostsCertificate
 *   esa      阿里云 ESA       —— SetCertificate(type=upload)
 *
 * Design notes:
 *   - Targets live in the Confs key `EDGE_TARGETS` so they can be edited from
 *     the admin console without redeploying the Worker.
 *   - Deploy results are cached in `EDGE_STATE` keyed by order uuid + target id,
 *     together with a hash of the certificate. A re-run therefore only touches
 *     the platform when the certificate actually changed or the last attempt
 *     failed.
 *   - Every attempt is appended to the `AUTO_LOG` ring buffer for the console.
 */

import type {Bindings} from "../index";
import {readConf, writeConf} from "../db/conf";
import {esaCall} from "./aliyun";
import {sha256Hex, sslCall, teoCall} from "./tencent";

export type EdgeTargetType = "edgeone" | "esa";

export interface EdgeOneConfig {
    /** 腾讯云 SecretId */
    secret_id: string;
    /** 腾讯云 SecretKey */
    secret_key: string;
    /** 接口地域，一般留空 */
    region?: string;
    /** 站点 ID，留空则按证书域名自动匹配 */
    zone_id?: string;
    /** 加速域名，留空则在站点内按证书域名自动匹配 */
    hosts?: string[];
    /** 上传到 SSL 控制台时的备注名前缀 */
    alias?: string;
}

export interface EsaConfig {
    /** 阿里云 AccessKeyId */
    access_key_id: string;
    /** 阿里云 AccessKeySecret */
    access_key_secret: string;
    /** 接口域名，默认 esa.aliyuncs.com */
    endpoint?: string;
    /** 站点 ID，留空则按证书域名自动匹配 */
    site_id?: string;
    /** 证书名称前缀 */
    cert_name?: string;
}

export interface EdgeTarget {
    id: string;
    type: EdgeTargetType;
    name: string;
    /** 是否启用 */
    enabled: boolean;
    /** 证书签发/续期后是否自动下发 */
    auto: boolean;
    /** 域名匹配规则；为空表示匹配全部订单 */
    domains: string[];
    edgeone?: EdgeOneConfig;
    esa?: EsaConfig;
    last_run?: number;
    last_status?: string;
    last_detail?: string;
}

export interface PushResult {
    targetId: string;
    targetName: string;
    type: EdgeTargetType;
    status: "ok" | "skip" | "fail";
    detail: string;
    hosts?: string[];
    certId?: string;
}

export interface AutoLogEntry {
    t: number;
    kind: string;
    target?: string;
    order?: string;
    status: string;
    detail: string;
}

const TARGETS_KEY = "EDGE_TARGETS";
const STATE_KEY = "EDGE_STATE";
const LOG_KEY = "AUTO_LOG";
const MAX_STATE_ORDERS = 200;
const MAX_LOG = 120;

/* ============================ 配置读写 ============================ */

export function newId(prefix: string): string {
    const buf = new Uint8Array(6);
    crypto.getRandomValues(buf);
    let s = "";
    for (const b of buf) s += "0123456789abcdefghijklmnopqrstuvwxyz"[b % 36];
    return `${prefix}_${s}`;
}

export async function readTargets(env: Bindings): Promise<EdgeTarget[]> {
    const raw = await readConf(env as any, TARGETS_KEY);
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed as EdgeTarget[] : [];
    } catch {
        return [];
    }
}

export async function writeTargets(env: Bindings, targets: EdgeTarget[]): Promise<void> {
    await writeConf(env as any, TARGETS_KEY, JSON.stringify(targets));
}

/** 读取某订单的下发状态表 */
async function readState(env: Bindings): Promise<Record<string, Record<string, any>>> {
    const raw = await readConf(env as any, STATE_KEY);
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

async function writeState(
    env: Bindings, state: Record<string, Record<string, any>>,
): Promise<void> {
    const uuids = Object.keys(state);
    if (uuids.length > MAX_STATE_ORDERS) {
        uuids.sort((a, b) => {
            const ta = Math.max(0, ...Object.values(state[a]).map((v: any) => Number(v?.t ?? 0)));
            const tb = Math.max(0, ...Object.values(state[b]).map((v: any) => Number(v?.t ?? 0)));
            return ta - tb;
        });
        for (const uuid of uuids.slice(0, uuids.length - MAX_STATE_ORDERS)) delete state[uuid];
    }
    await writeConf(env as any, STATE_KEY, JSON.stringify(state));
}

/** 读取某订单在指定目标上的最近一次下发状态 */
export async function readOrderEdgeState(
    env: Bindings, orderUuid: string,
): Promise<Record<string, any>> {
    const state = await readState(env);
    return state[orderUuid] ?? {};
}

export async function appendLog(env: Bindings, entry: AutoLogEntry): Promise<void> {
    let list: AutoLogEntry[] = [];
    const raw = await readConf(env as any, LOG_KEY);
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) list = parsed as AutoLogEntry[];
        } catch {/* ignore */}
    }
    list.unshift(entry);
    if (list.length > MAX_LOG) list = list.slice(0, MAX_LOG);
    await writeConf(env as any, LOG_KEY, JSON.stringify(list));
}

export async function readLog(env: Bindings): Promise<AutoLogEntry[]> {
    const raw = await readConf(env as any, LOG_KEY);
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed as AutoLogEntry[] : [];
    } catch {
        return [];
    }
}

/* ============================ 域名匹配 ============================ */

/** 单条规则的匹配：支持精确、*.example.com、.example.com 与 * */
export function domainMatches(pattern: string, domain: string): boolean {
    const p = String(pattern ?? "").trim().toLowerCase();
    const d = String(domain ?? "").trim().toLowerCase();
    if (!p || !d) return false;
    if (p === "*") return true;
    if (p.startsWith("*.")) {
        const base = p.slice(2);
        return d === base || d.endsWith("." + base);
    }
    if (p.startsWith(".")) return d.endsWith(p);
    return d === p;
}

/** 目标是否适用于该订单（规则为空 = 全部适用） */
export function targetMatchesDomains(target: EdgeTarget, domains: string[]): boolean {
    const rules = (target.domains ?? []).filter((r) => String(r ?? "").trim().length > 0);
    if (rules.length === 0) return true;
    return rules.some((rule) => domains.some((d) => domainMatches(rule, d)));
}

/** 从订单 list 字段解析证书覆盖的域名 */
export function orderDomains(order: any): string[] {
    try {
        const list = JSON.parse(order?.list ?? "[]");
        if (!Array.isArray(list)) return [];
        return list
            .map((it: any) => String(it?.name ?? "").trim().toLowerCase())
            .filter(Boolean);
    } catch {
        return [];
    }
}

/** 去掉通配前缀后的可注册域名 */
function baseDomain(domain: string): string {
    return domain.replace(/^\*\./, "").trim().toLowerCase();
}

/* ============================ 目标下发 ============================ */

interface DeployContext {
    hostAllowed?: (host: string) => boolean;
    order: any;
    uuid: string;
    domains: string[];
    cert: string;
    key: string;
}

/** 腾讯云 EdgeOne：上传证书 + 部署到加速域名 */
async function deployEdgeOne(
    env: Bindings, target: EdgeTarget, ctx: DeployContext, hash: string,
): Promise<{certId?: string; hosts: string[]; detail: string}> {
    const cfg = target.edgeone ?? {secret_id: "", secret_key: ""};
    const cred = {secretId: cfg.secret_id, secretKey: cfg.secret_key, region: cfg.region};

    // 1) 站点 ID ------------------------------------------------------------
    let zoneId = String(cfg.zone_id ?? "").trim();
    if (!zoneId) {
        const candidates = Array.from(new Set(ctx.domains.map(baseDomain).filter(Boolean)));
        const zones: any[] = [];
        for (const name of candidates) {
            const res = await teoCall(cred, "DescribeZones", {
                Offset: 0, Limit: 100,
                Filters: [{Name: "zone-name", Values: [name]}],
            });
            if (Array.isArray(res?.Zones)) zones.push(...res.Zones);
        }
        const hit = zones.find((z) => candidates.includes(String(z?.ZoneName ?? "").toLowerCase()))
            ?? zones[0];
        if (!hit?.ZoneId) {
            throw new Error(
                "未能在 EdgeOne 中找到匹配的站点，请在目标配置里手动填写 ZoneId（证书域名: " +
                candidates.join(", ") + "）");
        }
        zoneId = String(hit.ZoneId);
    }

    // 2) 加速域名 -----------------------------------------------------------
    let hosts = (cfg.hosts ?? []).map((h) => String(h).trim().toLowerCase()).filter(Boolean);
    if (hosts.length === 0) {
        const res = await teoCall(cred, "DescribeAccelerationDomains", {
            ZoneId: zoneId, Offset: 0, Limit: 200,
        });
        const all: any[] = Array.isArray(res?.AccelerationDomains) ? res.AccelerationDomains : [];
        hosts = all
            .map((d) => String(d?.DomainName ?? "").trim().toLowerCase())
            .filter((name) => name && ctx.domains.some((d) => domainMatches(d, name)) && (!ctx.hostAllowed || ctx.hostAllowed(name)));
    }
    if (hosts.length === 0) {
        throw new Error("站点下没有与证书域名匹配的加速域名，请先接入加速域名或手动指定 hosts");
    }
    if (ctx.hostAllowed && hosts.some((host) => !ctx.hostAllowed!(host))) throw new Error("EdgeOne host is not covered by the selected certificate");

    // 3) 上传证书 -----------------------------------------------------------
    const alias = `${cfg.alias || "certhub"}-${hash.slice(0, 8)}`;
    const uploaded = await sslCall(cred, "UploadCertificate", {
        CertificatePublicKey: ctx.cert,
        CertificatePrivateKey: ctx.key,
        CertificateType: "SVR",
        Alias: alias,
        Repeatable: false,
    });
    const certId = String(uploaded?.CertificateId || uploaded?.RepeatCertId || "");
    if (!certId) throw new Error("腾讯云未返回 CertId");

    // 4) 部署到加速域名 -----------------------------------------------------
    await teoCall(cred, "ModifyHostsCertificate", {
        ZoneId: zoneId,
        Hosts: hosts,
        Mode: "sslcert",
        ServerCertInfo: [{CertId: certId}],
    });
    return {
        certId, hosts,
        detail: `站点 ${zoneId}，已部署 ${hosts.length} 个加速域名（CertId ${certId}）`,
    };
}

/** 阿里云 ESA：上传自定义边缘证书 */
async function deployEsa(
    env: Bindings, target: EdgeTarget, ctx: DeployContext, hash: string,
): Promise<{certId?: string; hosts: string[]; detail: string}> {
    const cfg = target.esa ?? {access_key_id: "", access_key_secret: ""};
    const cred = {
        accessKeyId: cfg.access_key_id,
        accessKeySecret: cfg.access_key_secret,
        endpoint: cfg.endpoint,
    };

    // 1) 站点 ID ------------------------------------------------------------
    let siteId = String(cfg.site_id ?? "").trim();
    if (!siteId) {
        const candidates = Array.from(new Set(ctx.domains.map(baseDomain).filter(Boolean)));
        const res = await esaCall(cred, {
            action: "ListSites", version: "2024-09-10",
            params: {PageNumber: 1, PageSize: 200},
        });
        const sites: any[] = Array.isArray(res?.Sites) ? res.Sites : [];
        const hit = sites.find((s) => {
            const name = String(s?.SiteName ?? "").toLowerCase();
            return candidates.some((c) => c === name || c.endsWith("." + name));
        });
        if (!hit?.SiteId) {
            throw new Error(
                "未能在 ESA 中找到匹配的站点，请在目标配置里手动填写 SiteId（证书域名: " +
                candidates.join(", ") + "）");
        }
        siteId = String(hit.SiteId);
    }

    // 2) 上传自定义证书 -----------------------------------------------------
    const certName = `${cfg.cert_name || "certhub"}-${ctx.uuid}-${hash.slice(0, 8)}`;
    try {
        const res = await esaCall(cred, {
            action: "SetCertificate", version: "2024-09-10",
            params: {
                SiteId: siteId,
                Type: "upload",
                Name: certName,
                Certificate: ctx.cert,
                PrivateKey: ctx.key,
            },
        });
        const certId = String(res?.Id ?? "");
        return {
            certId,
            hosts: [],
            detail: `站点 ${siteId}，已上传边缘证书 ${certName}`,
        };
    } catch (e: any) {
        const msg = String(e?.message ?? e);
        // 同一张证书重复上传时按成功处理，保证幂等
        if (msg.includes("Certificate.Duplicated")) {
            return {hosts: [], detail: `站点 ${siteId}，同名证书已存在（${certName}）`};
        }
        throw e;
    }
}

export async function deployTarget(
    env: Bindings, target: EdgeTarget, ctx: DeployContext, hash: string,
): Promise<{certId?: string; hosts: string[]; detail: string}> {
    if (target.type === "edgeone") return await deployEdgeOne(env, target, ctx, hash);
    if (target.type === "esa") return await deployEsa(env, target, ctx, hash);
    throw new Error(`未知的下发目标类型: ${(target as any).type}`);
}

/* ============================ 对外入口 ============================ */

export interface PushOptions {
    /** 只处理指定目标 */
    targetId?: string;
    /** 忽略状态缓存强制下发 */
    force?: boolean;
    /** 忽略目标的 auto 开关（手动下发时使用） */
    manual?: boolean;
}

/**
 * 把某个订单的证书下发到所有匹配的目标。
 * 只处理已签发（flag=5）且证书完整的订单。
 */
export async function pushOrder(
    env: Bindings, order: any, options: PushOptions = {},
): Promise<PushResult[]> {
    const results: PushResult[] = [];
    const uuid = String(order?.uuid ?? "");
    if (!uuid) return results;
    if (Number(order?.flag) !== 5 || !order?.cert || !order?.keys) {
        return [{
            targetId: "-", targetName: "-", type: "esa", status: "skip",
            detail: "订单尚未签发证书，跳过下发",
        }];
    }

    const targets = await readTargets(env);
    if (targets.length === 0) return results;

    const domains = orderDomains(order);
    const hash = (await sha256Hex(String(order.cert) + String(order.keys))).slice(0, 32);
    const state = await readState(env);
    const orderState: Record<string, any> = state[uuid] ?? {};

    for (const target of targets) {
        if (options.targetId && target.id !== options.targetId) continue;
        if (!target.enabled) continue;
        if (!options.manual && !target.auto) continue;
        if (!targetMatchesDomains(target, domains)) continue;

        const prev = orderState[target.id];
        if (!options.force && prev && prev.h === hash && prev.s === "ok") {
            results.push({
                targetId: target.id, targetName: target.name, type: target.type,
                status: "skip", detail: "证书未变化，无需重复下发",
            });
            continue;
        }

        const ctx: DeployContext = {
            order, uuid, domains,
            cert: String(order.cert), key: String(order.keys),
        };
        try {
            const out = await deployTarget(env, target, ctx, hash);
            orderState[target.id] = {
                h: hash, s: "ok", t: Date.now(), d: out.detail, cert: out.certId ?? "",
            };
            results.push({
                targetId: target.id, targetName: target.name, type: target.type,
                status: "ok", detail: out.detail, hosts: out.hosts, certId: out.certId,
            });
        } catch (e: any) {
            const msg = String(e?.message ?? e);
            orderState[target.id] = {
                h: hash, s: "fail", t: Date.now(), d: msg,
            };
            results.push({
                targetId: target.id, targetName: target.name, type: target.type,
                status: "fail", detail: msg,
            });
        }
        // 目标级时间戳，便于控制台展示
        target.last_run = Date.now();
        const last = results[results.length - 1];
        target.last_status = last.status;
        target.last_detail = last.detail;
    }

    state[uuid] = orderState;
    await writeState(env, state);
    await writeTargets(env, targets);
    for (const r of results) {
        if (r.status === "skip") continue;
        await appendLog(env, {
            t: Date.now(), kind: "edge-push", target: r.targetName, order: uuid,
            status: r.status, detail: r.detail,
        });
    }
    return results;
}

/**
 * 补下发：扫描所有已签发订单，把缺失或失败的边缘证书补上。
 * 用于触发器定时任务与手动"立即下发"。
 */
export async function syncEdgeCertificates(
    env: Bindings, options: {targetId?: string; force?: boolean; limit?: number} = {},
): Promise<{checked: number; pushed: number; results: PushResult[]}> {
    const targets = await readTargets(env);
    const active = targets.filter(
        (t) => t.enabled && (options.targetId ? t.id === options.targetId : t.auto));
    if (active.length === 0) {
        return {checked: 0, pushed: 0, results: []};
    }

    const {ensureDao} = await import("../db");
    const dao = await ensureDao(env as any);
    const {rows} = await dao.listApplies(
        {eq: {flag: 5}}, {page: 1, pageSize: options.limit ?? 100, orderBy: "time", orderDesc: true});

    const state = await readState(env);
    const results: PushResult[] = [];
    let pushed = 0;
    for (const row of rows) {
        const orderState = state[row.uuid] ?? {};
        const hash = (await sha256Hex(String(row.cert ?? "") + String(row.keys ?? ""))).slice(0, 32);
        const pending = active.some((t) => {
            const prev = orderState[t.id];
            return !prev || prev.h !== hash || prev.s !== "ok";
        });
        if (!pending && !options.force) continue;
        const res = await pushOrder(env, row, {
            targetId: options.targetId, force: options.force,
        });
        for (const r of res) if (r.status === "ok") pushed += 1;
        results.push(...res);
    }
    return {checked: rows.length, pushed, results};
}

/**
 * 探测目标连通性：验证凭据可用并返回可发现的资源，不修改任何线上配置。
 */
export async function testTarget(target: EdgeTarget): Promise<string> {
    if (target.type === "edgeone") {
        const cfg = target.edgeone ?? {secret_id: "", secret_key: ""};
        const res = await teoCall(
            {secretId: cfg.secret_id, secretKey: cfg.secret_key, region: cfg.region},
            "DescribeZones", {Offset: 0, Limit: 20});
        const zones: any[] = Array.isArray(res?.Zones) ? res.Zones : [];
        return `连接成功，可见站点 ${zones.length} 个` +
            (zones.length ? `：${zones.slice(0, 5).map((z) => z.ZoneName).join(", ")}` : "");
    }
    if (target.type === "esa") {
        const cfg = target.esa ?? {access_key_id: "", access_key_secret: ""};
        const res = await esaCall(
            {
                accessKeyId: cfg.access_key_id,
                accessKeySecret: cfg.access_key_secret,
                endpoint: cfg.endpoint,
            },
            {action: "ListSites", version: "2024-09-10", params: {PageNumber: 1, PageSize: 20}});
        const sites: any[] = Array.isArray(res?.Sites) ? res.Sites : [];
        return `连接成功，可见站点 ${res?.TotalCount ?? sites.length} 个` +
            (sites.length ? `：${sites.slice(0, 5).map((s) => s.SiteName).join(", ")}` : "");
    }
    throw new Error(`未知的下发目标类型: ${(target as any).type}`);
}
