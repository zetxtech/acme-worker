/**
 * /trigger/*      访问即执行（等同于 cron，无需 Cloudflare cron 配额）
 * /admin/automation/*  触发器端点与边缘证书下发目标的管理接口
 * -------------------------------------------------------------------------
 * 鉴权说明：
 *   - /trigger/:name 使用端点自带的 token（查询参数 ?token= 或 X-Trigger-Token 头），
 *     与管理员登录态无关，便于外部调度器直接调用。
 *   - /admin/automation/* 走 adminMiddleware（登录 + is_admin=1）。
 *   - 目标配置里的密钥只在管理接口回显"是否已配置"，不回显明文。
 */

import type {Context, Hono} from "hono";
import type {Bindings} from "../index";
import {adminMiddleware} from "../middleware/admin";
import {writeConf} from "../db/conf";import {
    createTrigger, findTrigger, JOBS, JOB_IDS, newToken, normalizeTriggerName,
    readScheduleInfo, readTriggers, runJobs, runTrigger, writeTriggers,
} from "../automation";
import {
    appendLog, newId, pushOrder, readLog, readTargets, syncEdgeCertificates,
    testTarget, writeTargets, type EdgeTarget, type EdgeTargetType,
} from "../edge";
import {ensureDao} from "../db";

/* ============================ 工具 ============================ */

function maskTarget(t: EdgeTarget): Record<string, any> {
    const out: Record<string, any> = {
        id: t.id, type: t.type, name: t.name, enabled: t.enabled, auto: t.auto,
        domains: t.domains ?? [], last_run: t.last_run, last_status: t.last_status,
        last_detail: t.last_detail,
    };
    if (t.type === "edgeone") {
        const cfg = t.edgeone ?? {secret_id: "", secret_key: ""};
        out.edgeone = {
            secret_id: cfg.secret_id,
            secret_key: "",
            has_secret_key: !!cfg.secret_key,
            region: cfg.region ?? "",
            zone_id: cfg.zone_id ?? "",
            hosts: cfg.hosts ?? [],
            alias: cfg.alias ?? "",
        };
    } else {
        const cfg = t.esa ?? {access_key_id: "", access_key_secret: ""};
        out.esa = {
            access_key_id: cfg.access_key_id,
            access_key_secret: "",
            has_access_key_secret: !!cfg.access_key_secret,
            endpoint: cfg.endpoint ?? "",
            site_id: cfg.site_id ?? "",
            cert_name: cfg.cert_name ?? "",
        };
    }
    return out;
}

/** 合并补丁；密钥类字段留空表示保持原值 */
function applyTargetPatch(target: EdgeTarget, patch: any): EdgeTarget {
    if (patch.name !== undefined) target.name = String(patch.name);
    if (patch.enabled !== undefined) target.enabled = !!patch.enabled;
    if (patch.auto !== undefined) target.auto = !!patch.auto;
    if (patch.domains !== undefined) {
        target.domains = Array.isArray(patch.domains)
            ? patch.domains.map((d: any) => String(d).trim()).filter(Boolean)
            : String(patch.domains).split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    }
    if (target.type === "edgeone") {
        const cur = target.edgeone ?? {secret_id: "", secret_key: ""};
        const next = patch.edgeone ?? {};
        target.edgeone = {
            secret_id: next.secret_id !== undefined ? String(next.secret_id) : cur.secret_id,
            secret_key: next.secret_key ? String(next.secret_key) : cur.secret_key,
            region: next.region !== undefined ? String(next.region) : cur.region,
            zone_id: next.zone_id !== undefined ? String(next.zone_id) : cur.zone_id,
            hosts: next.hosts !== undefined
                ? (Array.isArray(next.hosts)
                    ? next.hosts.map((h: any) => String(h).trim()).filter(Boolean)
                    : String(next.hosts).split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))
                : cur.hosts,
            alias: next.alias !== undefined ? String(next.alias) : cur.alias,
        };
    } else {
        const cur = target.esa ?? {access_key_id: "", access_key_secret: ""};
        const next = patch.esa ?? {};
        target.esa = {
            access_key_id: next.access_key_id !== undefined
                ? String(next.access_key_id) : cur.access_key_id,
            access_key_secret: next.access_key_secret
                ? String(next.access_key_secret) : cur.access_key_secret,
            endpoint: next.endpoint !== undefined ? String(next.endpoint) : cur.endpoint,
            site_id: next.site_id !== undefined ? String(next.site_id) : cur.site_id,
            cert_name: next.cert_name !== undefined ? String(next.cert_name) : cur.cert_name,
        };
    }
    return target;
}

