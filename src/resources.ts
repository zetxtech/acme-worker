import type {Dao} from "./db/dao";
import {requestedNames} from "./capabilities";
import {validateResourceConfig} from "./deploy/config";
import {dnsDefinition, dnsShard, validateDnsSettings, verifiedDnsAccount} from "./lego/registry";

export type ResourceKind = "DNS_ACCOUNT" | "DEPLOY_TARGET";
export interface Resource {
    id: string;
    kind: ResourceKind;
    name: string;
    provider: string;
    owner: string;
    grants: string[];
    zones: string[];
    scopeMode?: "zones" | "account" | 'certificate';
    enabled: boolean;
    config: Record<string, any>;
    encrypted: string;
    updatedAt: number;
}

const encoder = new TextEncoder();
const bytes = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
const base64 = (value: Uint8Array) => btoa(String.fromCharCode(...value));

export function automationKeyReady(secret?: string): boolean {
    return !!secret && /^[A-Za-z0-9+/]{43}=$/.test(secret) && bytes(secret).length === 32;
}

async function encryptionKey(secret?: string): Promise<CryptoKey> {
    if (!automationKeyReady(secret)) {
        throw new Error("Administrator must configure AUTOMATION_KEY as a base64 32-byte Worker secret");
    }
    const raw = bytes(secret!);
    if (raw.length !== 32) throw new Error("Invalid AUTOMATION_KEY");
    return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function seal(secret: string | undefined, identity: string, value: Record<string, string>): Promise<string> {
    const key = await encryptionKey(secret);
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({name: "AES-GCM", iv: nonce,
        additionalData: encoder.encode(identity)}, key, encoder.encode(JSON.stringify(value)));
    return JSON.stringify({v: 1, nonce: base64(nonce), ciphertext: base64(new Uint8Array(ciphertext))});
}

export async function unseal(secret: string | undefined, identity: string, encrypted: string): Promise<Record<string, string>> {
    const key = await encryptionKey(secret);
    const payload = JSON.parse(encrypted);
    if (payload.v !== 1) throw new Error("Unsupported credential format");
    const plaintext = await crypto.subtle.decrypt({name: "AES-GCM", iv: bytes(payload.nonce),
        additionalData: encoder.encode(identity)}, key, bytes(payload.ciphertext));
    return JSON.parse(new TextDecoder().decode(plaintext));
}

export function inScope(domain: string, zones: string[]): boolean {
    const name = domain.toLowerCase().replace(/^\*\./, "");
    return zones.some((zone) => name === zone || name.endsWith(`.${zone}`));
}

export function accountScope(resource: Resource): boolean {
    return resource.kind === "DNS_ACCOUNT" && resource.scopeMode === "account"
        && resource.zones.length === 0 && resource.grants.length === 0;
}

export function canUse(resource: Resource, mail: string, domains: string[] = []): boolean {
    const owner = resource.owner === mail.toLowerCase();
    if (accountScope(resource)) return resource.enabled && owner;
    if (resource.kind === 'DEPLOY_TARGET' && ['edgeone', 'esa'].includes(resource.provider) && resource.scopeMode === 'certificate'
        && !resource.zones.length && !resource.grants.length) return resource.enabled && owner;
    return resource.enabled && resource.zones.length > 0 && (owner || resource.grants.includes(mail.toLowerCase()))
        && domains.every((domain) => inScope(domain, resource.zones));
}

export function maskedResource(resource: Resource) {
    const {encrypted, ...view} = resource;
    return {...view, credentialsConfigured: !!encrypted};
}

export async function getResource(dao: Dao, kind: ResourceKind, id: string): Promise<Resource | null> {
    if (!/^[a-zA-Z0-9-]{1,64}$/.test(id)) throw new Error("Invalid resource id");
    const raw = await dao.getConf(`${kind}:${id}`);
    return raw ? JSON.parse(raw) : null;
}

export async function authorizedResource(dao: Dao, kind: ResourceKind, id: string, mail: string, domains: string[] = []) {
    const resource = await getResource(dao, kind, id);
    if (!resource || !canUse(resource, mail, domains)) throw new Error("Resource unavailable or outside granted domain scope");
    return resource;
}

export async function saveResource(dao: Dao, secret: string | undefined, kind: ResourceKind,
    actor: {mail: string; is_admin?: number}, body: any, id = crypto.randomUUID(), environment: Record<string, any> = {}): Promise<Resource> {
    const existing = await getResource(dao, kind, id);
    if (existing && existing.owner !== actor.mail.toLowerCase() && Number(actor.is_admin) !== 1) {
        throw new Error("Resource ownership required");
    }
    const provider = String(body.provider ?? existing?.provider ?? "");
    if (kind === "DNS_ACCOUNT" ? !dnsDefinition(provider) : !["https", "ssh", "nginx", "traefik", "edgeone", "esa"].includes(provider)) throw new Error("Unsupported provider");
    if (kind === "DNS_ACCOUNT" && provider.startsWith("lego:") && !existing) await dnsShard(environment, provider, {forTest: true});
    if (existing && provider !== existing.provider) throw new Error("Create a new resource to change provider");
    const name = String(body.name ?? existing?.name ?? "").trim();
    if (!name || name.length > 100) throw new Error("Resource name must be 1 to 100 characters");
    const zones = body.zones ?? existing?.zones;
    const scopeMode = body.scopeMode ?? existing?.scopeMode ?? "zones";
    const certificateScope = scopeMode === 'certificate' && kind === 'DEPLOY_TARGET' && ['edgeone', 'esa'].includes(provider);
    if (!["zones", "account", 'certificate'].includes(scopeMode) || kind !== "DNS_ACCOUNT" && scopeMode !== "zones" && !certificateScope) throw new Error("Invalid resource scope mode");
    if (!Array.isArray(zones) || zones.length > 100 || (!zones.length && scopeMode !== "account" && !certificateScope)) throw new Error("Explicit domain scopes are required");
    if (certificateScope && zones.length) throw new Error('Private cloud target must use selected certificate scope');
    if (scopeMode === "account" && zones.length) throw new Error("Account scope must not include zone restrictions");
    const normalizedZones = zones.length ? requestedNames(zones.map((zone) => ({name: String(zone)}))) : [];
    if (normalizedZones.some((zone) => zone.startsWith("*."))) throw new Error("Zone scopes must not include wildcards");
    const grants = body.grants ?? existing?.grants ?? [];
    if (!Array.isArray(grants) || grants.length > 100 || grants.some((mail) => typeof mail !== "string" || !/^\S+@\S+\.\S+$/.test(mail))) {
        throw new Error("Invalid resource grants");
    }
    if (Number(actor.is_admin) !== 1 && JSON.stringify(grants) !== JSON.stringify(existing?.grants ?? [])) {
        throw new Error("Only administrators may share resources");
    }
    if (["account", 'certificate'].includes(scopeMode) && grants.length) throw new Error("Shared resources require explicit domain scopes");
    const config = body.config ?? existing?.config ?? {};
    if (!config || Array.isArray(config) || typeof config !== "object" || JSON.stringify(config).length > 16000) {
        throw new Error("Invalid resource configuration");
    }
    const identity = `${kind}:${id}`;
    const credentials = existing && body.clearSecrets !== true ? await unseal(secret, identity, existing.encrypted) : {};
    for (const [field, value] of Object.entries(body.secrets ?? {})) {
        if (typeof value !== "string" || value.length > 32000 || field.length > 80) throw new Error("Invalid credentials");
        if (value) credentials[field] = value;
    }
    if (kind === "DNS_ACCOUNT") validateDnsSettings(provider, config, credentials);
    else validateResourceConfig(provider, config, credentials);
    if (body.enabled !== undefined && typeof body.enabled !== "boolean") throw new Error("Invalid enabled state");
    if (provider === "edgeone" && !certificateScope && config.hosts?.some((host: string) => !inScope(host, normalizedZones))) throw new Error("EdgeOne hosts outside domain scope");
    const resource: Resource = {id, kind, name, provider, owner: existing?.owner ?? actor.mail.toLowerCase(),
        grants: grants.map((mail: string) => mail.toLowerCase()), zones: normalizedZones, scopeMode,
        enabled: body.enabled ?? existing?.enabled ?? true, config,
        encrypted: await seal(secret, identity, credentials), updatedAt: Date.now()};
    await dao.upsertConf(identity, JSON.stringify(resource), resource.updatedAt);
    return resource;
}

export async function validateSelections(dao: Dao, mail: string, domains: any[], targetIds: unknown = [], environment: Record<string, any> = {}): Promise<string[]> {
    const names = requestedNames(domains);
    if (!Array.isArray(targetIds) || targetIds.length > 20 || targetIds.some((id) => typeof id !== "string")) {
        throw new Error("At most 20 deployment targets may be selected");
    }
    const accounts: Resource[] = [];
    for (const domain of domains) {
        if (!["dns-self", "dns-auto", "dns-api", "web-self"].includes(domain.type ?? "dns-self")) {
            throw new Error("Unsupported validation mode");
        }
        if (domain.type === "dns-api") accounts.push(await authorizedResource(dao, "DNS_ACCOUNT", domain.dnsAccountId, mail, [domain.name]));
    }
    if (accounts.some((account) => account.provider?.startsWith("lego:"))) {
        if (accounts.length !== domains.length || accounts.some((account) => !account.provider?.startsWith("lego:")) || domains.length > 2) throw new Error("Use at most two DNS API names from one lego service per order");
        const shards = await Promise.all(accounts.map((account) => verifiedDnsAccount(dao, environment, account)));
        if (new Set(shards.map((shard) => shard.manifest.id)).size !== 1) throw new Error("DNS accounts must use the same lego service for this order");
    }
    const ids = [...new Set(targetIds)] as string[];
    for (const id of ids) await authorizedResource(dao, "DEPLOY_TARGET", id, mail, names);
    return ids;
}

export async function resourceInUse(dao: Dao, kind: ResourceKind, id: string): Promise<boolean> {
    for (let page = 1; ; page++) {
        const {rows, total} = await dao.listApplies({}, {page, pageSize: 200});
        for (const row of rows) {
            if (Number(row.flag) < 0 && !row.auto) continue;
            if (kind === "DNS_ACCOUNT" && JSON.parse(row.list || "[]").some((item: any) => item.dnsAccountId === id)) return true;
            if (kind === "DEPLOY_TARGET") {
                const selection = JSON.parse(await dao.getConf(`ORDER_DEPLOYMENT:${row.uuid}`) ?? "[]");
                if (selection.includes(id)) return true;
            }
        }
        if (page * 200 >= total) return false;
    }
}