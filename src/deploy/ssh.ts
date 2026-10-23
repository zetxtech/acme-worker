import {Client} from "ssh2";
import {parse as parseYaml, stringify as stringifyYaml} from "yaml";
import {pemToPfxBuffer} from "../utils/pfx";
import {assertPublicResolution, publicHost} from "./network";

export function hostFingerprintMatches(expected: string, hex: string): boolean {
    return /^SHA256:[A-Za-z0-9+/]{43}$/.test(expected)
        && `SHA256:${Buffer.from(hex, "hex").toString("base64").replace(/=+$/, "")}` === expected;
}

export function remotePath(value: unknown): string {
    if (typeof value !== "string" || !value.startsWith("/") || value.length > 1024
        || /[\x00-\x1f\x7f]/.test(value) || value.split("/").includes("..") || value.endsWith("/")) {
        throw new Error("An absolute remote file path without parent traversal is required");
    }
    return value;
}

export function validateSshConfig(config: Record<string, any>) {
    publicHost(String(config.host ?? ""));
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(config.username ?? "")) throw new Error("SSH username is required");
    if (!/^SHA256:[A-Za-z0-9+/]{43}$/.test(config.fingerprint ?? "")) throw new Error("Pinned SHA256 SSH host fingerprint is required");
    if (!Number.isInteger(Number(config.port ?? 22)) || Number(config.port ?? 22) < 1 || Number(config.port ?? 22) > 65535
        || Number(config.port) === 25) throw new Error("Invalid SSH port");
    for (const field of ["testCommand", "reloadCommand"]) {
        if (config[field] && (typeof config[field] !== "string" || config[field].length > 2000 || config[field].includes("\0"))) {
            throw new Error("Invalid SSH command");
        }
    }
}

export async function withSsh<T>(config: Record<string, any>, secrets: Record<string, string>,
    action: (client: any) => Promise<T>): Promise<T> {
    validateSshConfig(config);
    await assertPublicResolution(config.host);
    if (!secrets.password && !secrets.privateKey) throw new Error("SSH password or private key is required");
    const client = new Client();
    const maximum = Math.max(3000, Math.min(28000, Number(config.timeout) || 25000));
    try {
        return await new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => { client.destroy(); reject(new Error("SSH deployment timed out")); }, maximum);
            const fail = (error: Error & {level?: string}) => { clearTimeout(timer); reject(new Error(`SSH connection failed: ${error.level ?? error.name}`)); };
            client.on("error", fail);
            client.once("close", () => { clearTimeout(timer); reject(new Error("SSH connection closed before completion")); });
            client.once("ready", async () => {
                try { resolve(await action(client)); }
                catch (error) { reject(error); }
                finally { clearTimeout(timer); client.end(); }
            });
            try {
                client.connect({host: config.host, port: Number(config.port) || 22, username: config.username,
                    password: secrets.password || undefined, privateKey: secrets.privateKey || undefined,
                    passphrase: secrets.passphrase || undefined, readyTimeout: Math.min(10000, maximum),
                    hostHash: "sha256", hostVerifier: (hex: string) => hostFingerprintMatches(config.fingerprint, hex),
                    algorithms: {kex: ["ecdh-sha2-nistp256", "ecdh-sha2-nistp384"],
                        cipher: ["aes128-ctr", "aes256-ctr"], hmac: ["hmac-sha2-256-etm@openssh.com", "hmac-sha2-256"]}});
            } catch (error) { clearTimeout(timer); reject(error); }
        });
    } finally { client.destroy(); }
}

function sftpCall(sftp: any, method: string, ...args: any[]): Promise<any> {
    return new Promise((resolve, reject) => sftp[method](...args, (error: Error | null, value: any) => error ? reject(error) : resolve(value)));
}

async function readRemote(sftp: any, path: string, maximum = 1048576): Promise<string> {
    return new Promise((resolve, reject) => {
        const stream = sftp.createReadStream(path);
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > maximum) stream.destroy(new Error("Remote file exceeds size limit"));
            else chunks.push(chunk);
        });
        stream.once("error", reject);
        stream.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
}