function buildTarget(body: any): EdgeTarget {
    const type = String(body?.type ?? "") as EdgeTargetType;
    if (type !== "edgeone" && type !== "esa") {
        throw new Error("type 必须是 edgeone 或 esa");
    }
    const target: EdgeTarget = {
        id: newId("tgt"),
        type,
        name: String(body?.name ?? "").trim() || (type === "edgeone" ? "EdgeOne" : "ESA"),
        enabled: body?.enabled === undefined ? true : !!body.enabled,
        auto: body?.auto === undefined ? true : !!body.auto,
        domains: [],
    };
    applyTargetPatch(target, body);
    return target;
}

/* ============================ 公共触发器 ============================ */

async function handleTrigger(c: Context<{ Bindings: Bindings }>): Promise<Response> {
    const name = c.req.param("name") ?? "";
    const trigger = await findTrigger(c.env as Bindings, name);
    if (!trigger) return c.json({code: "NOT_FOUND", message: `触发器 ${name} 不存在`}, 404);
    if (!trigger.enabled) return c.json({code: "DISABLED", message: "触发器已停用"}, 403);

    const token = c.req.query("token") ?? c.req.header("X-Trigger-Token") ?? "";
    if (!token || token !== trigger.token) {
        return c.json({code: "UNAUTHORIZED", message: "令牌无效"}, 401);
    }

    // force=1 时忽略定时任务的开关与间隔节流（仅对 cron 任务生效）
    const forceRaw = (c.req.query("force") ?? c.req.header("X-Trigger-Force") ?? "")
        .toString().toLowerCase();
    const force = forceRaw === "1" || forceRaw === "true" || forceRaw === "yes";

    const out = await runTrigger(c.env as Bindings, trigger, {force});
    return c.json({
        code: "OK",
        trigger: trigger.name,
        status: out.status,
        detail: out.detail,
        results: out.results,
    }, 200);
}

/* ============================ 管理接口 ============================ */

async function handleOverview(c: Context<{ Bindings: Bindings }>): Promise<Response> {
    const env = c.env as Bindings;
    const [triggers, targets, log, schedule] = await Promise.all([
        readTriggers(env), readTargets(env), readLog(env), readScheduleInfo(env),
    ]);
    const origin = new URL(c.req.url).origin;
    return c.json({
        flags: 0,
        jobs: JOBS,
        triggers: triggers.map((t) => ({
            ...t,
            url: `${origin}/trigger/${normalizeTriggerName(t.name)}?token=${t.token}`,
        })),
        targets: targets.map(maskTarget),
        schedule,
        log: log.slice(0, 60),
    });
}

async function handleCreateTrigger(c: Context<{ Bindings: Bindings }>): Promise<Response> {
    const env = c.env as Bindings;
    const body: any = await c.req.json().catch(() => ({}));
    const name = normalizeTriggerName(body?.name ?? "");
    if (!name) return c.json({flags: 1, texts: "端点名称不能为空"}, 400);
    const list = await readTriggers(env);
    if (list.some((t) => normalizeTriggerName(t.name) === name)) {
        return c.json({flags: 2, texts: "该端点名称已存在"}, 409);
    }
    const jobs: string[] = Array.isArray(body?.jobs) ? body.jobs : [];
    if (jobs.length === 0) return c.json({flags: 3, texts: "请至少选择一个任务"}, 400);
    const trigger = createTrigger(name, jobs);
    trigger.note = String(body?.note ?? "");
    list.push(trigger);
    await writeTriggers(env, list);
    return c.json({flags: 0, texts: "触发器已创建", item: trigger});
}

