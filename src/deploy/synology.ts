import {assertPublicResolution, publicHost} from "./network";
import {CloudHttpError} from "../edge/http-error";

/**
 * Synology DSM certificate deployment through the DSM Web API.
 *
 * This is the same interface the DSM control panel uses, and the approach taken by
 * the acme.sh synology_dsm deploy hook: query the API paths, log in with
 * SYNO.API.Auth (sid + SynoToken), list SYNO.Core.Certificate.CRT, import the
 * certificate through SYNO.Core.Certificate import, then log out.
 */

export const SYNOLOGY_LIST_API = "SYNO.Core.Certificate.CRT";
export const SYNOLOGY_IMPORT_API = "SYNO.Core.Certificate";

const accountPattern = /^[A-Za-z0-9._@-]{1,64}$/;
const pathPattern = /^[A-Za-z0-9._-]{1,64}$/;

const loginErrors: Record<number, string> = {
    400: "群晖 DSM 账号或密码错误",
    401: "群晖 DSM 账号不存在",
    403: "该群晖账号启用了两步验证，请在资源中填写动态验证码，或改用未启用两步验证的管理员账号",
    404: "群晖两步验证码错误或已过期",
    406: "该群晖账号被强制要求两步验证，无法自动登录",
    408: "群晖账号密码已过期，需要在 DSM 中修改",
    409: "群晖账号密码必须修改，无法自动登录",
    410: "群晖账号密码已过期或需要修改",
    105: "该群晖账号不是管理员，无法管理证书",
};

export interface SynologyCertificate {
    id?: string;
    desc?: string;
    is_default?: boolean;
}

interface SynologySession {
    origin: string;
    authPath: string;
    authVersion: string;
    sid: string;
    token: string;
    credentials: string[];
}

export function synologyBaseUrl(value: unknown): URL {
    const raw = typeof value === "string" ? value.trim() : "";
    let url: URL;
    try { url = new URL(raw); }
    catch { throw new Error("A Synology DSM address such as https://nas.example.com:5001 is required"); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash
        || (url.pathname !== "/" && url.pathname !== "")) {
        throw new Error("The Synology DSM address must be a plain address without credentials, path or query");
    }
    publicHost(url.hostname);
    if (url.port && (Number(url.port) < 1 || Number(url.port) > 65535)) {
        throw new Error("The Synology DSM port must be between 1 and 65535");
    }
    return url;
}

export function validateSynologyConfig(config: Record<string, any>, secrets: Record<string, string>): void {
    synologyBaseUrl(config.url);
    if (!accountPattern.test(String(config.account ?? ""))) throw new Error("A Synology DSM administrator account is required");
    const description = String(config.certificate ?? "").trim();
    if (!description || description.length > 100 || /[\\\r\n]/.test(description)) {
        throw new Error("A Synology certificate description without backslashes or line breaks is required");
    }
    for (const field of ["create", "makeDefault"]) {
        if (config[field] !== undefined && typeof config[field] !== "boolean") throw new Error("Invalid Synology option");
    }
    if (config.timeout !== undefined && (!Number.isInteger(Number(config.timeout))
        || Number(config.timeout) < 5000 || Number(config.timeout) > 60000)) {
        throw new Error("The Synology timeout must be between 5000 and 60000 milliseconds");
    }
    if (!secrets.password) throw new Error("A Synology DSM password is required");
    if (secrets.otp && !/^\d{6}$/.test(secrets.otp)) throw new Error("The Synology one-time password must contain six digits");
}

// The DSM import expects the leaf certificate in cert and the remaining chain in inter_cert.
export function splitCertificateChain(chain: string): {leaf: string; rest: string} {
    const match = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/.exec(chain);
    if (!match) throw new Error("Invalid certificate chain");
    return {leaf: `${match[0]}\n`, rest: chain.slice(match.index + match[0].length).trim()};
}

function dsmError(payload: any): Error | undefined {
    if (!payload || payload.success !== false) return undefined;
    const code = Number(payload?.error?.code);
    return new Error(loginErrors[code] ?? `群晖接口返回错误码 ${Number.isFinite(code) ? code : "unknown"}`);
}

