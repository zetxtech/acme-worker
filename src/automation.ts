/**
 * Automation: job runner, trigger endpoints and the scheduled handler.
 * -------------------------------------------------------------------------
 * The Worker exposes every automation job through three entry points that all
 * funnel into `runJobs`:
 *
 *   1. HTTP trigger   GET/POST /trigger/:name?token=...   （访问即执行，等同于 cron）
 *   2. Cloudflare cron `scheduled()`                      （若账号仍有 cron 配额）
 *   3. Admin console  POST /admin/automation/triggers/:id/run
 *
 * Trigger definitions live in the Confs key `TRIGGERS`, so arbitrary endpoints
 * (name + token + which jobs to run) can be created at runtime without a
 * redeploy. Because Cloudflare's free plan only allows 5 cron triggers per
 * account, the HTTP endpoint is the recommended scheduling surface: point any
 * external scheduler (Uptime monitor, GitHub Actions, cron-job.org, ...) at it.
 */

import type {Bindings} from "./index";
import {readConf, readInt, readBool, writeConf} from "./db/conf";
import * as certs from "./certs";
import * as saves from "./saves";
import {cleanDNS} from "./query";
import {appendLog, newId, pushOrder, syncEdgeCertificates} from "./edge";

/* ============================ 任务定义 ============================ */

export interface JobDef {
    id: string;
    title: string;
    desc: string;
}

export const JOBS: JobDef[] = [
    {
        id: "cron",
        title: "模拟 Cloudflare 定时触发",
        desc: "完全等同于 Cloudflare cron 触发：按「自动任务」里配置的任务与最小间隔执行，" +
            "受开关与节流控制；调用时带 force=1 可忽略节流立即执行。",
    },
    {
        id: "process",
        title: "推进证书订单",
        desc: "按状态机推进所有未完成的订单（创建订单 / 写入 DNS / 完成验证 / 签发证书）。",
    },
    {
        id: "renew",
        title: "自动续期",
        desc: "扫描已开启自动续期、且临近到期的证书并重新签发。",
    },
    {
        id: "deploy",
        title: "部署目标同步",
        desc: "重试订单已选择的部署目标。",
    },
    {
        id: "clean-dns",
        title: "清理 DCV 记录",
        desc: "删除 DCV 代理域名下超过 7 天的验证 TXT 记录。",
    },
];

export const JOB_IDS = JOBS.map((j) => j.id);

/* ============================ 触发器配置 ============================ */

export interface TriggerDef {
    id: string;
    /** URL 路径名，/trigger/<name> */
    name: string;
    /** 调用令牌 */
    token: string;
    enabled: boolean;
    /** 该端点执行的任务 */
    jobs: string[];
    note?: string;
    last_run?: number;
    last_status?: string;
    last_detail?: string;
    runs?: number;
}

const TRIGGERS_KEY = "TRIGGERS";

export function newToken(lens: number = 32): string {
    const charset = "ABCDEFGHJKLMNPQRSTUWXYabcdefghjkmnpqrstuwxy23456789";
    const buf = new Uint8Array(lens);
    crypto.getRandomValues(buf);
    let out = "";
    for (let i = 0; i < lens; i++) out += charset[buf[i] % charset.length];
    return out;
}