async function handleUpdateTrigger(c: Context<{ Bindings: Bindings }>): Promise<Response> {
    const env = c.env as Bindings;
    const id = c.req.param("id") ?? "";
    const body: any = await c.req.json().catch(() => ({}));
    const list = await readTriggers(env);
    const idx = list.findIndex((t) => t.id === id);
    if (idx < 0) return c.json({flags: 1, texts: "触发器不存在"}, 404);
    const cur = list[idx];
    if (body?.name !== undefined) {
        const name = normalizeTriggerName(body.name);
        if (!name) return c.json({flags: 2, texts: "端点名称不能为空"}, 400);
        if (list.some((t, i) => i !== idx && normalizeTriggerName(t.name) === name)) {
            return c.json({flags: 3, texts: "该端点名称已存在"}, 409);
        }
        cur.name = name;
    }
    if (body?.jobs !== undefined) {
        const jobs = Array.isArray(body.jobs)
            ? body.jobs.filter((j: any) => JOB_IDS.includes(String(j))) : [];
        if (jobs.length === 0) return c.json({flags: 4, texts: "请至少选择一个任务"}, 400);
        cur.jobs = jobs;
    }
    if (body?.enabled !== undefined) cur.enabled = !!body.enabled;
    if (body?.note !== undefined) cur.note = String(body.note);
    if (body?.rotate_token) cur.token = newToken(32);
    list[idx] = cur;
    await writeTriggers(env, list);
    return c.json({flags: 0, texts: "已保存", item: cur});
}

async function handleDeleteTrigger(c: Context<{ Bindings: Bindings }>): Promise<Response> {
    const env = c.env as Bindings;
    const id = c.req.param("id") ?? "";
    const list = await readTriggers(env);
    const next = list.filter((t) => t.id !== id);
    if (next.length === list.length) return c.json({flags: 1, texts: "触发器不存在"}, 404);
    await writeTriggers(env, next);
    return c.json({flags: 0, texts: "已删除"});
}

async function handleRunTrigger(c: Context<{ Bindings: Bindings }>): Promise<Response> {
    const env = c.env as Bindings;
    const id = c.req.param("id") ?? "";
    const body: any = await c.req.json().catch(() => ({}));
    const trigger = (await readTriggers(env)).find((t) => t.id === id);
    if (!trigger) return c.json({flags: 1, texts: "触发器不存在"}, 404);
    const out = await runTrigger(env, trigger, {force: !!body?.force});
    return c.json({flags: 0, texts: out.detail, status: out.status, results: out.results});
}

async function handleCreateTarget(c: Context<{ Bindings: Bindings }>): Promise<Response> {
    const env = c.env as Bindings;
    const body: any = await c.req.json().catch(() => ({}));
    let target: EdgeTarget;
    try {
        target = buildTarget(body);
    } catch (e: any) {
        return c.json({flags: 1, texts: String(e?.message ?? e)}, 400);
    }
    const list = await readTargets(env);
    list.push(target);
    await writeTargets(env, list);
    return c.json({flags: 0, texts: "已添加", item: maskTarget(target)});
}

async function handleUpdateTarget(c: Context<{ Bindings: Bindings }>): Promise<Response> {
    const env = c.env as Bindings;
    const id = c.req.param("id") ?? "";
    const body: any = await c.req.json().catch(() => ({}));
    const list = await readTargets(env);
    const idx = list.findIndex((t) => t.id === id);
    if (idx < 0) return c.json({flags: 1, texts: "下发目标不存在"}, 404);
    list[idx] = applyTargetPatch(list[idx], body);
    await writeTargets(env, list);
    return c.json({flags: 0, texts: "已保存", item: maskTarget(list[idx])});
}

async function handleDeleteTarget(c: Context<{ Bindings: Bindings }>): Promise<Response> {
    const env = c.env as Bindings;
    const id = c.req.param("id") ?? "";
    const list = await readTargets(env);
    const next = list.filter((t) => t.id !== id);
    if (next.length === list.length) return c.json({flags: 1, texts: "下发目标不存在"}, 404);
    await writeTargets(env, next);
    return c.json({flags: 0, texts: "已删除"});
}

async function handleTestTarget(c: Context<{ Bindings: Bindings }>): Promise<Response> {
    const env = c.env as Bindings;
    const id = c.req.param("id") ?? "";
    const target = (await readTargets(env)).find((t) => t.id === id);
    if (!target) return c.json({flags: 1, texts: "下发目标不存在"}, 404);
    try {
        const detail = await testTarget(target);
        await appendLog(env, {
            t: Date.now(), kind: "edge-test", target: target.name, status: "ok", detail,
        });
        return c.json({flags: 0, texts: detail});
    } catch (e: any) {
        const msg = String(e?.message ?? e);
        await appendLog(env, {
            t: Date.now(), kind: "edge-test", target: target.name, status: "fail", detail: msg,
        });
        return c.json({flags: 2, texts: msg}, 400);
    }
}

