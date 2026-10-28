/**
 * Alibaba Cloud OpenAPI client (ACS3-HMAC-SHA256 / "V3").
 * -------------------------------------------------------------------------
 * Used for ESA (边缘安全加速, product code `esa`, version 2024-09-10):
 *
 *   ListSites        站点 ID 自动发现
 *   SetCertificate   上传自定义证书到站点边缘证书（type=upload）
 *
 * Signing follows the official V3 specification: all API parameters travel in
 * the query string while Action/Version are carried by the x-acs-* headers.
 *
 * Reference: https://help.aliyun.com/zh/sdk/product-overview/v3-request-structure-and-signature
 */

import {hmacSha256, randomHex, sha256Hex} from "./tencent";
import {esaEndpoint, type CloudMarket} from './endpoints';
import {CloudHttpError} from './http-error';

const encoder = new TextEncoder();

/** Uint8Array -> 小写十六进制 */
function bytesToHex(buffer: ArrayBuffer | Uint8Array): string {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let out = "";
    for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
    return out;
}

/**
 * RFC3986 百分号编码（大写十六进制）。
 * 仅保留 A-Z a-z 0-9 - _ . ~ ，其余一律编码，避免 + * 等字符在签名与
 * 实际传输之间产生歧义。
 */
export function rfc3986(value: string): string {
    const bytes = encoder.encode(value);
    let out = "";
    for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        const ch = String.fromCharCode(b);
        if ((b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a) ||
            (b >= 0x30 && b <= 0x39) ||
            ch === "-" || ch === "_" || ch === "." || ch === "~") {
            out += ch;
        } else {
            out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
        }
    }
    return out;
}

/** 规范化查询字符串：参数名升序、逐项 RFC3986 编码 */
export function canonicalQueryString(params: Record<string, any>): string {
    const keys = Object.keys(params).filter((k) => params[k] !== undefined && params[k] !== null);
    keys.sort();
    return keys
        .map((k) => `${rfc3986(k)}=${rfc3986(String(params[k]))}`)
        .join("&");
}

export interface AliCredentials {
    market?: CloudMarket;
    accessKeyId: string;
    accessKeySecret: string;
    /** 接口域名，默认 esa.aliyuncs.com */
    endpoint?: string;
}

export interface AliCallOptions {
    /** 接口名，如 SetCertificate */
    action: string;
    /** API 版本，如 2024-09-10 */
    version: string;
    /** 查询参数 */
    params?: Record<string, any>;
    /** 请求超时（毫秒） */
    timeout?: number;
}

/** ISO8601 秒级 UTC 时间戳，形如 2023-10-26T10:22:32Z */
function acsDate(): string {
    return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * 调用一次阿里云 OpenAPI（V3 签名）。
 * 失败时抛出带 Code/Message 的 Error。
 */
export async function esaCall(
    cred: AliCredentials, opt: AliCallOptions,
): Promise<Record<string, any>> {
    if (!cred.accessKeyId || !cred.accessKeySecret) {
        throw new Error("阿里云 AccessKeyId / AccessKeySecret 未配置");
    }
    const host = esaEndpoint(cred.market, cred.endpoint);
    const query = canonicalQueryString(opt.params ?? {});
    const hashedPayload = await sha256Hex("");

    const headers: Record<string, string> = {
        "host": host,
        "x-acs-action": opt.action,
        "x-acs-version": opt.version,
        "x-acs-date": acsDate(),
        "x-acs-signature-nonce": randomHex(16),
        "x-acs-content-sha256": hashedPayload,
    };

    const signedNames = Object.keys(headers).map((k) => k.toLowerCase()).sort();
    const canonicalHeaders = signedNames
        .map((k) => `${k}:${headers[k].trim()}\n`)
        .join("");
    const signedHeaders = signedNames.join(";");

    const canonicalRequest = [
        "POST", "/", query, canonicalHeaders, signedHeaders, hashedPayload,
    ].join("\n");

    const stringToSign = "ACS3-HMAC-SHA256\n" + (await sha256Hex(canonicalRequest));
    const signature = bytesToHex(
        await hmacSha256(encoder.encode(cred.accessKeySecret), stringToSign));

    const authorization =
        `ACS3-HMAC-SHA256 Credential=${cred.accessKeyId},` +
        `SignedHeaders=${signedHeaders},Signature=${signature}`;

    const url = `https://${host}/${query ? "?" + query : ""}`;
    // host 参与签名计算，但由 fetch 依据 URL 自动生成，不能手动设置
    const requestHeaders: Record<string, string> = {
        "x-acs-action": headers["x-acs-action"],
        "x-acs-version": headers["x-acs-version"],
        "x-acs-date": headers["x-acs-date"],
        "x-acs-signature-nonce": headers["x-acs-signature-nonce"],
        "x-acs-content-sha256": headers["x-acs-content-sha256"],
        "Authorization": authorization,
    };
    let resp: Response;
    try { resp = await fetch(url, {
        method: "POST",
        headers: requestHeaders,
        signal: AbortSignal.timeout(opt.timeout ?? 20000),
        redirect: 'manual',
    }); } catch (error) {
        throw new CloudHttpError('阿里云请求未完成，请检查账号站点和连接', {url, action: opt.action, parameters: opt.params},
            {status: 0, statusText: 'Network error', body: (error as Error).message}, [cred.accessKeyId, cred.accessKeySecret]);
    }
    const text = await resp.text();
    let data: any = null;
    try {
        data = JSON.parse(text);
    } catch {
        const code = text.match(/error code:\s*(\d+)/i)?.[1];
        throw new CloudHttpError(`阿里云返回非 JSON (HTTP ${resp.status})${code ? `: error code: ${code}` : ''}`, {url, action: opt.action, parameters: opt.params},
            {status: resp.status, statusText: resp.statusText, body: text, requestId: resp.headers.get('cf-ray') || undefined}, [cred.accessKeyId, cred.accessKeySecret]);
    }
    if (!resp.ok || (data?.Code && data.Code !== "200")) {
        throw new CloudHttpError(`阿里云 ${opt.action} 失败: ${data?.Code ?? resp.status} ${data?.Message ?? ""}`.trim(),
            {url, action: opt.action, parameters: opt.params}, {status: resp.status, statusText: resp.statusText, body: text, requestId: data?.RequestId},
            [cred.accessKeyId, cred.accessKeySecret]);
    }
    return data ?? {};
}