/** 规范化端点名：仅允许字母、数字、- 与 _ */
export function normalizeTriggerName(name: string): string {
    return String(name ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

export async function readTriggers(env: Bindings): Promise<TriggerDef[]> {
    const raw = await readConf(env as any, TRIGGERS_KEY);
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed as TriggerDef[] : [];
    } catch {
        return [];
    }
}

export async function writeTriggers(env: Bindings, list: TriggerDef[]): Promise<void> {
    await writeConf(env as any, TRIGGERS_KEY, JSON.stringify(list));
}

export async function findTrigger(env: Bindings, name: string): Promise<TriggerDef | null> {
    const wanted = normalizeTriggerName(name);
    if (!wanted) return null;
    const list = await readTriggers(env);
    return list.find((t) => normalizeTriggerName(t.name) === wanted) ?? null;
}

export function createTrigger(name: string, jobs: string[]): TriggerDef {
    return {
        id: newId("trg"),
        name: normalizeTriggerName(name) || newId("endpoint"),
        token: newToken(32),
        enabled: true,
        jobs: jobs.filter((j) => JOB_IDS.includes(j)),
        note: "",
        runs: 0,
    };
}

/* ============================ 任务执行 ============================ */

export interface JobResult {
    job: string;
    status: "ok" | "fail";
    detail: string;
}

async function jobProcess(env: Bindings): Promise<string> {
    const result: any[] = await certs.Processing(env);
    return `推进 ${result.length} 个订单`;
}

async function jobRenew(env: Bindings): Promise<string> {
    const days = await readInt(env as any, "RENEW_DAYS_BEFORE", 30);
    const horizon = Date.now() + Math.max(1, days) * 86400_000;
    const {ensureDao} = await import("./db");
    const dao = await ensureDao(env as any);
    const {rows} = await dao.listApplies(
        {eq: {flag: 5, auto: 1}}, {page: 1, pageSize: 100, orderBy: "next", orderDesc: false});

    let renewed = 0;
    const failures: string[] = [];
    for (const row of rows) {
        const next = Number(row.next ?? 0);
        if (!next || next > horizon) continue;
        if (!row.keys) {
            failures.push(`${row.uuid}: 缺少私钥，无法自动续期`);
            continue;
        }
        // 复用前端"续期"按钮的路径：回到 flag=0 后重新走签发流程，
        // 旧证书保留到新证书签发成功为止，避免续期失败导致服务中断。
        try {
            await (await import("./order-workflow")).queueOrder(env, row.uuid, "retry");
            renewed += 1;
        } catch (e: any) {
            failures.push(`${row.uuid}: ${String(e?.message ?? e)}`);
        }
    }
    let detail = `检查 ${rows.length} 个自动续期订单，重新签发 ${renewed} 个`;
    if (failures.length) detail += `，失败 ${failures.length} 个：${failures.slice(0, 3).join("; ")}`;
    return detail;
}

async function jobEdgeSync(env: Bindings): Promise<string> {
    const selected = await (await import("./deployment")).syncSelectedOrders(env);
    return `订单目标成功 ${selected} 次`;
}

async function jobCleanDns(env: Bindings): Promise<string> {
    const res: any = await cleanDNS(env);
    return String(res?.text ?? "清理完成");
}

export interface RunOptions {
    /** 忽略定时任务的开关与间隔节流（仅对 cron 任务生效） */
    force?: boolean;
}

async function runJob(env: Bindings, job: string, opts: RunOptions = {}): Promise<JobResult> {
    try {
        let detail = "";
        if (job === "cron") detail = await jobCron(env, opts);
        else if (job === "process") detail = await jobProcess(env);
        else if (job === "renew") detail = await jobRenew(env);
        else if (job === "deploy") detail = await jobEdgeSync(env);
        else if (job === "clean-dns") detail = await jobCleanDns(env);
        else throw new Error(`未知任务: ${job}`);
        return {job, status: "ok", detail};
    } catch (e: any) {
        const msg = String(e?.message ?? e);
        console.error(`[automation] job ${job} failed:`, e);
        return {job, status: "fail", detail: msg};
    }
}

/**
 * 执行一次「Cloudflare 定时触发」。
 * 与 cron 触发共用同一套判定：开关 + 最小间隔 + 任务清单。
 * force 为 true 时忽略开关与节流，直接按任务清单执行。
 */
export async function jobCron(env: Bindings, opts: RunOptions = {}): Promise<string> {
    const dao = await (await import('./db')).ensureDao(env);
    const token = crypto.randomUUID();
    if (!dao.claimConfLease || !dao.releaseConfLease) throw new Error('Maintenance locking unavailable');
    if (!await dao.claimConfLease('CRON_LEASE', token, Date.now() + 300000, Date.now())) return '维护任务已在后台运行';
    try {
    const jobs = ['process', 'renew', 'deploy', 'clean-dns'];
    const out = await runJobs(env, jobs, "cron", {skipLog: true});
    await writeConf(env as any, SCHEDULE_STATE_KEY, String(Date.now()));
    await appendLog(env, {
        t: Date.now(), kind: "cron", status: out.status,
        detail: out.detail,
    });
    if (out.status === 'fail') throw new Error('Background maintenance did not complete');
    return out.detail;
    } finally { await dao.releaseConfLease('CRON_LEASE', token); }
}

/** 依次执行若干任务（renew 依赖 process 的结果，因此保持串行） */
export async function runJobs(
    env: Bindings, jobs: string[], source: string,
    opts: RunOptions & {skipLog?: boolean} = {},
): Promise<{results: JobResult[]; status: "ok" | "fail"; detail: string}> {
    const wanted = jobs.filter((j) => JOB_IDS.includes(j));
    const results: JobResult[] = [];
    for (const job of wanted) results.push(await runJob(env, job, opts));
    const failed = results.filter((r) => r.status === "fail");
    const status: "ok" | "fail" = failed.length ? "fail" : "ok";
    const detail = results.length === 0
        ? "未选择任何任务"
        : results.map((r) => `[${r.job}] ${r.detail}`).join(" | ");
    if (!opts.skipLog) {
        await appendLog(env, {t: Date.now(), kind: source, status, detail});
    }
    return {results, status, detail};
}

/** 触发器入口：校验令牌后执行端点绑定的任务 */
export async function runTrigger(
    env: Bindings, trigger: TriggerDef, opts: RunOptions = {},
): Promise<{results: JobResult[]; status: "ok" | "fail"; detail: string}> {
    const out = await runJobs(env, trigger.jobs ?? [], `trigger:${trigger.name}`, opts);
    const list = await readTriggers(env);
    const idx = list.findIndex((t) => t.id === trigger.id);
    if (idx >= 0) {
        list[idx].last_run = Date.now();
        list[idx].last_status = out.status;
        list[idx].last_detail = out.detail.slice(0, 500);
        list[idx].runs = Number(list[idx].runs ?? 0) + 1;
        await writeTriggers(env, list);
    }
    return out;
}

/* ============================ 定时任务 ============================ */

const SCHEDULE_STATE_KEY = "SCHEDULE_STATE";

/**
 * Cloudflare cron 入口。由于免费套餐每个账号只允许 5 个 cron 触发器，
 * 这里只在确实存在 cron 触发时才会被调用；执行内容与 `cron` 任务完全一致，
 * 可通过 /trigger/<name> 端点由外部调度器代替触发。
 */
export async function runScheduled(env: Bindings): Promise<void> {
    const detail = await jobCron(env, {});
    console.log("[automation] cron:", detail);
}

/** 供控制台展示定时任务配置 */
export async function readScheduleInfo(env: Bindings) {
    const [enabled, interval, csv, last, renewDays] = await Promise.all([
        readBool(env as any, "SCHEDULE_ENABLED", false),
        readInt(env as any, "SCHEDULE_INTERVAL_MINUTES", 60),
        readConf(env as any, "SCHEDULE_JOBS"),
        readInt(env as any, SCHEDULE_STATE_KEY, 0),
        readInt(env as any, "RENEW_DAYS_BEFORE", 30),
    ]);
    return {
        enabled,
        interval_minutes: interval,
        jobs: (csv ?? "process,renew,edge-sync").split(",").map((s) => s.trim()).filter(Boolean),
        last_run: last,
        renew_days_before: renewDays,
    };
}

/** 立即触发一次"自动下发"补漏，供手动按钮使用 */
export async function pushOrderNow(env: Bindings, uuid: string) {
    const {ensureDao} = await import("./db");
    const dao = await ensureDao(env as any);
    const row = await dao.getApply(uuid);
    if (!row) throw new Error("订单不存在");
    return await pushOrder(env, row, {manual: true});
}
