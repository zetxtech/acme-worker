import {isIP} from "node:net";
import {sha256Hex} from "./edge/tencent";

export const CA_DEFINITIONS = [
    {id: "lets-encrypt", name: "Let's Encrypt", prefix: "", pricing: "free", wildcard: true, directories: []},
    {id: "google-trust", name: "Google Public CA", prefix: "GTS", pricing: "free", wildcard: true,
        directories: ["https://dv.acme-v02.api.pki.goog/directory"]},
    {id: "zeroca-trust", name: "ZeroSSL", prefix: "ZRO", pricing: "free-acme", wildcard: true,
        directories: ["https://acme.zerossl.com/v2/DV90"]},
    {id: "sslcom-trust", name: "SSL.com", prefix: "SSL", pricing: "product-dependent", wildcard: false,
        directories: ["https://acme.ssl.com/sslcom-dv-rsa", "https://acme.ssl.com/sslcom-dv-ecc"]},
] as const;

export interface CaCapability {
    id: string;
    name: string;
    pricing: string;
    wildcard: boolean;
    available: boolean;
    reason: "ready" | "disabled" | "missing_credentials";
    missing: string[];
    /** An ACME account already exists for the current account key; EAB is no longer needed. */
    registered: boolean;
    /** External Account Binding credentials are present and can be used for a first registration. */
    eabConfigured: boolean;
    /** EAB is present but no account is registered yet, so the next issuance consumes it. */
    needsRegistration: boolean;
}

export interface DcvCapability {
    available: boolean;
    domain: string;
    reason: "ready" | "missing_configuration";
    missing: string[];
}

export async function dcvCapability(read: (name: string) => Promise<string | null>): Promise<DcvCapability> {
    const [configuredDomain, zone, apiToken, email, legacyKey, encryptedToken, encryptionKey] = await Promise.all(
        ["DCV_AGENT", "DCV_ZONES", "DCV_API_TOKEN", "DCV_EMAIL", "DCV_TOKEN", "DCV_API_TOKEN_ENCRYPTED", "AUTOMATION_KEY"].map(read),
    );
    const domain = (configuredDomain ?? "").trim().toLowerCase().replace(/\.$/, "");
    const missing: string[] = [];
    if (!/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain) || domain.length > 253) missing.push("DCV_AGENT");
    if (!/^[a-f0-9]{32}$/i.test((zone ?? "").trim())) missing.push("DCV_ZONES");
    if (!apiToken?.trim() && !(encryptedToken?.trim() && encryptionKey?.trim()) && !(email?.trim() && legacyKey?.trim())) missing.push("DCV_API_TOKEN");
    return {available: !missing.length, domain: missing.includes("DCV_AGENT") ? "" : domain,
        reason: missing.length ? "missing_configuration" : "ready", missing};
}

export function assertDcvAvailable(capability: DcvCapability, domains: {type?: string}[]): void {
    if (!capability.available && domains.some((domain) => domain.type === "dns-auto")) {
        throw new Error("\u0044\u0043\u0056 \u6258\u7ba1\u6682\u672a\u542f\u7528\uff0c\u8bf7\u9009\u62e9\u5176\u4ed6\u9a8c\u8bc1\u65b9\u5f0f\u6216\u8054\u7cfb\u7ba1\u7406\u5458");
    }
}