async function dsmJson(url: string, init: RequestInit & {timeout: number},
    context: {action: string; credentials: string[]}): Promise<any> {
    const {timeout, ...options} = init;
    let response: Response;
    try {
        response = await fetch(url, {...options, redirect: "error", signal: AbortSignal.timeout(timeout)});
    } catch (error) {
        const reason = (error as Error)?.name === "TimeoutError" ? "请求超时" : "无法建立连接";
        throw new Error(`连接群晖 DSM 失败（${context.action}）：${reason}。请确认地址可从公网访问，且 DSM 使用受信任的证书（自签名证书会被拒绝）`);
    }
    const raw = await response.text();
    let payload: any;
    try { payload = JSON.parse(raw); }
    catch { payload = undefined; }
    if (payload === undefined) {
        throw new CloudHttpError(`群晖 DSM 未返回可识别的响应（${context.action}）`, {url, action: context.action},
            {status: response.status, statusText: response.statusText, body: raw.slice(0, 4096)}, context.credentials);
    }
    if (!response.ok) {
        throw new CloudHttpError(`群晖 DSM 返回 HTTP ${response.status}（${context.action}）`, {url, action: context.action},
            {status: response.status, statusText: response.statusText, body: raw.slice(0, 4096)}, context.credentials);
    }
    const failure = dsmError(payload);
    if (failure) throw failure;
    return payload;
}

async function synologyLogin(base: URL, account: string, password: string, otp: string | undefined, timeout: number): Promise<SynologySession> {
    const discovery = await dsmJson(`${base.origin}/webapi/query.cgi?${new URLSearchParams({api: "SYNO.API.Info",
        version: "1", method: "query", query: "SYNO.API.Auth"})}`, {method: "GET", timeout}, {action: "查询 DSM 接口", credentials: []});
    const info = discovery?.data?.["SYNO.API.Auth"];
    const authPath = typeof info?.path === "string" && pathPattern.test(info.path) ? info.path : "auth.cgi";
    const authVersion = String(Number.isInteger(info?.maxVersion) ? info.maxVersion : 6);
    const body = new URLSearchParams({api: "SYNO.API.Auth", version: authVersion, method: "login", format: "sid",
        account, passwd: password, enable_syno_token: "yes"});
    if (otp) {
        body.set("otp_code", otp);
        body.set("device_name", "CertHub");
        body.set("enable_device_token", "yes");
    }
    const payload = await dsmJson(`${base.origin}/webapi/${authPath}?enable_syno_token=yes`,
        {method: "POST", headers: {"Content-Type": "application/x-www-form-urlencoded"}, body, timeout},
        {action: "登录 DSM", credentials: [password, otp ?? ""]});
    const sid = payload?.data?.sid;
    const token = payload?.data?.synotoken;
    if (typeof sid !== "string" || !sid || typeof token !== "string" || !token) {
        throw new Error("群晖 DSM 登录未返回会话标识，请确认账号为管理员且未强制两步验证");
    }
    return {origin: base.origin, authPath, authVersion, sid, token, credentials: [password, otp ?? ""]};
}

async function synologyCertificates(session: SynologySession, timeout: number): Promise<SynologyCertificate[]> {
    const payload = await dsmJson(`${session.origin}/webapi/entry.cgi`, {method: "POST", timeout,
        headers: {"Content-Type": "application/x-www-form-urlencoded", "X-SYNO-TOKEN": session.token},
        body: new URLSearchParams({api: SYNOLOGY_LIST_API, version: "1", method: "list", _sid: session.sid})},
        {action: "读取 DSM 证书列表", credentials: session.credentials});
    const list = payload?.data?.certificates;
    if (!Array.isArray(list)) return [];
    return list.filter((entry: any) => entry && typeof entry === "object").map((entry: any) => ({
        id: typeof entry.id === "string" ? entry.id : undefined,
        desc: typeof entry.desc === "string" ? entry.desc : undefined,
        is_default: entry.is_default === true}));
}

