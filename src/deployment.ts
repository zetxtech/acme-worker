import type {Bindings} from "./index";
import type {Dao} from "./db/dao";
import {ensureDao} from "./db";
import {authorizedResource, unseal, type Resource} from "./resources";
import {sha256Hex} from "./edge/tencent";
import {deployTarget, orderDomains} from "./edge";
import {deployHook} from "./deploy/hook";
import {deploySsh} from "./deploy/ssh";
import {validateResourceConfig} from "./deploy/config";

export interface DeploymentState {
    targetId: string;
    name: string;
    provider: string;
    status: "pending" | "running" | "ok" | "fail";
    version: string;
    configHash: string;
    attempts: number;
    updatedAt: number;
    nextAttempt: number;
    detail: string;
}

export function certificateCoversHost(pattern: string, host: string): boolean {
    const name = pattern.toLowerCase();
    const candidate = host.toLowerCase();
    if (name === candidate) return true;
    if (!name.startsWith("*.")) return false;
    const base = name.slice(2);
    return candidate.endsWith(`.${base}`) && candidate.split(".").length === base.split(".").length + 1;
}

async function execute(env: Bindings, target: Resource, secrets: Record<string, string>, order: any, version: string) {
    validateResourceConfig(target.provider, target.config, secrets);
    const domains = orderDomains(order);
    const artifact = {orderId: order.uuid, version, domains, certificate: order.cert, privateKey: order.keys};
    if (target.provider === "https") return deployHook(target.config, secrets, artifact);
    if (["ssh", "nginx", "traefik"].includes(target.provider)) return deploySsh(target.provider, target.config, secrets, artifact);
    if (target.provider === "edgeone" && target.config.hosts?.some((host: string) => !domains.some((domain) => certificateCoversHost(domain, host)))) {
        throw new Error("EdgeOne hosts are not covered by this certificate");
    }
    const edgeTarget: any = {id: target.id, name: target.name, type: target.provider, enabled: true, auto: true, domains,
        edgeone: {...target.config, secret_id: secrets.secretId, secret_key: secrets.secretKey},
        esa: {...target.config, access_key_id: secrets.accessKeyId, access_key_secret: secrets.accessKeySecret}};
    await deployTarget(env, edgeTarget, {order, uuid: order.uuid, domains, cert: order.cert, key: order.keys,
        hostAllowed: (host) => domains.some((domain) => certificateCoversHost(domain, host))}, version);
}

export async function deploymentStates(dao: Dao, orderId: string): Promise<DeploymentState[]> {
    const ids: string[] = JSON.parse(await dao.getConf(`ORDER_DEPLOYMENT:${orderId}`) ?? "[]");
    return Promise.all(ids.map(async (id) => {
        const state = await dao.getConf(`DEPLOY_STATE:${orderId}:${id}`);
        return state ? JSON.parse(state) : {targetId: id, name: id, status: "pending", attempts: 0};
    }));
}

export async function pushSelectedOrder(env: Bindings, order: any, options: {targetId?: string; manual?: boolean; budget?: {remaining: number}} = {},
    daoOverride?: Dao, executor = execute): Promise<DeploymentState[]> {
    const dao = daoOverride ?? await ensureDao(env);
    if (Number(order.flag) !== 5 || !order.cert || !order.keys) throw new Error("Certificate is not ready for deployment");
    const ids: string[] = JSON.parse(await dao.getConf(`ORDER_DEPLOYMENT:${order.uuid}`) ?? "[]");
    if (options.targetId && !ids.includes(options.targetId)) throw new Error("Target is not selected for this order");
    const version = await sha256Hex(order.cert + order.keys);
    const results: DeploymentState[] = [];
    const budget = options.budget ?? {remaining: 4};
    for (const id of ids) {
        if (options.targetId && id !== options.targetId) continue;
        const stateKey = `DEPLOY_STATE:${order.uuid}:${id}`;
        const previous: DeploymentState | null = JSON.parse(await dao.getConf(stateKey) ?? "null");
        let target: Resource;
        try { target = await authorizedResource(dao, "DEPLOY_TARGET", id, order.mail, orderDomains(order)); }
        catch {
            const failed: DeploymentState = {...previous, targetId: id, name: previous?.name ?? id,
                provider: previous?.provider ?? "", status: "fail", version, configHash: "",
                attempts: (previous?.attempts ?? 0) + 1, updatedAt: Date.now(), nextAttempt: Date.now() + 60000,
                detail: "Target unavailable or access grant/domain scope revoked"};
            await dao.upsertConf(stateKey, JSON.stringify(failed), Date.now());
            results.push(failed);
            continue;
        }
        const configHash = await sha256Hex(JSON.stringify({provider: target.provider, config: target.config, revision: target.updatedAt}));
        if (previous?.status === "ok" && previous.version === version && previous.configHash === configHash) {
            results.push(previous); continue;
        }
        if (!options.manual && previous?.version === version && previous.configHash === configHash && previous.nextAttempt > Date.now()) {
            results.push(previous); continue;
        }
        if (budget.remaining <= 0) break;
        if (!dao.claimConfLease || !dao.releaseConfLease) throw new Error("Deployment requires the existing Worker D1 lease implementation");
        const token = crypto.randomUUID();
        const lease = `DEPLOY_LEASE:${order.uuid}:${id}`;
        if (!await dao.claimConfLease(lease, token, Date.now() + 120000, Date.now())) {
            if (previous) results.push(previous);
            continue;
        }
        budget.remaining--;
        const state: DeploymentState = {targetId: id, name: target.name, provider: target.provider, status: "running",
            version, configHash, attempts: (previous?.attempts ?? 0) + 1, updatedAt: Date.now(), nextAttempt: 0, detail: ""};
        try {
            await dao.upsertConf(stateKey, JSON.stringify(state), Date.now());
            const secrets = await unseal(env.AUTOMATION_KEY, `DEPLOY_TARGET:${id}`, target.encrypted);
            try {
                await executor(env, target, secrets, order, version);
                state.status = "ok";
                state.detail = "Certificate deployed";
            } catch (error) {
                state.status = "fail";
                let detail = (error as Error).message;
                for (const value of Object.values(secrets)) if (value) detail = detail.split(value).join("[redacted]");
                state.detail = detail.slice(0, 500);
            }
        } catch { state.status = "fail"; state.detail = "Credential decryption or deployment initialization failed"; }
        finally {
            state.updatedAt = Date.now();
            state.nextAttempt = state.status === "fail" ? Date.now() + Math.min(3600000, 30000 * 2 ** Math.min(state.attempts, 7)) : 0;
            await dao.upsertConf(stateKey, JSON.stringify(state), Date.now());
            await dao.releaseConfLease(lease, token);
        }
        results.push(state);
    }
    return results;
}

export async function syncSelectedOrders(env: Bindings): Promise<number> {
    const dao = await ensureDao(env);
    let count = 0;
    const budget = {remaining: 4};
    for (let page = 1; budget.remaining > 0; page++) {
        const {rows, total} = await dao.listApplies({eq: {flag: 5}}, {page, pageSize: 100, orderBy: "time", orderDesc: true});
        for (const row of rows) {
            count += (await pushSelectedOrder(env, row, {budget})).filter((state) => state.status === "ok").length;
            if (budget.remaining <= 0) break;
        }
        if (rows.length === 0 || page * 100 >= total) break;
    }
    return count;
}