export async function caCapabilities(
    read: (name: string) => Promise<string | null>,
): Promise<CaCapability[]> {
    return Promise.all(CA_DEFINITIONS.map(async (definition) => {
        const prefix = definition.prefix;
        const enabled = !prefix || ["true", "1", "yes", "on"].includes(
            (await read(`${prefix}_useIt`) ?? "").trim().toLowerCase(),
        );
        if (!prefix) {
            return {id: definition.id, name: definition.name, pricing: definition.pricing,
                wildcard: definition.wildcard, available: true, reason: "ready" as const, missing: [],
                registered: true, eabConfigured: false, needsRegistration: false};
        }
        const [keyId, keyMac, configuredKey, storedKey] = await Promise.all([
            read(`${prefix}_keyID`), read(`${prefix}_keyMC`),
            read(`${prefix}_KeyTS`), read(`ACME_KEY:${definition.id}`),
        ]);
        const accountKey = (configuredKey ?? "").trim() || (storedKey ?? "").trim();
        const eabConfigured = !!keyId?.trim() && !!keyMac?.trim();
        let registered = false;
        if (accountKey) {
            for (const directory of definition.directories) {
                const identity = `ACME_ACCOUNT:${await sha256Hex(`${directory}\n${accountKey}`)}`;
                if ((await read(identity))?.trim()) { registered = true; break; }
            }
        }
        // EAB is consumed by the first registration only. Once the account exists it stays valid,
        // so a spent or expired EAB must not disable the CA.
        const missing = !registered && !eabConfigured ? [`${prefix}_keyID`, `${prefix}_keyMC`] : [];
        return {
            id: definition.id,
            name: definition.name,
            pricing: definition.pricing,
            wildcard: definition.wildcard,
            available: enabled && (registered || eabConfigured),
            reason: !enabled ? "disabled" : missing.length ? "missing_credentials" : "ready",
            registered, eabConfigured, needsRegistration: eabConfigured && !registered, missing,
        };
    }));
}

export function assertCaAvailable(capabilities: CaCapability[], id: string, domains: string[]): void {
    const selected = capabilities.find((item) => item.id === id);
    if (!selected?.available) throw new Error(`CA is unavailable: ${id}`);
    if (!selected.wildcard && domains.some((domain) => domain.startsWith("*."))) {
        throw new Error(`${selected.name} free DV does not support wildcard domains`);
    }
    if (id === "sslcom-trust" && domains.length > 1) {
        throw new Error("SSL.com free DV supports a single domain only");
    }
    if (id === "sslcom-trust" && domains.some((domain) => isIP(domain))) throw new Error("SSL.com free DV requires a single FQDN");
}

export function requestedNames(domains: {name: string; wild?: boolean; root?: boolean; isIP?: boolean; type?: string}[]): string[] {
    if (!Array.isArray(domains) || !domains.length || domains.length > 100) {
        throw new Error("Between 1 and 100 domains are required");
    }
    const names = new Set<string>();
    for (const item of domains) {
        const name = String(item.name ?? "").trim().toLowerCase();
        if (item.isIP) {
            if (!isIP(name) || item.wild || item.type !== "web-self") throw new Error("IP certificates require HTTP-01 without wildcards");
            names.add(name);
            continue;
        }
        if (!/^(\*\.)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/.test(name)
            || name.length > 253) throw new Error("Invalid domain name");
        const base = name.replace(/^\*\./, "");
        if (item.wild || name.startsWith("*.")) names.add(`*.${base}`);
        if (item.root || !item.wild && !name.startsWith("*.")) names.add(base);
    }
    return [...names];
}

export function normalizeDomains(domains: any[]): any[] {
    requestedNames(domains);
    const result = new Map<string, any>();
    for (const domain of domains) {
        for (const name of requestedNames([domain])) {
            const type = domain.type ?? "dns-self";
            if (!["dns-self", "dns-auto", "dns-api", "web-self"].includes(type)) throw new Error("Unsupported validation mode");
            if (name.startsWith("*.") && type === "web-self") throw new Error("Wildcard certificates require DNS validation");
            const item = {name, wild: name.startsWith("*."), root: !!domain.root, type,
                ...(domain.isIP ? {isIP: true} : {}), ...(type === "dns-api" ? {dnsAccountId: domain.dnsAccountId} : {}), flag: 0, text: ""};
            const previous = result.get(name);
            if (previous && (previous.type !== type || previous.dnsAccountId !== item.dnsAccountId)) throw new Error("Conflicting validation methods for the same domain");
            result.set(name, item);
        }
    }
    return [...result.values()];
}