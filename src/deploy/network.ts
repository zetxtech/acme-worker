import ipaddr from "ipaddr.js";

export function publicHost(host: string): string {
    const name = host.toLowerCase().replace(/^\[|\]$/g, "");
    if (ipaddr.isValid(name)) {
        const address = ipaddr.process(name);
        if (address.range() !== "unicast") throw new Error("Private, reserved and local destinations are not supported");
        return name;
    }
    if (!/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(name)
        || /\.(localhost|local|internal|lan|home|test|invalid)$/.test(name)
        || name === "metadata.google.internal") throw new Error("A public hostname or address is required");
    return name;
}

export function publicHttps(value: string): URL {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search
        || url.port && url.port !== "443") throw new Error("Use HTTPS on port 443 without URL credentials, query or fragment");
    publicHost(url.hostname);
    return url;
}

export async function assertPublicResolution(host: string): Promise<void> {
    const name = publicHost(host);
    if (ipaddr.isValid(name)) return;
    let count = 0;
    for (const type of ["A", "AAAA"]) {
        const response = await fetch(`https://cloudflare-dns.com/dns-query?${new URLSearchParams({name, type})}`, {
            headers: {Accept: "application/dns-json"}, signal: AbortSignal.timeout(5000), redirect: "error",
        });
        if (!response.ok) throw new Error("Destination DNS lookup failed");
        const data: any = await response.json();
        for (const answer of data.Answer ?? []) {
            if (answer.type === 1 || answer.type === 28) { publicHost(answer.data); count++; }
        }
    }
    if (!count) throw new Error("Destination has no public address");
}

export async function boundedResponse(response: Response, maximum = 65536): Promise<void> {
    if (Number(response.headers.get("Content-Length")) > maximum) {
        await response.body?.cancel();
        throw new Error("Remote response exceeds size limit");
    }
    const reader = response.body?.getReader();
    if (!reader) return;
    let size = 0;
    try {
        for (;;) {
            const {done, value} = await reader.read();
            if (done) return;
            size += value.byteLength;
            if (size > maximum) throw new Error("Remote response exceeds size limit");
        }
    } finally { await reader.cancel(); }
}

export async function readBoundedJson(response: Response, maximum = 65536): Promise<any> {
    if (Number(response.headers.get("Content-Length")) > maximum) {
        await response.body?.cancel();
        throw new Error("Remote response exceeds size limit");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Remote response is empty");
    const decoder = new TextDecoder();
    let size = 0;
    let text = "";
    try {
        for (;;) {
            const {done, value} = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maximum) throw new Error("Remote response exceeds size limit");
            text += decoder.decode(value, {stream: true});
        }
        text += decoder.decode();
        try { return JSON.parse(text); }
        catch { throw new Error("Remote response is not valid JSON"); }
    } finally { await reader.cancel().catch(() => {}); }
}