async function handleSyncTarget(c: Context<{ Bindings: Bindings }>): Promise<Response> {
    const env = c.env as Bindings;
    const id = c.req.param("id") ?? "";
    const body: any = await c.req.json().catch(() => ({}));
    const res = await syncEdgeCertificates(env, {
        targetId: id, force: !!body?.force,
    });
    const failed = res.results.filter((r) => r.status === "fail");
    return c.json({
        flags: failed.length ? 1 : 0,
        texts: `检查 ${res.checked} 个订单，成功 ${res.pushed} 次` +
            (failed.length ? `，失败 ${failed.length} 次` : ""),
        results: res.results,
    });
}

async function handlePushOrder(c: Context<{ Bindings: Bindings }>): Promise<Response> {
    const env = c.env as Bindings;
    const uuid = c.req.param("uuid") ?? "";
    const dao = await ensureDao(env as any);
    const row = await dao.getApply(uuid);
    if (!row) return c.json({flags: 1, texts: "订单不存在"}, 404);
    const body: any = await c.req.json().catch(() => ({}));
    const results = await pushOrder(env, row, {manual: true, force: !!body?.force});
    const failed = results.filter((r) => r.status === "fail");
    return c.json({
        flags: failed.length ? 1 : 0,
        texts: failed.length ? failed[0].detail : "下发完成",
        results,
    });
}

async function handleLog(c: Context<{ Bindings: Bindings }>): Promise<Response> {
    const log = await readLog(c.env as Bindings);
    return c.json({flags: 0, items: log});
}

async function handleSchedule(c: Context<{ Bindings: Bindings }>): Promise<Response> {
    const env = c.env as Bindings;
    const body: any = await c.req.json().catch(() => ({}));
    if (body?.enabled !== undefined) {
        await writeConf(env as any, "SCHEDULE_ENABLED", body.enabled ? "true" : "false");
    }
    if (body?.interval_minutes !== undefined) {
        const n = Math.max(1, Number(body.interval_minutes) || 60);
        await writeConf(env as any, "SCHEDULE_INTERVAL_MINUTES", String(n));
    }
    if (body?.jobs !== undefined) {
        const jobs = (Array.isArray(body.jobs) ? body.jobs : [])
            .map((j: any) => String(j)).filter((j: string) => JOB_IDS.includes(j));
        await writeConf(env as any, "SCHEDULE_JOBS", jobs.join(","));
    }
    if (body?.renew_days_before !== undefined) {
        const n = Math.max(1, Math.min(90, Number(body.renew_days_before) || 30));
        await writeConf(env as any, "RENEW_DAYS_BEFORE", String(n));
    }
    const schedule = await readScheduleInfo(env);
    return c.json({flags: 0, texts: "已保存", schedule});
}

async function handleRunJobsNow(c: Context<{ Bindings: Bindings }>): Promise<Response> {
    const env = c.env as Bindings;
    const body: any = await c.req.json().catch(() => ({}));
    const jobs = (Array.isArray(body?.jobs) ? body.jobs : [])
        .map((j: any) => String(j)).filter((j: string) => JOB_IDS.includes(j));
    if (jobs.length === 0) return c.json({flags: 1, texts: "请至少选择一个任务"}, 400);
    const out = await runJobs(env, jobs, "console");
    return c.json({flags: 0, texts: out.detail, status: out.status, results: out.results});
}

/** 挂载路由 */
export function mountAutomationRoutes(app: Hono<{ Bindings: Bindings }>): void {
    // 公共触发端点：访问即执行
    app.all("/trigger/:name", handleTrigger);

    // 管理接口
    app.use("/admin/automation", adminMiddleware);
    app.use("/admin/automation/*", adminMiddleware);
    app.get("/admin/automation", handleOverview);
    app.get("/admin/automation/log", handleLog);
    app.post("/admin/automation/run", handleRunJobsNow);
    app.put("/admin/automation/schedule", handleSchedule);
    app.post("/admin/automation/triggers", handleCreateTrigger);
    app.patch("/admin/automation/triggers/:id", handleUpdateTrigger);
    app.delete("/admin/automation/triggers/:id", handleDeleteTrigger);
    app.post("/admin/automation/triggers/:id/run", handleRunTrigger);
    app.post("/admin/automation/targets", handleCreateTarget);
    app.patch("/admin/automation/targets/:id", handleUpdateTarget);
    app.delete("/admin/automation/targets/:id", handleDeleteTarget);
    app.post("/admin/automation/targets/:id/test", handleTestTarget);
    app.post("/admin/automation/targets/:id/sync", handleSyncTarget);
    app.post("/admin/automation/orders/:uuid/push", handlePushOrder);
}
