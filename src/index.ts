import {Context, Hono} from 'hono'
import {opDomain} from "./certs";
import {cleanDNS} from "./query";
import * as users from './users';
import * as saves from './saves';
import * as certs from './certs';
import * as local from "hono/cookie";
import {mountSetupRoutes} from "./routes/setup";
import {mountAdminUsersRoutes} from "./routes/admin_users";
import {mountAdminCertsRoutes} from "./routes/admin_certs";
import {mountAdminConfsRoutes} from "./routes/admin_confs";
import {mountCertDownloadRoutes} from "./routes/cert_download";
import {mountOpenApiRoutes} from "./routes/openapi";
import {mountAccountApiRoutes} from "./routes/account_api";
import {mountAutomationRoutes} from "./routes/automation";
import {assertCaAvailable, assertDcvAvailable, caCapabilities, dcvCapability, normalizeDomains, requestedNames} from "./capabilities";
import {readConf} from "./db/conf";
import {currentUser} from "./middleware/admin";
import {mountResourceRoutes} from "./routes/resources";
import {validateSelections} from "./resources";
import {deleteSavedOrder, queueOrder, readOrderWork, validatedEdit, type OrderWork} from "./order-workflow";

// 绑定数据 ###############################################################################
// DB_SOURCE：空/d1 → Cloudflare D1；mysql → mysql2；prisma → PrismaClient
// 具体的附加变量（DB_MYSQL_*、DATABASE_URL）在 DB_SOURCE 对应时才会被读取。
export type Bindings = {
    // 数据源 --------------------------------------------------------
    DB_CF?: D1Database, DB_SOURCE?: string,
    DB_MYSQL_URL?: string, DB_MYSQL_HOST?: string, DB_MYSQL_PORT?: string,
    DB_MYSQL_USER?: string, DB_MYSQL_PASS?: string, DB_MYSQL_NAME?: string,
    DATABASE_URL?: string,
    AUTOMATION_KEY?: string,
    CRON_TOKEN?: string,
    ORDER_WORKFLOW?: DurableObjectNamespace,
    // 邮件 / 站点 / 鉴权 -------------------------------------------
    MAIL_KEYS: string, MAIL_SEND: string, AUTH_KEYS: string, SITE_KEYS?: string,
    SITE_HOST?: string, SITE_TITLE?: string,
    // DNS 代理 -----------------------------------------------------
    DCV_AGENT: string, DCV_EMAIL: string, DCV_TOKEN: string, DCV_ZONES: string,
    DCV_API_TOKEN?: string,
    // ACME 账号（各 CA 的 EAB） -----------------------------------
    GTS_keyMC: string, GTS_keyID: string, GTS_KeyTS: string, GTS_useIt: string,
    SSL_keyMC: string, SSL_keyID: string, SSL_KeyTS: string, SSL_useIt: string,
    ZRO_keyMC: string, ZRO_keyID: string, ZRO_KeyTS: string, ZRO_useIt: string,
    // 自动化（边缘证书下发 / 触发器端点）------------------------------
    // 运行期由 Confs 承载，这里保留可选声明以便通过环境变量做初始种子。
    EDGE_TARGETS?: string, TRIGGERS?: string, EDGE_STATE?: string, AUTO_LOG?: string,
    RENEW_DAYS_BEFORE?: string, SCHEDULE_ENABLED?: string,
    SCHEDULE_INTERVAL_MINUTES?: string, SCHEDULE_JOBS?: string
}
export const app = new Hono<{ Bindings: Bindings }>()

// 初始化向导 #############################################################################
// GET /bootstrap → 前端启动时调用，返回初始化/数据源状态
// POST /setup    → 首次初始化（完成后写入 Confs 并将指定邮箱升级为管理员）
mountSetupRoutes(app);

// 管理员 - 用户管理 ######################################################################
mountAdminUsersRoutes(app);

// 管理员 - 证书管理 ######################################################################
mountAdminCertsRoutes(app);

// 管理员 - 系统配置 ######################################################################
mountAdminConfsRoutes(app);

// 证书下载增强（ZIP / PFX） ##############################################################
mountCertDownloadRoutes(app);

// 开放 API（/api/v1/*） ###################################################################
mountOpenApiRoutes(app);

// 用户自助 API token #####################################################################
mountAccountApiRoutes(app);