export function mergeTraefikAcme(raw: string, resolver: string, domains: string[], certificate: string, privateKey: string): string {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(resolver) || !domains.length) throw new Error("Traefik resolver and domains are required");
    let store: any;
    try { store = JSON.parse(raw); }
    catch { throw new Error("Invalid Traefik ACME storage; no remote content is returned"); }
    if (!store || typeof store !== "object" || Array.isArray(store) || !Object.hasOwn(store, resolver)
        || !store[resolver]?.Account) throw new Error("Traefik resolver must already contain its ACME account");
    const selected = store[resolver];
    if (selected.Certificates !== undefined && !Array.isArray(selected.Certificates)) throw new Error("Invalid Traefik certificate store");
    const domain = {main: domains[0], ...(domains.length > 1 ? {sans: domains.slice(1)} : {})};
    const key = (entry: any) => JSON.stringify([entry.main, ...(entry.sans ?? []).slice().sort()]);
    const replacement = {domain, certificate: Buffer.from(certificate).toString("base64"), key: Buffer.from(privateKey).toString("base64"), Store: "default"};
    selected.Certificates = [...(selected.Certificates ?? []).filter((item: any) => key(item.domain ?? {}) !== key(domain)), replacement];
    return JSON.stringify(store, null, 2) + "\n";
}

export interface RemoteFile {path: string; content: string | Uint8Array; mode: number}

export async function replaceRemoteFiles(sftp: any, files: RemoteFile[], activate: () => Promise<void>, restore?: () => Promise<void>, beforeSwap?: () => Promise<void>): Promise<void> {
    const suffix = `.acme-${crypto.randomUUID()}`;
    const staged: {path: string; stage: string; backup: string; hadOriginal: boolean; activated: boolean}[] = [];
    try {
        for (const file of files) {
            const path = remotePath(file.path);
            const entry = {path, stage: path + suffix + ".stage", backup: path + suffix + ".bak", hadOriginal: false, activated: false};
            staged.push(entry);
            await sftpCall(sftp, "writeFile", entry.stage, Buffer.from(file.content), {mode: file.mode, flag: "wx"});
            await sftpCall(sftp, "chmod", entry.stage, file.mode);
        }
        await beforeSwap?.();
        for (const entry of staged) {
            try { await sftpCall(sftp, "lstat", entry.path); entry.hadOriginal = true; }
            catch (error) { if (Number((error as any).code) !== 2) throw error; }
            if (entry.hadOriginal) await sftpCall(sftp, "rename", entry.path, entry.backup);
            try { await sftpCall(sftp, "rename", entry.stage, entry.path); entry.activated = true; }
            catch (error) {
                if (entry.hadOriginal) await sftpCall(sftp, "rename", entry.backup, entry.path);
                entry.hadOriginal = false;
                throw error;
            }
        }
        await activate();
    } catch (error) {
        let recovered = true;
        for (const entry of staged.slice().reverse()) {
            if (!entry.activated) continue;
            try {
                await sftpCall(sftp, "unlink", entry.path);
                if (entry.hadOriginal) await sftpCall(sftp, "rename", entry.backup, entry.path);
            } catch { recovered = false; }
        }
        if (recovered && staged.some((entry) => entry.activated) && restore) {
            try { await restore(); } catch { recovered = false; }
        }
        throw new Error(recovered ? "Deployment failed; previous files restored" : "Deployment failed; remote recovery requires administrator attention");
    } finally {
        for (const entry of staged) {
            try { await sftpCall(sftp, "unlink", entry.stage); } catch {}
        }
    }
}

