import catalog from "../dns-providers.generated.json";
import builds from "../lego-shards.generated.json";
import {readBoundedJson} from "../deploy/network";
import type {Dao} from "../db/dao";
import type {Resource} from "../resources";

export function dnsDefinition(provider: string) {
    return catalog.providers.find((item) => item.applicationProvider === provider || provider === `lego:${item.id}`);
}

export function validateDnsSettings(provider: string, config: Record<string, any>, secrets: Record<string, string>) {
    const definition = dnsDefinition(provider);
    if (!definition) throw new Error("Unknown DNS provider");
    const schema = provider.startsWith("lego:") ? {credentials: definition.credentials.filter((field: any) => !field.blocked),
        options: definition.options.filter((field: any) => !field.blocked)} : definition.resourceSchema;
    if (Object.keys(config).some((field) => !schema.options.some((item) => item.name === field))
        || Object.keys(secrets).some((field) => !schema.credentials.some((item) => item.name === field))) throw new Error("Unsupported DNS configuration or credential field");
    if (schema.credentials.some((field) => field.required && !secrets[field.name]?.trim())
        || schema.credentials.length > 0 && !Object.values(secrets).some((value) => value.trim())) throw new Error("DNS credentials are required");
    if (Object.values(config).some((value) => typeof value !== "string" || value.length > 4096)) throw new Error("DNS options must be bounded strings");
}

export async function dnsCatalog(env: Record<string, any> = {}) {
    const ready = new Set<string>();
    const reasons = new Map<string, string>();
    for (const shard of builds.shards) {
        const binding = env[(shard as any).binding];
        if (!(shard as any).buildHash || !binding?.fetch) {
            for (const id of shard.providers) reasons.set(id, "DNS service is not connected");
            continue;
        }
        const verified = (shard as any).verifiedProviders as string[];
        try {
            const response = await binding.fetch("https://lego.internal/health", {signal: AbortSignal.timeout(3000)});
            if (!response.ok) throw new Error("Unavailable shard");
            const health = await readBoundedJson(response);
            if (health.runtimeVersion !== catalog.upstreamTag || health.buildHash !== (shard as any).buildHash
                || health.sourceHash !== (shard as any).sourceHash) throw new Error("Mismatched shard");
            for (const id of shard.providers) if (health.providers?.includes(id)) {
                reasons.set(id, "Account must pass DNS write, propagation and cleanup verification before issuance");
                if (verified?.includes(id) && health.verifiedProviders?.includes(id)) ready.add(id);
            }
        } catch { for (const id of shard.providers) reasons.set(id, "DNS service version does not match or is unavailable"); }
    }
    return catalog.providers.map((item) => ({...item,
        applicationProvider: item.applicationProvider ?? `lego:${item.id}`,
        status: item.adapter === "native" ? "ready" : item.status === "incompatible" ? "incompatible" : ready.has(item.id) ? "ready"
            : reasons.get(item.id)?.startsWith("Account must pass") ? "requires_test" : "unavailable",
        reason: item.adapter === "native" || ready.has(item.id) ? "" : reasons.get(item.id) ?? item.reason,
        resourceSchema: item.adapter === "native" ? item.resourceSchema : {credentials: item.credentials.filter((field: any) => !field.blocked), options: item.options.filter((field: any) => !field.blocked)},
    }));
}

export async function dnsShard(env: Record<string, any>, provider: string, options: {forTest?: boolean} = {}) {
    const definition = dnsDefinition(provider);
    if (!provider.startsWith("lego:") || !definition || definition.status === "incompatible") throw new Error("DNS provider is not ready");
    const shard: any = builds.shards.find((item) => item.providers.includes(definition.id) && (item as any).buildHash);
    const service = shard && env[shard.binding];
    if (!shard || !service?.fetch) throw new Error("DNS provider service is not connected");
    const response = await service.fetch("https://lego.internal/health", {signal: AbortSignal.timeout(3000)});
    if (!response.ok) throw new Error("DNS provider service is unavailable");
    const health = await readBoundedJson(response);
    if (health.runtimeVersion !== catalog.upstreamTag || health.buildHash !== shard.buildHash
        || health.sourceHash !== shard.sourceHash || !health.providers?.includes(definition.id)) {
        throw new Error("DNS provider service version does not match");
    }
    const verified = !!shard.verifiedProviders?.includes(definition.id) && !!health.verifiedProviders?.includes(definition.id);
    if (!verified && !options.forTest) throw new Error("DNS provider requires account verification");
    return {manifest: shard, service, definition, verified};
}

export function dnsVerificationMatches(resource: Resource, manifest: any, raw: string | null | undefined): boolean {
    let evidence: any;
    try { evidence = JSON.parse(raw ?? "null"); } catch {}
    return !!evidence && evidence.resourceUpdatedAt === resource.updatedAt && evidence.owner === resource.owner
        && evidence.buildHash === manifest?.buildHash && evidence.sourceHash === manifest?.sourceHash
        && evidence.runtimeVersion === catalog.upstreamTag && evidence.cleaned === true;
}

export async function verifiedDnsAccount(dao: Dao, env: Record<string, any>, resource: Resource) {
    const shard = await dnsShard(env, resource.provider, {forTest: true});
    if (shard.verified) return shard;
    if (!dnsVerificationMatches(resource, shard.manifest, await dao.getConf(`DNS_VALIDATION:${resource.id}`))) {
        throw new Error("Verify this DNS account before using it to request certificates");
    }
    return shard;
}