// 自动化：边缘证书下发 / 触发器端点 #######################################################
mountAutomationRoutes(app);
mountResourceRoutes(app);

app.get('/capabilities', async (c) => {
    const user = await currentUser(c);
    if (!user) return c.json({flags: 2, texts: "Authentication required"}, 401);
    const items = await caCapabilities((name) => readConf(c.env, name));
    const dcv = await dcvCapability((name) => readConf(c.env, name));
    return c.json({flags: 0, dcv: {...dcv, missing: Number(user.is_admin) === 1 ? dcv.missing : []}, cas: items.map((item) => ({
        ...item, missing: Number(user.is_admin) === 1 ? item.missing : [],
    }))});
});

// 获取信息 ###############################################################################
app.get('/users/', async (c: Context): Promise<Response> => {
    return c.json({})
});

// 获取种子 ###############################################################################
app.get('/nonce/', async (c: Context): Promise<Response> => {
    return await users.getNonce(c);
});

// 核查状态 ###############################################################################
app.get('/panel/', async (c: Context): Promise<Response> => {
    if (!await users.userAuth(c)) return c.redirect("/#/login", 302);
    return c.redirect("/#/panel", 302);
})

// 申请证书 ###############################################################################
app.use('/apply/', async (c: Context): Promise<Response> => {
    if (c.req.method !== 'POST') return c.json({"flags": 1, "texts": "请求方式无效"}, 400);
    if (!await users.userAuth(c)) return c.json({"flags": 2, "texts": "用户尚未登录"}, 401);
    // 读取数据
    try {
        let upload_json = await c.req.json();
        let domain_list = upload_json['domains'];
        assertCaAvailable(await caCapabilities((name) => readConf(c.env, name)),
            upload_json.globals?.ca ?? "lets-encrypt", requestedNames(domain_list));
        let domain_save = normalizeDomains(domain_list);
        assertDcvAvailable(await dcvCapability((name) => readConf(c.env, name)), domain_save);

        // 三重校验：captcha / 月度上限 / 配额 ------------------------------------
        const user_mail = local.getCookie(c, 'mail') ?? "";
        const {ensureDao} = await import("./db");
        const dao = await ensureDao(c.env as any);
        const userRow = await dao.getUser(user_mail);
        if (!userRow) return c.json({flags: 4, texts: "用户不存在"}, 401);
        const selectedTargets = await validateSelections(dao, userRow.mail, domain_save, upload_json.targetIds, c.env);
        const {checkApplyGuard} = await import("./middleware/applyGuard");
        const guard = await checkApplyGuard(c, {
            source: "web",
            user: userRow,
            captchaToken:
                upload_json['captcha_token'] ??
                upload_json['captchaToken'] ??
                null,
        });
        if (!guard.ok) {
            return c.json({
                flags: 10, code: guard.code, texts: guard.message,
            }, guard.status as any);
        }

        // console.log(domain_save);
        let uuid = await users.newNonce(16)
        await saves.insertDB(c.env.DB_CF, "Apply", {
            uuid: uuid,
            mail: local.getCookie(c, 'mail'),
            sign: upload_json['globals']['ca'] ?? "lets-encrypt",
            type: upload_json['globals']['encryption'],
            auto: upload_json['globals']['auto_renew'],
            flag: 0,
            time: Date.now(),
            main: JSON.stringify(upload_json['subject']),
            list: JSON.stringify(domain_save),
            keys: "",
            cert: "",
            next: new Date(new Date().setDate(new Date().getDate() + 7)).getTime(),
            text: "订单提交成功",
        })
        await dao.upsertConf(`ORDER_DEPLOYMENT:${uuid}`, JSON.stringify(selectedTargets), Date.now());
        await queueOrder(c.env, uuid);
        return c.json({"flags": 0, "texts": "申请已受理，将在后台自动处理", "order": uuid}, 202);
    } catch (error) {
        return c.json({"flags": 3, "texts": "请求数据无效: " + error}, 400);
    }
})

