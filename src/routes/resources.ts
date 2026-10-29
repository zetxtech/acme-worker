import type {Hono} from "hono";
import type {Bindings} from "../index";
import {ensureDao} from "../db";
import {currentUser, requireAdmin} from "../middleware/admin";
import {automationKeyReady, authorizedResource, canUse, getResource, maskedResource, resourceInUse, saveResource, seal, unseal, type ResourceKind} from "../resources";
import {DnsProvider} from "../dns";
import {invalidateConf, readConf, writeConf} from "../db/conf";
import {deploymentStates, pushSelectedOrder} from "../deployment";
import {validateSelections} from "../resources";
import {withSsh} from "../deploy/ssh";
import {testSynology} from "../deploy/synology";
import {assertPublicResolution, boundedResponse, publicHttps} from "../deploy/network";
import {testTarget} from "../edge";
import {dnsCatalog, dnsVerificationMatches} from "../lego/registry";
import shardBuilds from "../lego-shards.generated.json";
import {dcvCapability, requestedNames} from "../capabilities";
import {queueOrder} from "../order-workflow";
import {httpDiagnostic} from '../edge/http-error';

export function mountResourceRoutes(app: Hono<{Bindings: Bindings}>) {
    app.use("/resources/*", async (c, next) => {
        const user = await currentUser(c);
        if (!user) return c.json({flags: 2, texts: "Authentication required"}, 401);
        if (Number(user.flag) !== 1) return c.json({flags: 9, texts: "Account is inactive"}, 403);
        c.set("resourceUser" as never, user as never);
        await next();
    });
    app.get("/resources/dns/providers", async (c) => {
        const providers = await dnsCatalog(c.env);
        return c.json({flags: 0, providerCount: providers.length, readyCount: providers.filter((provider) => provider.status === "ready").length,
            configurableCount: providers.filter((provider) => ["ready", "requires_test"].includes(provider.status)).length, providers});
    });

    app.put("/resources/dcv", async (c) => {
        const administrator = await requireAdmin(c);
        if (administrator instanceof Response) return administrator;
        try {
            const body = await c.req.json();
            const domain = requestedNames([{name: body.domain}])[0];
            if (domain.startsWith("*.")) throw new Error("Use a dedicated DCV subdomain without a wildcard");
            if (body.confirmWrite !== true) throw new Error("Confirm the temporary DNS write and cleanup first");
            let token = typeof body.token === "string" ? body.token.trim() : "";
            if (!token) {
                const encrypted = await readConf(c.env, "DCV_API_TOKEN_ENCRYPTED");
                token = encrypted ? (await unseal(c.env.AUTOMATION_KEY, "DCV_AUTH", encrypted)).token
                    : (await readConf(c.env, "DCV_API_TOKEN")) ?? "";
            }
            if (!token || token.length > 4096 || /[\r\n]/.test(token)) throw new Error("Cloudflare DNS API Token is required");
            const encrypted = await seal(c.env.AUTOMATION_KEY, "DCV_AUTH", {token});
            const account = {id: "dcv-setup", kind: "DNS_ACCOUNT" as const, provider: "cloudflare", name: "DCV",
                owner: administrator.mail.toLowerCase(), grants: [], zones: [domain], enabled: true, config: {}, encrypted: "", updatedAt: Date.now()};
            const provider = new DnsProvider(account, {token});
            const zone = await provider.zone(domain);
            const probe = `setup-${crypto.randomUUID()}.${domain}`;
            const handle = await provider.present(probe, crypto.randomUUID(), `DCV-setup:${Date.now()}`);
            if (!handle.owned) throw new Error("Unable to own the DCV test record");
            await provider.cleanup(handle);
            await writeConf(c.env, "DCV_API_TOKEN_ENCRYPTED", encrypted);
            await writeConf(c.env, "DCV_ZONES", zone.id);
            await writeConf(c.env, "DCV_AGENT", domain);
            return c.json({flags: 0, dcv: await dcvCapability((name) => readConf(c.env, name))});
        } catch {
            return c.json({flags: 3, texts: "\u672a\u80fd\u542f\u7528 DCV \u6258\u7ba1\uff0c\u8bf7\u68c0\u67e5 Token \u662f\u5426\u5305\u542b\u8be5\u57df\u540d\u7684\u533a\u57df\u8bfb\u53d6\u548c DNS \u7f16\u8f91\u6743\u9650\uff0c\u5e76\u786e\u8ba4\u5141\u8bb8\u4e34\u65f6\u8bb0\u5f55\u6d4b\u8bd5"}, 400);
        }
    });
    for (const [route, kind] of [["dns", "DNS_ACCOUNT"], ["targets", "DEPLOY_TARGET"]] as const) {
        app.get(`/resources/${route}`, async (c) => {
            const user = c.get("resourceUser" as never) as any;
            const dao = await ensureDao(c.env);
            const records = await dao.listConfs();
            const resources = records.filter((row) => row.name.startsWith(`${kind}:`))
                .map((row) => JSON.parse(row.data ?? "null"))
                .filter((resource) => resource && (resource.owner === user.mail.toLowerCase()
                    || canUse(resource, user.mail) || Number(user.is_admin) === 1)).map(maskedResource);
            const catalog = kind === "DNS_ACCOUNT" ? await dnsCatalog(c.env) : [];
            const validations = new Map(records.filter((row) => row.name.startsWith("DNS_VALIDATION:")).map((row) => [row.name, row.data]));
            const items = resources.map((resource) => {
                if (kind !== "DNS_ACCOUNT") return resource;
                const provider = catalog.find((entry) => entry.applicationProvider === resource.provider);
                const manifest = shardBuilds.shards.find((shard) => shard.providers.includes(resource.provider.replace(/^lego:/, "")));
                const available = provider?.status === "ready" || provider?.status === "requires_test"
                    && dnsVerificationMatches(resource as any, manifest, validations.get(`DNS_VALIDATION:${resource.id}`));
                let connection: any;
                try { connection = JSON.parse(records.find((row) => row.name === `DNS_CONNECTION:${resource.id}`)?.data ?? "null"); } catch {}
                const connectionChecked = resource.provider.startsWith("lego:")
                    ? dnsVerificationMatches(resource as any, manifest, validations.get(`DNS_VALIDATION:${resource.id}`))
                    : connection?.owner === resource.owner && connection?.resourceUpdatedAt === resource.updatedAt;
                return {...resource, available, connectionChecked, unavailableReason: available ? "" : provider?.reason ?? "DNS service unavailable"};
            });
            return c.json({flags: 0, items, encryptionReady: automationKeyReady(c.env.AUTOMATION_KEY)});
        });
        const save = async (c: any) => {
            try {
                const user = c.get("resourceUser");
                const body = await c.req.json();
                const dao = await ensureDao(c.env);
                const resource = await saveResource(dao, c.env.AUTOMATION_KEY, kind, user, body, c.req.param("id"), c.env);
                invalidateConf(`${kind}:${resource.id}`);
                return c.json({flags: 0, item: maskedResource(resource)});
            } catch (error) { return c.json({flags: 3, texts: (error as Error).message}, 400); }
        };
        app.post(`/resources/${route}`, save);
        app.put(`/resources/${route}/:id`, save);
        app.delete(`/resources/${route}/:id`, async (c) => {
            try {
                const user = c.get("resourceUser" as never) as any;
                const dao = await ensureDao(c.env);
                const resource = await getResource(dao, kind, c.req.param("id")!);
                if (!resource || resource.owner !== user.mail.toLowerCase() && Number(user.is_admin) !== 1) {
                    return c.json({flags: 9, texts: "Resource ownership required"}, 403);
                }
                if (await resourceInUse(dao, kind, resource.id)) return c.json({flags: 4, texts: "Resource is referenced by an order; remove its selection first"}, 409);
                await dao.deleteConf(`${kind}:${resource.id}`);
                invalidateConf(`${kind}:${resource.id}`);
                return c.json({flags: 0});
            } catch (error) { return c.json({flags: 3, texts: (error as Error).message}, 400); }
        });
    }
    app.post("/resources/dns/:id/test", async (c) => {
        try {
            const user = c.get("resourceUser" as never) as any;
            const dao = await ensureDao(c.env);
            const body = await c.req.json();
            if (typeof body.domain !== "string") throw new Error("A DNS domain is required");
            const domain = requestedNames([{name: body.domain}])[0].replace(/^\*\./, "");
            const resource = await authorizedResource(dao, "DNS_ACCOUNT", c.req.param("id"), user.mail, [domain]);
            if (resource.provider.startsWith("lego:")) {
                if (body.confirmWrite !== true) throw new Error("Explicit confirmation is required for the temporary TXT write and cleanup");
                const zone = await (await import("../lego/dispatch")).testLegoAccount(c.env, user.mail, resource.id, domain);
                return c.json({flags: 0, zone});
            }
            const secrets = await unseal(c.env.AUTOMATION_KEY, `DNS_ACCOUNT:${resource.id}`, resource.encrypted);
            const zone = await new DnsProvider(resource, secrets).zone(domain);
            const fresh = await authorizedResource(dao, "DNS_ACCOUNT", resource.id, user.mail, [domain]);
            if (fresh.updatedAt !== resource.updatedAt || fresh.encrypted !== resource.encrypted) throw new Error("DNS account changed during connection check");
            await dao.upsertConf(`DNS_CONNECTION:${resource.id}`, JSON.stringify({owner: resource.owner,
                resourceUpdatedAt: resource.updatedAt, checkedAt: Date.now()}), Date.now());
            return c.json({flags: 0, zone});
        } catch (error) { return c.json({flags: 3, texts: (error as Error).message}, 400); }
    });
    app.post("/resources/targets/:id/test", async (c) => {
        try {
            const user = c.get("resourceUser" as never) as any;
            const dao = await ensureDao(c.env);
            const resource = await authorizedResource(dao, "DEPLOY_TARGET", c.req.param("id"), user.mail);
            const secrets = await unseal(c.env.AUTOMATION_KEY, `DEPLOY_TARGET:${resource.id}`, resource.encrypted);
            if (["ssh", "nginx", "traefik"].includes(resource.provider)) {
                await withSsh(resource.config, secrets, async (client) => {
                    const sftp = await new Promise<any>((resolve, reject) => client.sftp((error: Error, stream: any) => error ? reject(error) : resolve(stream)));
                    sftp.end();
                });
            } else if (resource.provider === "synology") {
                const {detail} = await testSynology(resource.config, secrets);
                return c.json({flags: 0, detail});
            } else if (resource.provider === "https") {
                const url = publicHttps(resource.config.url);
                await assertPublicResolution(url.hostname);
                const response = await fetch(url, {method: "HEAD", redirect: "error", signal: AbortSignal.timeout(10000),
                    headers: {Authorization: secrets.authorization || `Bearer ${secrets.authToken}`}});
                await boundedResponse(response);
                if (!response.ok) throw new Error(`Hook connectivity returned HTTP ${response.status}`);
            } else {
                await testTarget({id: resource.id, name: resource.name, type: resource.provider, enabled: true, auto: true, domains: resource.zones,
                    edgeone: {...resource.config, secret_id: secrets.secretId, secret_key: secrets.secretKey},
                    esa: {...resource.config, access_key_id: secrets.accessKeyId, access_key_secret: secrets.accessKeySecret}} as any);
            }
            return c.json({flags: 0, texts: "Connection verified; no certificate deployed"});
        } catch (error) {
            const diagnostic = httpDiagnostic(error);
            return c.json({flags: 3, texts: diagnostic ? (error as Error).message : '连接检查失败，请检查主机指纹、凭据和网络', diagnostic}, 400);
        }
    });
    app.get("/resources/orders/:uuid/deployments", async (c) => {
        const user = c.get("resourceUser" as never) as any;
        const dao = await ensureDao(c.env);
        const row = await dao.getApply(c.req.param("uuid"));
        if (!row || row.mail !== user.mail && Number(user.is_admin) !== 1) return c.json({flags: 9}, 404);
        return c.json({flags: 0, items: await deploymentStates(dao, row.uuid)});
    });
    app.put("/resources/orders/:uuid/deployments", async (c) => {
        try {
            const user = c.get("resourceUser" as never) as any;
            const dao = await ensureDao(c.env);
            const row = await dao.getApply(c.req.param("uuid"));
            if (!row || row.mail !== user.mail && Number(user.is_admin) !== 1) return c.json({flags: 9}, 404);
            const {targetIds} = await c.req.json();
            const ids = await validateSelections(dao, row.mail, JSON.parse(row.list), targetIds, c.env);
            await dao.upsertConf(`ORDER_DEPLOYMENT:${row.uuid}`, JSON.stringify(ids), Date.now());
            if (Number(row.flag) === 5 && ids.length) await queueOrder(c.env, row.uuid, "deploy");
            return c.json({flags: 0});
        } catch (error) { return c.json({flags: 3, texts: (error as Error).message}, 400); }
    });
    app.post("/resources/orders/:uuid/deployments/:targetId/retry", async (c) => {
        try {
            const user = c.get("resourceUser" as never) as any;
            const dao = await ensureDao(c.env);
            const row = await dao.getApply(c.req.param("uuid"));
            if (!row || row.mail !== user.mail && Number(user.is_admin) !== 1) return c.json({flags: 9}, 404);
            if (Number(row.flag) !== 5) return c.json({flags: 3, texts: "证书尚未签发"}, 409);
            const targetId = c.req.param("targetId");
            const selected: string[] = JSON.parse(await dao.getConf(`ORDER_DEPLOYMENT:${row.uuid}`) ?? "[]");
            if (!selected.includes(targetId)) return c.json({flags: 9, texts: "目标不属于此申请"}, 404);
            const stateKey = `DEPLOY_STATE:${row.uuid}:${targetId}`;
            const previous = JSON.parse(await dao.getConf(stateKey) ?? 'null');
            if (previous?.status === 'ok') return c.json({flags: 0, items: await deploymentStates(dao, row.uuid)});
            await dao.upsertConf(stateKey, JSON.stringify({...previous, targetId, name: previous?.name ?? targetId,
                status: 'pending', attempts: previous?.attempts ?? 0, nextAttempt: 0, updatedAt: Date.now(), detail: '已安排后台重试'}), Date.now());
            await queueOrder(c.env, row.uuid, "deploy", undefined, targetId);
            return c.json({flags: 0, texts: "已安排后台部署", items: await deploymentStates(dao, row.uuid)}, 202);
        } catch (error) { return c.json({flags: 3, texts: (error as Error).message}, 400); }
    });
}