async function synologyImport(session: SynologySession, certificate: string, privateKey: string,
    options: {id: string; desc: string; asDefault: boolean; timeout: number}): Promise<boolean> {
    const {leaf, rest} = splitCertificateChain(certificate);
    const form = new FormData();
    form.append("key", new Blob([privateKey], {type: "application/octet-stream"}), "privkey.pem");
    form.append("cert", new Blob([leaf], {type: "application/octet-stream"}), "cert.pem");
    if (rest) form.append("inter_cert", new Blob([`${rest}\n`], {type: "application/octet-stream"}), "chain.pem");
    form.append("id", options.id);
    form.append("desc", options.desc);
    if (options.asDefault) form.append("as_default", "true");
    const query = new URLSearchParams({api: SYNOLOGY_IMPORT_API, version: "1", method: "import",
        SynoToken: session.token, _sid: session.sid});
    const payload = await dsmJson(`${session.origin}/webapi/entry.cgi?${query}`,
        {method: "POST", headers: {"X-SYNO-TOKEN": session.token}, body: form, timeout: options.timeout},
        {action: "导入 DSM 证书", credentials: session.credentials});
    return payload?.data?.restart_httpd === true;
}

async function synologyLogout(session: SynologySession, timeout: number): Promise<void> {
    const query = new URLSearchParams({api: "SYNO.API.Auth", version: session.authVersion, method: "logout", _sid: session.sid});
    await dsmJson(`${session.origin}/webapi/${session.authPath}?${query}`,
        {method: "GET", headers: {"X-SYNO-TOKEN": session.token}, timeout},
        {action: "退出 DSM 会话", credentials: session.credentials});
}

export async function deploySynology(config: Record<string, any>, secrets: Record<string, string>,
    artifact: {certificate: string; privateKey: string}): Promise<{detail: string}> {
    validateSynologyConfig(config, secrets);
    const base = synologyBaseUrl(config.url);
    await assertPublicResolution(base.hostname);
    const timeout = Math.max(5000, Math.min(60000, Number(config.timeout) || 25000));
    const description = String(config.certificate).trim();
    let session: SynologySession | undefined;
    try {
        session = await synologyLogin(base, String(config.account), secrets.password, secrets.otp || undefined, timeout);
        const certificates = await synologyCertificates(session, timeout);
        const existing = certificates.find((entry) => entry.desc === description);
        if (existing && !existing.id) throw new Error(`无法读取群晖证书“${description}”的标识，请在 DSM 中检查该证书`);
        if (!existing && config.create === false) {
            throw new Error(`DSM 中不存在描述为“${description}”的证书；请启用“不存在时新建”，或先在 DSM 控制面板中创建同名证书`);
        }
        const asDefault = config.makeDefault === true || existing?.is_default === true;
        const restarted = await synologyImport(session, artifact.certificate, artifact.privateKey,
            {id: existing?.id ?? "", desc: description, asDefault, timeout});
        const action = existing ? `已更新群晖 DSM 证书“${description}”` : `已在群晖 DSM 新建证书“${description}”`;
        return {detail: `${action}${asDefault ? "，已设为默认证书" : ""}${restarted ? "，HTTP 服务已重新加载" : ""}`};
    } finally {
        if (session) await synologyLogout(session, timeout).catch(() => {});
    }
}

export async function testSynology(config: Record<string, any>, secrets: Record<string, string>): Promise<{detail: string}> {
    validateSynologyConfig(config, secrets);
    const base = synologyBaseUrl(config.url);
    await assertPublicResolution(base.hostname);
    const timeout = Math.max(5000, Math.min(60000, Number(config.timeout) || 25000));
    const description = String(config.certificate).trim();
    let session: SynologySession | undefined;
    try {
        session = await synologyLogin(base, String(config.account), secrets.password, secrets.otp || undefined, timeout);
        const certificates = await synologyCertificates(session, timeout);
        const existing = certificates.find((entry) => entry.desc === description);
        return {detail: `已登录群晖 DSM（共 ${certificates.length} 张证书）；${existing
            ? `已找到证书“${description}”，部署时将更新它` : `尚未创建证书“${description}”，部署时将新建`}`};
    } finally {
        if (session) await synologyLogout(session, timeout).catch(() => {});
    }
}