app.delete('/orders/:uuid', async (c) => {
    const user = await currentUser(c);
    if (!user) return c.json({flags: 2, texts: '用户尚未登录'}, 401);
    const uuid = c.req.param('uuid');
    const dao = await (await import('./db')).ensureDao(c.env);
    const row = await dao.getApply(uuid);
    if (!row || row.mail.toLowerCase() !== user.mail.toLowerCase()) return c.json({flags: 9, texts: '申请不存在'}, 404);
    const body = await c.req.json().catch(() => ({}));
    if (body.confirmId !== uuid) return c.json({flags: 3, texts: '请输入完整订单 ID 以确认'}, 400);
    try {
        await deleteSavedOrder(c.env, uuid, user.mail, body.confirmId);
        return c.json({flags: 0, texts: '本站记录已永久删除，证书未被吊销'});
    } catch { return c.json({flags: 3, texts: '暂时无法安全删除，可能仍在处理或验证记录清理失败；原记录已保留，请稍后重试'}, 409); }
});

app.post('/apply/:uuid/edit', async (c) => {
    if (!await users.userAuth(c)) return c.json({flags: 2, texts: '用户尚未登录'}, 401);
    const dao = await (await import('./db')).ensureDao(c.env);
    const row = await dao.getApply(c.req.param('uuid'));
    if (!row || row.mail !== local.getCookie(c, 'mail')) return c.json({flags: 9, texts: '申请不存在'}, 404);
    if (Number(row.flag) >= 4 || row.cert) return c.json({flags: 9, texts: '签发已开始或完成，原证书已保留'}, 409);
    const work = await queueOrder(c.env, row.uuid, 'edit');
    return c.json({flags: 0, revision: work.revision}, 202);
});

app.post('/apply/:uuid/resume', async (c) => {
    if (!await users.userAuth(c)) return c.json({flags: 2, texts: '用户尚未登录'}, 401);
    const dao = await (await import('./db')).ensureDao(c.env);
    const row = await dao.getApply(c.req.param('uuid'));
    if (!row || row.mail !== local.getCookie(c, 'mail')) return c.json({flags: 9}, 404);
    const {revision} = await c.req.json();
    const work = await readOrderWork(dao, row.uuid);
    if (work?.intent === 'edit' && work.revision === revision) await queueOrder(c.env, row.uuid);
    return c.json({flags: 0});
});

app.put('/apply/:uuid', async (c) => {
    if (!await users.userAuth(c)) return c.json({flags: 2, texts: "用户尚未登录"}, 401);
    const mail = local.getCookie(c, 'mail') ?? '';
    const {ensureDao} = await import('./db');
    const dao = await ensureDao(c.env);
    const uuid = c.req.param('uuid');
    const row = await dao.getApply(uuid);
    if (!row || row.mail !== mail) return c.json({flags: 9, texts: "申请不存在"}, 404);
    if (Number(row.flag) >= 4 || row.cert) return c.json({flags: 9, texts: "签发已开始或已完成，原证书已保留，请新建申请"}, 409);
    try {
        const input = await c.req.json();
        const work = await readOrderWork(dao, uuid);
        if (work?.intent === 'edit' && work.revision !== input.editRevision) return c.json({flags: 9, texts: '编辑会话已变化，请重新打开原申请'}, 409);
        const payload = await validatedEdit(c.env, mail, input);
        await dao.upsertConf(`ORDER_EDIT:${uuid}`, JSON.stringify({mail, payload}), Date.now());
        await queueOrder(c.env, uuid, 'update');
        return c.json({flags: 0, order: uuid, texts: "更改已受理，原申请编号不变"}, 202);
    } catch { return c.json({flags: 3, texts: "更改未保存，请检查域名、签发机构和资源权限；原申请已保留"}, 400); }
});

// 查询申请配额（供前端申请页展示） #########################################################
app.get('/apply/quota', async (c: Context): Promise<Response> => {
    if (!await users.userAuth(c)) return c.json({flags: 2, texts: "用户尚未登录"}, 401);
    const mail = local.getCookie(c, 'mail') ?? "";
    try {
        const {ensureDao} = await import("./db");
        const {readInt} = await import("./db/conf");
        const dao = await ensureDao(c.env as any);
        const user = await dao.getUser(mail);
        if (!user) return c.json({flags: 4, texts: "用户不存在"}, 401);
        const limit = await readInt(c.env as any, "MONTHLY_APPLY_LIMIT", 0);
        const now = new Date();
        const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
        const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
        const used = await dao.countAppliesByMailInRange(mail, start, end);
        const active = await dao.countActiveAppliesByMail(mail);
        return c.json({
            flags: 0,
            monthly_limit: limit,
            month_used: used,
            quota: Number(user.quota ?? -1),
            active_certs: active,
        });
    } catch (e: any) {
        return c.json({flags: 5, texts: e?.message ?? String(e)}, 500);
    }
});

