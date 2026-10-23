/**
 * Tencent Cloud API client (TC3-HMAC-SHA256).
 * -------------------------------------------------------------------------
 * Only the request signing and error unwrapping needed by the edge certificate
 * deployment flow is implemented here. Two products are used:
 *
 *   ssl (2019-12-05)  -> UploadCertificate      上传自有证书，返回 CertId
 *   teo (2022-09-01)  -> DescribeZones          站点 ID 自动发现
 *                        DescribeAccelerationDomains 加速域名自动发现
 *                        ModifyHostsCertificate     把证书部署到加速域名
 *
 * Reference: https://cloud.tencent.com/document/api/1552/80724
 */

const encoder = new TextEncoder();

/** Uint8Array -> 小写十六进制 */
function bytesToHex(buffer: ArrayBuffer | Uint8Array): string {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let out = "";
    for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
    return out;
}

/** SHA-256 摘要（小写十六进制） */
export async function sha256Hex(data: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(data));
    return bytesToHex(digest);
}

/** HMAC-SHA256，返回原始字节 */
export async function hmacSha256(
    key: ArrayBuffer | Uint8Array, data: string,
): Promise<ArrayBuffer> {
    const imported = await crypto.subtle.importKey(
        "raw", key as any, {name: "HMAC", hash: "SHA-256"}, false, ["sign"]);
    return await crypto.subtle.sign("HMAC", imported, encoder.encode(data));
}

/** 生成随机十六进制串（nonce 用） */
export function randomHex(bytes: number = 16): string {
    const buf = new Uint8Array(bytes);
    crypto.getRandomValues(buf);
    return bytesToHex(buf);
}

export interface TcCredentials {
    secretId: string;
    secretKey: string;
    region?: string;
}

export interface TcCallOptions {
    /** 产品服务名，如 teo / ssl */
    service: string;
    /** 接口域名，如 teo.tencentcloudapi.com */
    host: string;
    /** API 版本，如 2022-09-01 */
    version: string;
    /** 接口名，如 ModifyHostsCertificate */
    action: string;
    /** 请求参数（不含公共参数） */
    params?: Record<string, any>;
    /** 地域，可空 */
    region?: string;
    /** 请求超时（毫秒） */
    timeout?: number;
}

/**
 * 调用一次腾讯云 API。
 * 失败（HTTP 非 2xx 或 Response.Error 非空）时抛出带可读信息的 Error。
 */
export async function tcCall(
    cred: TcCredentials, opt: TcCallOptions,
): Promise<Record<string, any>> {
    if (!cred.secretId || !cred.secretKey) {
        throw new Error("腾讯云 SecretId / SecretKey 未配置");
    }
    const payload = JSON.stringify(opt.params ?? {});
    const timestamp = Math.floor(Date.now() / 1000);
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);

    const canonicalHeaders =
        "content-type:application/json; charset=utf-8\n" + `host:${opt.host}\n`;
    const signedHeaders = "content-type;host";
    const hashedPayload = await sha256Hex(payload);
    const canonicalRequest = [
        "POST", "/", "", canonicalHeaders, signedHeaders, hashedPayload,
    ].join("\n");

    const credentialScope = `${date}/${opt.service}/tc3_request`;
    const stringToSign = [
        "TC3-HMAC-SHA256", String(timestamp), credentialScope,
        await sha256Hex(canonicalRequest),
    ].join("\n");

    const secretDate = await hmacSha256(encoder.encode("TC3" + cred.secretKey), date);
    const secretService = await hmacSha256(secretDate, opt.service);
    const secretSigning = await hmacSha256(secretService, "tc3_request");
    const signature = bytesToHex(await hmacSha256(secretSigning, stringToSign));

    const authorization =
        `TC3-HMAC-SHA256 Credential=${cred.secretId}/${credentialScope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const headers: Record<string, string> = {
        "Authorization": authorization,
        "Content-Type": "application/json; charset=utf-8",
        "X-TC-Action": opt.action,
        "X-TC-Timestamp": String(timestamp),
        "X-TC-Version": opt.version,
    };
    const region = opt.region ?? cred.region ?? "";
    if (region) headers["X-TC-Region"] = region;

    // host 已参与签名计算，但由 fetch 依据 URL 自动生成，不能手动设置
    const resp = await fetch(`https://${opt.host}/`, {
        method: "POST",
        headers,
        body: payload,
        signal: AbortSignal.timeout(opt.timeout ?? 20000),
    });
    const text = await resp.text();
    let data: any = null;
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error(`腾讯云返回非 JSON (HTTP ${resp.status}): ${text.slice(0, 300)}`);
    }
    const body = data?.Response ?? data;
    const err = body?.Error;
    if (err) {
        throw new Error(`腾讯云 ${opt.action} 失败: ${err.Code ?? ""} ${err.Message ?? ""}`.trim());
    }
    if (!resp.ok) {
        throw new Error(`腾讯云 ${opt.action} HTTP ${resp.status}: ${text.slice(0, 300)}`);
    }
    return body ?? {};
}

/** EdgeOne（teo 2022-09-01） */
export function teoCall(
    cred: TcCredentials, action: string, params?: Record<string, any>, timeout?: number,
): Promise<Record<string, any>> {
    return tcCall(cred, {
        service: "teo", host: "teo.tencentcloudapi.com", version: "2022-09-01",
        action, params, timeout,
    });
}

/** SSL 证书（ssl 2019-12-05） */
export function sslCall(
    cred: TcCredentials, action: string, params?: Record<string, any>, timeout?: number,
): Promise<Record<string, any>> {
    return tcCall(cred, {
        service: "ssl", host: "ssl.tencentcloudapi.com", version: "2019-12-05",
        action, params, timeout,
    });
}