async function command(client: any, value: string | undefined): Promise<void> {
    if (!value) return;
    return new Promise((resolve, reject) => client.exec(value, (error: Error | null, stream: any) => {
        if (error) return reject(new Error("SSH command could not start"));
        let size = 0;
        const consume = (chunk: Buffer) => {
            size += chunk.length;
            if (size > 65536) { stream.close(); reject(new Error("SSH command output exceeded limit")); }
        };
        stream.on("data", consume);
        stream.stderr.on("data", consume);
        stream.on("error", () => reject(new Error("SSH command failed")));
        stream.on("close", (code: number) => code === 0 ? resolve() : reject(new Error(`SSH command exited with status ${Number(code)}`)));
    }));
}

export async function deploySsh(provider: string, config: Record<string, any>, secrets: Record<string, string>,
    artifact: {certificate: string; privateKey: string; domains: string[]}, session = withSsh): Promise<void> {
    return session(config, secrets, async (client) => {
        const sftp = await new Promise<any>((resolve, reject) => client.sftp((error: Error | null, stream: any) => error ? reject(error) : resolve(stream)));
        const acmeMode = provider === "traefik" && config.traefikMode === "acme-json";
        const primary = remotePath(acmeMode ? config.acmePath : config.format === "pfx" ? config.pfxPath : config.certificatePath);
        const lock = (provider === "traefik" && !acmeMode ? remotePath(config.dynamicPath) : primary) + ".acme-lock";
        try { await sftpCall(sftp, "mkdir", lock, {mode: 0o700}); }
        catch { throw new Error("Remote deployment is locked; retry later or inspect a stale lock"); }
        try {
            const files: RemoteFile[] = [];
            let previousAcme: string | undefined;
            if (acmeMode) {
                if (config.externalWriterStopped !== true) throw new Error("External acme.json writers must be stopped");
                previousAcme = await readRemote(sftp, primary);
                files.push({path: primary, mode: 0o600, content: mergeTraefikAcme(previousAcme, config.resolver,
                    artifact.domains, artifact.certificate, artifact.privateKey)});
            } else if (config.format === "pfx") {
                if (!secrets.pfxPassword) throw new Error("PFX password is required");
                files.push({path: primary, mode: 0o600, content: new Uint8Array(await pemToPfxBuffer(
                    artifact.privateKey, artifact.certificate, secrets.pfxPassword, artifact.domains[0]))});
            } else {
                files.push({path: primary, content: artifact.certificate, mode: 0o644},
                    {path: remotePath(config.privateKeyPath), content: artifact.privateKey, mode: config.privateKeyMode === "0640" ? 0o640 : 0o600});
                if (provider === "traefik") {
                    const path = remotePath(config.dynamicPath);
                    let existing: any = {};
                    try { existing = parseYaml(await readRemote(sftp, path), {maxAliasCount: 10}) ?? {}; }
                    catch (error) { if (Number((error as any).code) !== 2) throw new Error("Unable to read or parse Traefik dynamic configuration"); }
                    if (typeof existing !== "object" || Array.isArray(existing)) throw new Error("Invalid Traefik dynamic configuration");
                    const certificates = existing.tls?.certificates ?? [];
                    if (!Array.isArray(certificates)) throw new Error("Invalid Traefik TLS certificates");
                    existing.tls = {...existing.tls, certificates: [...certificates.filter((entry: any) => entry.certFile !== primary),
                        {certFile: primary, keyFile: config.privateKeyPath}]};
                    files.push({path, content: stringifyYaml(existing), mode: 0o644});
                }
            }
            if (new Set(files.map((file) => file.path)).size !== files.length) throw new Error("Deployment file paths must be different");
            const activate = async () => {
                await command(client, config.testCommand || (provider === "nginx" ? "nginx -t" : undefined));
                await command(client, config.reloadCommand || (provider === "nginx" ? "nginx -s reload" : undefined));
            };
            await replaceRemoteFiles(sftp, files, activate, activate, acmeMode ? async () => {
                if (await readRemote(sftp, primary) !== previousAcme) throw new Error("acme.json changed during deployment; refusing overwrite");
            } : undefined);
        } finally { await sftpCall(sftp, "rmdir", lock); sftp.end(); }
    });
}