// 获取订单 ###############################################################################
app.use('/order/', async (c: Context): Promise<Response> => {
    if (c.req.method !== 'GET') return c.json({"flags": 1, "texts": "请求方式无效"}, 400);
    if (!await users.userAuth(c)) return c.json({"flags": 2, "texts": "用户尚未登录"}, 401);
    let order_uuid: string = <string>c.req.query('id'); // 用户邮件
    let order_acts: string = <string>c.req.query('op'); // 执行操作
    let order_push: string = <string>c.req.query('cd'); // 执行操作
    let user_email: string | undefined = local.getCookie(c, 'mail')
    if (!order_uuid) return c.json({"flags": 5, "texts": "订单ID不存在"}, 401);
    if (!user_email) return c.json({"flags": 4, "texts": "用户尚未登录"}, 401);
    // 读取数据 ============================================================================
    try {
        let order_data: Record<string, any>[];
        if (order_uuid == "all") {
            order_data = await saves.selectDB(c.env.DB_CF, "Apply", {
                mail: {value: user_email}
            });
            // console.log(user_email, order_data)
        } else {
            order_data = await saves.selectDB(c.env.DB_CF, "Apply", {
                uuid: {value: order_uuid},
                mail: {value: user_email}
            });
        }
        // if (order_data.length < 1)
        //     return c.json({"flags": 6, "texts": "请求订单无效"}, 400);
        if (order_uuid !== 'all' && !order_data[0]) return c.json({flags: 9, texts: '申请不存在或无权查看'}, 404);
        if (order_acts == undefined || order_acts === "") { // 获取订单信息 -----------
            let order_save: any = order_uuid == "all" ? order_data : order_data[0];
            if (order_uuid === 'all' && c.env.DB_CF) {
                const pending = order_data.filter((row) => Number(row.flag) !== 5).map((row) => `ORDER_WORK:${row.uuid}`);
                const states = new Map<string, OrderWork>();
                for (let cursor = 0; cursor < pending.length; cursor += 50) {
                    const keys = pending.slice(cursor, cursor + 50);
                    const result = await c.env.DB_CF.prepare(`SELECT name,data FROM Confs WHERE name IN (${keys.map(() => '?').join(',')})`).bind(...keys).all();
                    for (const row of result.results) {
                        try { states.set(row.name.slice('ORDER_WORK:'.length), JSON.parse(row.data)); } catch {}
                    }
                }
                order_save = order_data.map((row) => ({...row, work: states.get(row.uuid)}));
            }
            // 单个订单附带边缘证书下发状态，便于用户确认证书是否已同步到 CDN
            let edge_state: Record<string, any> = {};
            if (order_uuid !== "all" && order_data[0]) {
                const dao = await (await import('./db')).ensureDao(c.env);
                order_save = {...order_save, work: await readOrderWork(dao, order_uuid),
                    targetIds: JSON.parse(await dao.getConf(`ORDER_DEPLOYMENT:${order_uuid}`) ?? '[]')};
                try {
                    const {readOrderEdgeState} = await import("./edge");
                    edge_state = await readOrderEdgeState(c.env as Bindings, order_uuid);
                } catch (e) {
                    console.error("read order edge state failed:", e);
                }
            }
            return c.json({"flags": 0, "order": order_save, "edge": edge_state}, 200);
        } else { // 对订单执行操作 ----------------------------------------------------------
            if (!order_data[0] || order_uuid === 'all') return c.json({flags: 9, texts: "申请不存在"}, 404);
            if (order_acts === "modify")
                return c.json({flags: 9, texts: "请通过编辑表单修改，原申请已保留"}, 409);
            if (["process", "verify", "single", "reload", "re_new", "cancel"].includes(order_acts)) {
                const row = order_data[0];
                if (order_acts === 'cancel' && Number(row.flag) === 5) return c.json({flags: 9, texts: "已签发证书不会被取消申请删除，请使用吊销操作"}, 409);
                const intent: OrderWork['intent'] = order_acts === 'cancel' ? 'cancel'
                    : ['reload', 're_new'].includes(order_acts) || Number(row.flag) < 0 ? 'retry'
                        : ['verify', 'single'].includes(order_acts) ? 'verify' : 'process';
                if (order_acts === 'single' && !JSON.parse(row.list).some((domain: any) => domain.name === order_push)) {
                    return c.json({flags: 9, texts: "域名不属于此申请"}, 400);
                }
                const work = await queueOrder(c.env, order_uuid, intent, order_acts === 'single' ? [order_push] : undefined);
                return c.json({flags: 0, order: order_acts, texts: work.detail}, 202);
            }
            if (order_acts === "ca_get") {
                order_acts = order_data[0].cert;
            } else if (order_acts === "ca_key") {
                order_acts = order_data[0].keys;
            } else if (order_acts === "edge_push") {
                if (Number(order_data[0].flag) !== 5) return c.json({flags: 3, texts: '证书尚未签发'}, 409);
                const dao = await (await import('./db')).ensureDao(c.env);
                const ids = JSON.parse(await dao.getConf(`ORDER_DEPLOYMENT:${order_uuid}`) ?? '[]');
                if (!ids.length) return c.json({flags: 3, texts: '请先选择部署目标'}, 400);
                for (const id of ids) {
                    const key = `DEPLOY_STATE:${order_uuid}:${id}`;
                    const previous = JSON.parse(await dao.getConf(key) ?? 'null');
                    if (previous?.status === 'running') continue;
                    await dao.upsertConf(key, JSON.stringify({...previous, targetId: id, name: previous?.name ?? id,
                        status: 'pending', attempts: 0, nextAttempt: 0, detail: '已安排重新部署', updatedAt: Date.now()}), Date.now());
                }
                await queueOrder(c.env, order_uuid, 'deploy');
                return c.json({flags: 0, texts: '已安排后台重新部署', order: order_acts}, 202);
            } else if (order_acts === "rm_key") {
                await saves.updateDB(c.env.DB_CF, "Apply", {keys: ""}, {uuid: order_uuid})
            } else if (order_acts === "ca_del") {
                // 吊销证书：支持通过 cd 参数传递 RFC5280 吊销原因码（数字 0/1/3/4/5 等）
                let order_info = order_data[0];
                let reason_raw = c.req.query('reason');
                let reason_num = 0;
                if (reason_raw === undefined || reason_raw === "") {
                    // 兼容旧调用：cd 没有具体域名语义时可复用为原因码
                    const cd_num = Number(order_push);
                    if (Number.isFinite(cd_num)) reason_num = cd_num;
                } else {
                    const n = Number(reason_raw);
                    if (Number.isFinite(n)) reason_num = n;
                }
                const revoke_res: any = await certs.revokeCert(c.env, order_info, reason_num);
                if (revoke_res && revoke_res.flags !== 0) {
                    return c.json({
                        "flags": revoke_res.flags,
                        "texts": revoke_res.texts,
                        "order": order_acts,
                    }, 400);
                }
            } else
                return c.json({"flags": 5, "texts": "请求操作无效", "order": order_acts});
            return c.json({"flags": 0, "texts": "执行操作成功", "order": order_acts});
        }
    } catch (error) {
        return c.json({"flags": 3, "texts": "请求数据无效: " + error}, 400);
    }
})

