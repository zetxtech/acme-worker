import {hmacSha256} from "../edge/tencent";
import {assertPublicResolution, boundedResponse, publicHttps} from "./network";

export async function deployHook(config: Record<string, any>, secrets: Record<string, string>, payload: {
    orderId: string; version: string; domains: string[]; certificate: string; privateKey: string;
}): Promise<void> {
    const url = publicHttps(config.url);
    await assertPublicResolution(url.hostname);
    const method = config.method ?? "POST";
    if (!["POST", "PUT"].includes(method)) throw new Error("Hook method must be POST or PUT");
    if (!secrets.authorization && !secrets.authToken) throw new Error("Hook authentication is required");
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({event: "certificate.issued", ...payload});
    const headers: Record<string, string> = {"Content-Type": "application/json",
        Authorization: secrets.authorization || `Bearer ${secrets.authToken}`,
        "Idempotency-Key": `${payload.orderId}:${payload.version}`,
        "X-Certificate-Version": payload.version, "X-Certificate-Timestamp": timestamp};
    if (secrets.hmacSecret) {
        const signature = await hmacSha256(new TextEncoder().encode(secrets.hmacSecret), `${timestamp}.${payload.version}.${body}`);
        headers["X-Certificate-Signature"] = `sha256=${Buffer.from(signature).toString("hex")}`;
    }
    const response = await fetch(url, {method, headers, body, redirect: "error",
        signal: AbortSignal.timeout(Math.max(1000, Math.min(15000, Number(config.timeout) || 10000)))});
    await boundedResponse(response);
    if (!response.ok) throw new Error(`Certificate hook returned HTTP ${response.status}`);
}