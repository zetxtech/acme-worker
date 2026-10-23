import * as acme from "acme-client";
import {Buffer} from "node:buffer";
import catalog from "../dns-providers.generated.json";

(globalThis as any).Buffer ??= Buffer;

export interface ShardManifest {
    id: string;
    runtimeVersion: string;
    buildHash: string;
    providers: string[];
    verifiedProviders: string[];
    wasmBytes: number;
    gzipBytes: number;
}

async function boundedJson(response: Response, max = 65536) {
    if (!response.ok || !response.body) throw new Error("Upstream request failed");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (true) {
            const {done, value} = await reader.read();
            if (done) break;
            total += value.length;
            if (total > max) throw new Error("Response too large");
            chunks.push(value);
        }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder().decode(bytes));
}

export async function propagated(records: {fqdn: string; value: string}[], request: typeof fetch = fetch, stage = (_value: string) => {}) {
    for (const record of records) {
        for (const resolver of ["https://cloudflare-dns.com/dns-query", "https://dns.google/resolve"]) {
            stage("doh_request");
            const response = await request(`${resolver}?${new URLSearchParams({name: record.fqdn, type: "TXT"})}`, {
                headers: {Accept: "application/dns-json"}, redirect: "manual", signal: AbortSignal.timeout(4000),
            });
            stage("doh_decode");
            const data = await boundedJson(response);
            stage("doh_match");
            if (!data.Answer?.some((answer: any) => answer.type === 16 &&
                (String(answer.data).match(/"([^"\\]*(?:\\.[^"\\]*)*)"/g) ?? []).map((part: string) => JSON.parse(part)).join("") === record.value)) return false;
        }
    }
    return true;
}

export async function completeAcme(input: any, records: {fqdn: string; value: string}[], create = (options: any) => new acme.Client(options), request: typeof fetch = fetch, stage = (_value: string) => {}) {
    stage("propagation");
    const deadline = Date.now() + 85000;
    let ready = false;
    for (let attempt = 0; attempt < 8 && Date.now() < deadline; attempt++) {
        if (await propagated(records, request, stage)) { ready = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    if (!ready) throw new Error("DNS propagation timed out");
    if (input.operation === "test") return {tested: true};
    stage("acme_client");
    const client = create({...input.account, backoffAttempts: 5, backoffMin: 1000, backoffMax: 4000});
    for (const authorization of input.authorizations) {
        stage("acme_validation");
        if (authorization.status === "valid") continue;
        const challenge = authorization.challenges.find((item: any) => item.type === "dns-01");
        if (!challenge) throw new Error("DNS challenge missing");
        await client.completeChallenge(challenge);
        let valid = false;
        for (let attempt = 0; attempt < 10 && Date.now() < deadline; attempt++) {
            const states = await client.getAuthorizations({...input.order, authorizations: input.authorizations.map((item: any) => item.url)});
            const state = states.find((item: any) => item.url === authorization.url);
            if (!state) throw new Error("CA authorization missing");
            if (state.status === "valid") { valid = true; break; }
            if (["invalid", "deactivated", "expired", "revoked"].includes(state.status)) throw new Error("CA validation failed");
            await new Promise((resolve) => setTimeout(resolve, 1500));
        }
        if (!valid) throw new Error("CA validation timed out");
    }
    stage("acme_finalize");
    let order = await client.getOrder(input.order);
    if (order.status === "ready") order = await client.finalizeOrder(order, Buffer.from(input.csr));
    for (let attempt = 0; attempt < 10 && Date.now() < deadline; attempt++) {
        if (order.status === "valid") return {order, certificate: await client.getCertificate(order)};
        if (order.status === "invalid") throw new Error("CA issuance failed");
        await new Promise((resolve) => setTimeout(resolve, 1500));
        order = await client.getOrder(order);
    }
    throw new Error("CA issuance timed out");
}

export function createShard(module: WebAssembly.Module, manifest: ShardManifest) {
    let active = false;
    return {
        async fetch(request: Request, env: {LEGO_LOCAL_FIXTURE?: string}) {
            if (new URL(request.url).pathname === "/health") return Response.json(manifest);
            if (request.method !== "POST") return new Response(null, {status: 405});
            if (active) return Response.json({error: "Shard busy"}, {status: 429});
            active = true;
            const host = globalThis as any;
            const originalFetch = host.fetch;
            let input: any;
            let subrequests = 0;
            try {
                input = await boundedJson(new Response(request.body), 262144);
                if (!Array.isArray(input.groups) || input.groups.length > 20) throw new Error("Invalid groups");
                for (const group of input.groups) {
                    const provider = catalog.providers.find((entry) => entry.id === group.provider);
                    if (!provider || !manifest.providers.includes(group.provider) || !Array.isArray(group.challenges) || group.challenges.length > 20) throw new Error("Unavailable provider");
                    const allowed = [...provider.credentials, ...provider.options].filter((field: any) => !field.blocked).map((field) => field.name);
                    if (Object.entries(group.env).some(([name, value]) => !allowed.includes(name) || typeof value !== "string" || value.length > 32000)) throw new Error("Invalid provider environment");
                    if (!Array.isArray(group.zones) || !group.zones.length || group.zones.some((zone: any) => typeof zone !== "string" || !/^(?:[a-z0-9-]+\.)+[a-z0-9-]+$/.test(zone))) throw new Error("Explicit zone scope required");
                }
                if (input.groups.reduce((count: number, group: any) => count + group.challenges.length, 0) > 2) throw new Error("Too many challenges");
                host.legoPhase = "present";
                const deadline = AbortSignal.timeout(120000);
                host.fetch = async (url: RequestInfo | URL, options: RequestInit = {}) => {
                    const cleanup = host.legoPhase === "cleanup";
                    if (++subrequests > (cleanup ? 50 : 38)) throw new Error("Request budget exhausted");
                    const signal = options.signal ?? (url instanceof Request ? url.signal : undefined);
                    const signals = [AbortSignal.timeout(cleanup ? 8000 : 12000), ...(cleanup ? [] : [deadline]), ...(signal ? [signal] : [])];
                    const response = await originalFetch(url, {...options, redirect: "manual", signal: AbortSignal.any(signals)});
                    if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new Error("Redirect refused"); }
                    if (!response.body) return response;
                    const reader = response.body.getReader();
                    const chunks: Uint8Array[] = [];
                    let size = 0;
                    try {
                        for (;;) {
                            const {done, value} = await reader.read();
                            if (done) break;
                            size += value.length;
                            if (size > 262144) throw new Error("Upstream response too large");
                            chunks.push(value);
                        }
                    } finally { await reader.cancel().catch(() => {}); }
                    const bytes = new Uint8Array(size);
                    let offset = 0;
                    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
                    return new Response(bytes, {status: response.status, statusText: response.statusText, headers: response.headers});
                };
                let outcome: any;
                let validationStage = "not_started";
                let validationFailure = "none";
                host.legoInput = JSON.stringify({groups: input.groups});
                host.legoValidate = async (records: string) => {
                    try { outcome = await completeAcme(input, JSON.parse(records), undefined, undefined, (value) => { validationStage = value; }); }
                    catch (error) {
                        const message = error instanceof Error ? error.message : "";
                        validationFailure = /AbortSignal/.test(message) ? "abort_signal" : /Illegal invocation/.test(message) ? "receiver"
                            : /is not defined/.test(message) ? "missing_global" : /not a function/.test(message) ? "not_callable"
                                : /I\/O|different request/.test(message) ? "io_context" : /not a constructor/.test(message) ? "constructor" : "upstream_failure";
                        throw new Error("Validation failed");
                    }
                };
                delete host.legoResult;
                const go = new host.Go();
                go.argv = ["lego-provider-shard"];
                go.env = {};
                const instance = await WebAssembly.instantiate(module, go.importObject);
                await go.run(instance);
                const result = JSON.parse(host.legoResult || "{}");
                const memoryBytes = (instance.exports.mem as WebAssembly.Memory)?.buffer.byteLength ?? 0;
                return Response.json({...result, validationStage, validationFailure, runtimeMetrics: {memoryBytes, subrequests}, ...(result.ok ? outcome : {})}, {status: result.ok && result.cleanupOk ? 200 : 502});
            } catch { return Response.json({ok: false, error: "Provider execution failed"}, {status: 502}); }
            finally {
                input = undefined;
                delete host.legoInput;
                delete host.legoResult;
                delete host.legoValidate;
                delete host.legoPhase;
                host.fetch = originalFetch;
                active = false;
            }
        },
    };
}