// 用户注册 ###############################################################################
app.get('/setup/', async (c: Context): Promise<Response> => {
    return users.userRegs(c);
})

// 用户登录 ###############################################################################
app.get('/login/', async (c: Context): Promise<Response> => {
    return users.userPost(c)
})

// 检查登录 ###############################################################################
app.use('/check/', async (c: Context): Promise<Response> => {
    if (!await users.userAuth(c)) return c.json({"flags": 2, "texts": "用户尚未登录"}, 401);
    let user_email: string | undefined = local.getCookie(c, 'mail');
    // 附带 is_admin / quota 字段便于前端控制菜单与操作
    let is_admin = 0;
    let quota = -1;
    try {
        const dao = await (await import("./db")).ensureDao(c.env as any);
        const u = await dao.getUser(user_email ?? "");
        if (u) {
            is_admin = Number(u.is_admin ?? 0);
            quota = Number(u.quota ?? -1);
        }
    } catch {/* ignore, 保持默认 */}
    return c.json({"flags": 0, "texts": user_email, "is_admin": is_admin, "quota": quota}, 200);
})

// 退出登录 ###############################################################################
app.get('/exits/', async (c: Context): Promise<Response> => {
    return users.userExit(c)
})

// 定时任务 ###############################################################################
app.get('/tests/', async (c: Context): Promise<Response> => {
    return c.json({flags: 9, texts: '请使用受认证的 /cron 维护入口'}, 410);
})

