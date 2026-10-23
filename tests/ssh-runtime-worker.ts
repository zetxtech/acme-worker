import {Client, utils} from "ssh2";
import {createECDH, createCipheriv, generateKeyPairSync} from "node:crypto";
import {deploySsh, hostFingerprintMatches} from "../src/deploy/ssh";

export default {
    async fetch(request: Request): Promise<Response> {
        if (new URL(request.url).pathname === "/sftp-fixture" && request.method === "POST") {
            const body: any = await request.json();
            const config = {host: "fixture.example.com", port: body.port, username: "fixture", fingerprint: body.fingerprint,
                certificatePath: "/cert.pem", privateKeyPath: "/key.pem", format: "pem", ...body.config};
            const session = async (settings: any, secrets: any, action: any) => {
                const client = new Client();
                try {
                    return await new Promise((resolve, reject) => {
                        const timer = setTimeout(() => { client.destroy(); reject(new Error("Fixture timed out")); }, 15000);
                        client.on("error", (error: Error) => { clearTimeout(timer); reject(error); });
                        client.on("ready", async () => {
                            try { resolve(await action(client)); } catch (error) { reject(error); }
                            finally { clearTimeout(timer); client.end(); }
                        });
                        client.connect({host: "127.0.0.1", port: body.port, username: "fixture", password: secrets.password,
                            privateKey: secrets.privateKey, readyTimeout: 10000, hostHash: "sha256",
                            hostVerifier: (hex: string) => hostFingerprintMatches(settings.fingerprint, hex),
                            algorithms: {kex: ["ecdh-sha2-nistp256"], cipher: ["aes128-ctr"], hmac: ["hmac-sha2-256-etm@openssh.com", "hmac-sha2-256"]}});
                    });
                } finally { client.destroy(); }
            };
            try {
                await deploySsh(body.provider ?? "nginx", config, {...(body.privateKey ? {privateKey: body.privateKey} : {password: body.password}),
                    ...(body.pfxPassword ? {pfxPassword: body.pfxPassword} : {})},
                    body.artifact ?? {certificate: "fixture-new-cert", privateKey: "fixture-new-key", domains: ["example.com"]}, session as any);
                return Response.json({ok: true});
            } catch (error) { return Response.json({ok: false, error: (error as Error).message}); }
        }
        if (new URL(request.url).pathname === "/handshake") {
            const metadata = await fetch("https://api.github.com/meta", {headers: {"User-Agent": "CFWorkerACME-runtime-smoke"}, signal: AbortSignal.timeout(5000)});
            const body: any = await metadata.json();
            const fingerprints = new Set(Object.values(body.ssh_key_fingerprints ?? {}));
            const client = new Client();
            let hostVerified = false;
            const result = await new Promise((resolve) => {
                const timer = setTimeout(() => { client.destroy(); resolve({hostVerified, error: "bounded timeout"}); }, 12000);
                const finish = (error: string) => { clearTimeout(timer); client.destroy(); resolve({hostVerified, error}); };
                client.on("error", (error: Error) => finish(error.message));
                client.on("ready", () => finish("unexpected authentication success"));
                try {
                    client.connect({host: "ssh.github.com", port: 443, username: "worker-runtime-smoke",
                        readyTimeout: 10000, hostHash: "sha256", hostVerifier: (hex: string) => {
                            const fingerprint = Buffer.from(hex, "hex").toString("base64").replace(/=+$/, "");
                            hostVerified = fingerprints.has(fingerprint) || fingerprints.has(`SHA256:${fingerprint}`);
                            return hostVerified;
                        }, algorithms: {kex: ["ecdh-sha2-nistp256"], cipher: ["aes128-ctr"],
                            hmac: ["hmac-sha2-256-etm@openssh.com", "hmac-sha2-256"]}});
                } catch (error) { finish((error as Error).message); }
            });
            return Response.json(result);
        }
        const checks: Record<string, string> = {};
        for (const [name, check] of Object.entries({
            client: () => new Client(),
            ecdh: () => {
                const local = createECDH("prime256v1");
                const remote = createECDH("prime256v1");
                local.generateKeys();
                remote.generateKeys();
                return local.computeSecret(remote.getPublicKey());
            },
            cipher: () => {
                const cipher = createCipheriv("aes-128-gcm", Buffer.alloc(16), Buffer.alloc(12));
                cipher.update(Buffer.from("worker-runtime-probe"));
                return cipher.final();
            },
            key: () => {
                const pair = utils.generateKeyPairSync("ecdsa", {bits: 256});
                const parsed = utils.parseKey(pair.private);
                if (parsed instanceof Error) throw parsed;
                return parsed;
            },
        })) {
            try { check(); checks[name] = "ok"; }
            catch (error) { checks[name] = (error as Error).message; }
        }
        return Response.json(checks);
    },
};