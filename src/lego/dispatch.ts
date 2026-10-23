import * as acme from "acme-client";
import type {Bindings} from "../index";
import {ensureDao} from "../db";
import {accountScope, authorizedResource, unseal, validateSelections, type Resource} from "../resources";
import {assertCaAvailable, caCapabilities, requestedNames} from "../capabilities";
import {readConf} from "../db/conf";
import {readBoundedJson} from "../deploy/network";
import {getAcmeClient, getAcmeOptions} from "../routes/admin_certs_helper";
import {dnsShard, validateDnsSettings, verifiedDnsAccount} from "./registry";

async function groupFor(env: Bindings, resource: Resource, challenges: any[], domains: string[]) {
    const secrets = await unseal(env.AUTOMATION_KEY, `DNS_ACCOUNT:${resource.id}`, resource.encrypted);
    validateDnsSettings(resource.provider, resource.config, secrets);
    const zones = accountScope(resource) ? requestedNames(domains.map((name) => ({name}))).map((name) => name.replace(/^\*\./, "")) : resource.zones;
    return {provider: resource.provider.slice(5), env: {...resource.config, ...secrets}, zones, challenges};
}

export async function testLegoAccount(env: Bindings, mail: string, id: string, domain: string) {
    domain = requestedNames([{name: domain}])[0].replace(/^\*\./, "");
    const dao = await ensureDao(env);
    const resource = await authorizedResource(dao, "DNS_ACCOUNT", id, mail, [domain]);
    const {service, manifest} = await dnsShard(env, resource.provider, {forTest: true});
    const token = crypto.randomUUID();
    const group = await groupFor(env, resource, [{domain, token, keyAuthorization: `${token}.${crypto.randomUUID()}`}], [domain]);
    const response = await service.fetch("https://lego.internal/test", {method: "POST", body: JSON.stringify({operation: "test", groups: [group]}), signal: AbortSignal.timeout(150000)});
    const result = await readBoundedJson(response, 262144);
    if (!response.ok || !result.ok || !result.cleanupOk || !result.tested) throw new Error("DNS write, propagation or cleanup test failed");
    const fresh = await authorizedResource(dao, "DNS_ACCOUNT", id, mail, [domain]);
    if (fresh.updatedAt !== resource.updatedAt || fresh.encrypted !== resource.encrypted) throw new Error("DNS account changed during verification; retry the test");
    await dao.upsertConf(`DNS_VALIDATION:${id}`, JSON.stringify({owner: resource.owner,
        resourceUpdatedAt: resource.updatedAt, buildHash: manifest.buildHash, sourceHash: manifest.sourceHash,
        runtimeVersion: manifest.runtimeVersion, cleaned: true, verifiedAt: Date.now()}), Date.now());
    return {name: domain, writable: true, cleaned: true};
}

export async function issueLegoOrder(env: Bindings, user: any, order: any, clientOverride?: any, optionsOverride?: any) {
    const domains: any[] = JSON.parse(order.list || "[]");
    if (!domains.some((domain) => domain.type === "dns-api")) return false;
    const dao = await ensureDao(env);
    const resources = await Promise.all(domains.filter((domain) => domain.type === "dns-api").map((domain) =>
        authorizedResource(dao, "DNS_ACCOUNT", domain.dnsAccountId, order.mail, [domain.name])));
    if (!resources.some((resource) => resource.provider?.startsWith("lego:"))) return false;
    await validateSelections(dao, order.mail, domains, [], env);
    assertCaAvailable(await caCapabilities((name) => readConf(env, name)), order.sign, domains.map((domain) => domain.name));
    if (!dao.claimConfLease || !dao.releaseConfLease) throw new Error("lego execution requires the existing D1 lease implementation");
    const lease = `LEGO_LEASE:${order.uuid}`;
    const token = crypto.randomUUID();
    if (!await dao.claimConfLease(lease, token, Date.now() + 300000, Date.now())) return true;
    try {
        const fresh = await dao.getApply(order.uuid);
        if (!fresh || Number(fresh.flag) !== 1) return true;
        const client = clientOverride ?? await getAcmeClient(env, user, fresh);
        const options = optionsOverride ?? await getAcmeOptions(env, user, fresh);
        const remote = await client.getOrder(JSON.parse(fresh.data));
        const authorizations = await client.getAuthorizations(remote);
        let privateKey: any = fresh.keys;
        if (!privateKey) privateKey = fresh.type === "rsa2048" ? await acme.crypto.createPrivateRsaKey(2048)
            : await acme.crypto.createPrivateEcdsaKey(fresh.type === "eccp384" ? "P-384" : "P-256");
        const [key, csr] = await acme.crypto.createCsr({commonName: domains[0].name, altNames: domains.map((domain) => domain.name)}, privateKey);
        await dao.updateApply(order.uuid, {keys: key.toString()});
        const groups = [];
        let service: any;
        let shardId = "";
        for (const domain of domains) {
            const resource = await authorizedResource(dao, "DNS_ACCOUNT", domain.dnsAccountId, order.mail, [domain.name]);
            const shard = await verifiedDnsAccount(dao, env, resource);
            if (shardId && shardId !== shard.manifest.id) throw new Error("DNS shard selection changed");
            shardId = shard.manifest.id;
            service = shard.service;
            const authorization = authorizations.find((item: any) => `${item.wildcard ? "*." : ""}${item.identifier.value}` === domain.name);
            if (!authorization) throw new Error("ACME authorization unavailable");
            const challenge = authorization.challenges.find((item: any) => item.type === "dns-01");
            if (authorization.status !== "valid" && !challenge) throw new Error("ACME DNS challenge unavailable");
            const challenges = authorization.status === "valid" ? [] : [{domain: authorization.identifier.value, token: challenge.token,
                keyAuthorization: await client.getChallengeKeyAuthorization({...challenge, type: "http-01"})}];
            groups.push(await groupFor(env, resource, challenges, [domain.name]));
        }
        await dao.upsertConf(`LEGO_STATE:${order.uuid}`, JSON.stringify({stage: "running", shard: shardId, runtimeVersion: "v5.5.2"}), Date.now());
        const response = await service.fetch("https://lego.internal/issue", {method: "POST", signal: AbortSignal.timeout(180000), body: JSON.stringify({
            operation: "issue", groups, order: remote, authorizations, csr: csr.toString(),
            account: {directoryUrl: options.directoryUrl, accountKey: String(options.accountKey), accountUrl: client.getAccountUrl()},
        })});
        if (response.status === 429) { await dao.updateApply(order.uuid, {text: "DNS service is busy; retry this order shortly"}); return true; }
        const result = await readBoundedJson(response, 262144);
        const stage = ["input", "credentials", "present", "validation", "panic", "complete"].includes(result.stage) ? result.stage : "unavailable";
        await dao.upsertConf(`LEGO_STATE:${order.uuid}`, JSON.stringify({stage, shard: shardId, runtimeVersion: "v5.5.2", cleanupOk: result.cleanupOk === true}), Date.now());
        if (!response.ok || !result.ok || !result.cleanupOk || !result.certificate?.includes("-----BEGIN CERTIFICATE-----")) throw new Error(`DNS issuance failed at ${stage}; cleanup ${result.cleanupOk === true ? "complete" : "requires review"}`);
        await dao.updateApply(order.uuid, {cert: result.certificate, data: JSON.stringify(result.order), flag: 4, text: "Certificate issued; DNS records cleaned"});
        return true;
    } finally { await dao.releaseConfLease(lease, token); }
}