// 定时任务 ###############################################################################
app.get('/tasks/', async (c: Context): Promise<Response> => {
    return c.json({flags: 9, texts: '请使用受认证的 /cron 维护入口'}, 410);
})

// 更新密钥 ###############################################################################
app.use('/acmes/', async (c: Context): Promise<Response> => {
    if (c.req.method !== 'POST') return c.json({"flags": 1, "texts": "请求方式无效"}, 400);
    if (!await users.userAuth(c)) return c.json({"flags": 2, "texts": "用户尚未登录"}, 401);
    let user_email: string | undefined = local.getCookie(c, 'mail')
    let privateKey: string = <string>(await c.req.json())['privateKey'];
    await saves.updateDB(c.env.DB_CF, "Users", {keys: privateKey}, {mail: user_email})
    return c.json({"flags": 0, "texts": "更新ACME密钥成功"}, 200)
})

// 删除账号 ###############################################################################
app.use('/erase/', async (c: Context): Promise<Response> => {
    if (c.req.method !== 'POST') return c.json({"flags": 1, "texts": "请求方式无效"}, 400);
    if (!await users.userAuth(c)) return c.json({"flags": 2, "texts": "用户尚未登录"}, 401);
    let user_email: string | undefined = local.getCookie(c, 'mail')
    let post_email: string = <string>(await c.req.json())['email'];
    if (user_email != post_email) return c.json({"flags": 5, "texts": "用户邮箱无效"}, 403);
    await saves.deleteDB(c.env.DB_CF, "Apply", {mail: user_email})
    await saves.deleteDB(c.env.DB_CF, "Users", {mail: user_email})
    return c.json({"flags": 0, "texts": "删除账号成功"}, 200)
})

// 更新密钥 ###############################################################################
app.use('/token/', async (c: Context): Promise<Response> => {
    if (c.req.method !== 'POST') return c.json({"flags": 1, "texts": "请求方式无效"}, 400);
    if (!await users.userAuth(c)) return c.json({"flags": 2, "texts": "用户尚未登录"}, 401);
    let user_email: string | undefined = local.getCookie(c, 'mail')
    let apis_token: string = <string>(await c.req.json())['privateKey'];
    await saves.updateDB(c.env.DB_CF, "Users", {apis: apis_token}, {mail: user_email})
    return c.json({"flags": 0, "texts": "更新API TOKEN密钥成功"}, 200)
})

// 定时任务 ###############################################################################
app.use('/clean/', async (c: Context): Promise<Response> => {
    return c.json({flags: 9, texts: '清理已由后台自动维护'}, 410);
})

// 获取证书 ###############################################################################
app.use('/certs/:uuid', async (c: Context): Promise<any> => {
    const cert_uuid: string | undefined = c.req.param('uuid');
    const api_token: string | undefined = c.req.query('keys');
    if (cert_uuid === undefined || api_token === undefined)
        return c.json({"flags": 1, "texts": "证书订单ID或密钥无效"}, 400);
    const now_order: any = await saves.selectDB(
        c.env.DB_CF, "Apply", {uuid: {value: cert_uuid}});
    if (now_order.length == 0)
        return c.json({"flags": 3, "texts": "证书订单ID或密钥无效"}, 400);
    const now_email: string = now_order[0]['mail'];
    const now_users: any = await saves.selectDB(
        c.env.DB_CF, "Users", {mail: {value: now_email}});
    if (now_users.length == 0 || now_users[0]['apis'] != api_token)
        return c.json({"flags": 3, "texts": "证书订单ID或密钥无效"}, 400);
    if (now_order[0].cert.length == 0 || now_order[0].keys.length == 0)
        return c.json({"flags": 4, "texts": "此订单未完成或无密钥"}, 400);
    return c.json({
        "flags": 0, "texts": "证书密钥信息获取成功",
        "cert": now_order[0].cert, "keys": now_order[0].keys
    }, 200)
})


// 默认导出 ###############################################################################
export default app;