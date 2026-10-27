/**
 * 管理员吊销证书时复用的 ACME 客户端初始化。
 * 仅暴露 getAcmeClient(env, user, order) 以避免循环依赖。
 *
 * CA 账户凭据（GTS_* / SSL_* / ZRO_*）遵循 Confs → env → 默认值 的三级回退，
 * 便于管理员在系统管理页面直接覆盖而无需重新发布 Worker。
 */
import * as acme from "acme-client";
import type {Bindings} from "../index";
import type {ApplyRow, UserRow} from "../db/dao";
import {readConf, writeConf} from "../db/conf";
import {ensureDao} from "../db";
import {sha256Hex} from "../edge/tencent";
import type {Dao} from "../db/dao";

export async function registeredClient(dao: Pick<Dao, "getConf" | "upsertConf"> & Partial<Pick<Dao, 'claimConfLease' | 'releaseConfLease'>>,
    options: any, mail: string, create: (options: any) => any = (options) => new acme.Client(options)) {
    // Normalize the key so the account identity never changes because of surrounding whitespace:
    // a different identity would register a second account and consume the one-time EAB again.
    const accountKey = typeof options.accountKey === "string" ? options.accountKey.trim() : "";
    if (!accountKey) throw new Error("ACME account private key is required");
    const identity = `ACME_ACCOUNT:${await sha256Hex(options.directoryUrl + "\n" + accountKey)}`;
    let accountUrl = await dao.getConf(identity);
    const lease = `ACME_ACCOUNT_LEASE:${identity}`;
    const token = crypto.randomUUID();
    let locked = false;
    if (!accountUrl && dao.claimConfLease && dao.releaseConfLease) {
        locked = await dao.claimConfLease(lease, token, Date.now() + 300000, Date.now());
        if (!locked) throw new Error('ACME account initialization is busy; retry later');
        accountUrl = await dao.getConf(identity);
    }
    try {
    // The account key is the account identity: once registered, signed requests never need the EAB again.
    // Dropping it also avoids sending a spent/expired secret, which CAs would reject.
    const client = create({...options, accountKey, externalAccountBinding: accountUrl ? undefined : options.externalAccountBinding,
        accountUrl: accountUrl || undefined});
    if (!accountUrl) {
        try {
            await client.createAccount({termsOfServiceAgreed: true, contact: ["mailto:" + mail]});
        } catch (error: any) {
            const detail = String(error?.message ?? error);
            const problem = `${detail} ${JSON.stringify(error?.response?.data ?? {})}`;
            if (!options.externalAccountBinding || !/eab|external.?account|hmac|key.?identifier|invalid.*kid/i.test(problem)) throw error;
            const wrapped: any = new Error(`ACME account registration failed (${detail}). Verify the initial EAB credentials and keep the account key unchanged.`);
            wrapped.cause = error;
            throw wrapped;
        }
        await dao.upsertConf(identity, client.getAccountUrl(), Date.now());
    }
    return client;
    } finally { if (locked) await dao.releaseConfLease!(lease, token); }
}

/**
 * 解析某 CA 的账户私钥：优先使用管理员配置，其次是系统自动生成并持久化的私钥。
 * 自动生成后不要再替换，否则会以新账户身份重新注册，并再次需要 EAB。
 */
export async function resolveAccountKey(env: Bindings, sign: string, configured: any): Promise<string> {
    const trimmed = typeof configured === "string" ? configured.trim() : "";
    if (trimmed) return trimmed;
    if (!["google-trust", "zeroca-trust", "sslcom-trust"].includes(sign)) return "";
    const stored = (await readConf(env as any, `ACME_KEY:${sign}`))?.trim();
    if (stored) return stored;
    const dao = await ensureDao(env);
    const lease = `ACME_KEY_LEASE:${sign}`;
    const token = crypto.randomUUID();
    if (!dao.claimConfLease || !dao.releaseConfLease) throw new Error('ACME account initialization requires atomic storage');
    if (!await dao.claimConfLease(lease, token, Date.now() + 30000, Date.now())) throw new Error('ACME account initialization is busy; retry later');
    try {
    const existing = (await dao.getConf(`ACME_KEY:${sign}`))?.trim();
    if (existing) return existing;
    const generated = (await acme.crypto.createPrivateEcdsaKey("P-256")) as any;
    const pem = generated.toString().trim();
    await writeConf(env as any, `ACME_KEY:${sign}`, pem);
    return pem;
    } finally { await dao.releaseConfLease(lease, token); }
}

const ACME_URL: Record<string, any> = {
    "lets-encrypt": acme.directory.letsencrypt.production,
    "google-trust": acme.directory.google.production,
    "bypass-trust": acme.directory.buypass.production,
    "zeroca-trust": acme.directory.zerossl.production,
    "sslcom-trust": "https://acme.ssl.com/sslcom-dv-",
};

/** 与 certs.ts 中 getStart() 等价，但独立不依赖 saves 层 */
export async function getAcmeOptions(
    env: Bindings,
    user: UserRow,
    order: ApplyRow,
) {
    const sign = String(order.sign ?? "lets-encrypt");
    let url = ACME_URL[sign];

    // 从 Confs 读取三家 CA 的账户凭据（回退 env / 默认值）
    const [GTS_KeyTS, GTS_keyID, GTS_keyMC,
        SSL_KeyTS, SSL_keyID, SSL_keyMC,
        ZRO_KeyTS, ZRO_keyID, ZRO_keyMC] = await Promise.all([
        readConf(env as any, "GTS_KeyTS"),
        readConf(env as any, "GTS_keyID"),
        readConf(env as any, "GTS_keyMC"),
        readConf(env as any, "SSL_KeyTS"),
        readConf(env as any, "SSL_keyID"),
        readConf(env as any, "SSL_keyMC"),
        readConf(env as any, "ZRO_KeyTS"),
        readConf(env as any, "ZRO_keyID"),
        readConf(env as any, "ZRO_keyMC"),
    ]);

    const keysMap: Record<string, any> = {
        "lets-encrypt": user.keys,
        "google-trust": GTS_KeyTS,
        "bypass-trust": user.keys,
        "zeroca-trust": ZRO_KeyTS,
        "sslcom-trust": SSL_KeyTS,
    };
    const eabMap: Record<string, any> = {
        "lets-encrypt": undefined,
        "google-trust": {kid: GTS_keyID, hmacKey: GTS_keyMC},
        "bypass-trust": undefined,
        "zeroca-trust": {kid: ZRO_keyID, hmacKey: ZRO_keyMC},
        "sslcom-trust": {kid: SSL_keyID, hmacKey: SSL_keyMC},
    };
    if (sign === "sslcom-trust" && typeof order.type === "string") {
        url += (order.type as string).substring(0, 3);
    }
    return {
        directoryUrl: url,
        accountKey: await resolveAccountKey(env, sign, keysMap[sign]),
        externalAccountBinding: eabMap[sign],
    };
}

export async function getAcmeClient(env: Bindings, user: UserRow, order: ApplyRow): Promise<acme.Client> {
    return registeredClient(await ensureDao(env), await getAcmeOptions(env, user, order), user.mail);
}
