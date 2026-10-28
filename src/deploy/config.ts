import {publicHttps} from "./network";
import {remotePath, validateSshConfig} from "./ssh";
import {cloudMarket} from '../edge/endpoints';

export function validateResourceConfig(provider: string, config: Record<string, any>, secrets: Record<string, string>): void {
    const fields: Record<string, string[]> = {
        cloudflare: [], dnspod: [], alidns: [], https: ["url", "method", "timeout"],
        ssh: ["host", "port", "username", "fingerprint", "timeout", "format", "certificatePath", "privateKeyPath", "pfxPath", "privateKeyMode", "testCommand", "reloadCommand"],
        edgeone: ["zone_id", "hosts", "region", "alias", "mode", "certificate_id", "market"], esa: ["site_id", "cert_name", "certificate_id", "market"],
    };
    fields.nginx = fields.ssh;
    fields.traefik = [...fields.ssh, "traefikMode", "dynamicPath", "acmePath", "resolver", "externalWriterStopped"];
    const secretFields: Record<string, string[]> = {
        cloudflare: ["token"], dnspod: ["secretId", "secretKey"], alidns: ["accessKeyId", "accessKeySecret"],
        https: ["authToken", "authorization", "hmacSecret"], ssh: ["password", "privateKey", "passphrase", "pfxPassword"],
        edgeone: ["secretId", "secretKey"], esa: ["accessKeyId", "accessKeySecret"],
    };
    secretFields.nginx = secretFields.ssh;
    secretFields.traefik = secretFields.ssh;
    if (Object.keys(config).some((field) => !fields[provider]?.includes(field))
        || Object.keys(secrets).some((field) => !secretFields[provider]?.includes(field))) throw new Error("Unsupported configuration or credential field");
    const required = provider === "cloudflare" ? ["token"] : ["dnspod", "edgeone"].includes(provider)
        ? ["secretId", "secretKey"] : ["alidns", "esa"].includes(provider) ? ["accessKeyId", "accessKeySecret"] : [];
    if (required.some((field) => !secrets[field]?.trim())) throw new Error("Provider credentials are required");
    if (['edgeone', 'esa'].includes(provider)) cloudMarket(config.market);
    if (provider === "https") {
        publicHttps(config.url);
        if (config.method && !["POST", "PUT"].includes(config.method)) throw new Error("Invalid hook method");
        if (!secrets.authToken && !secrets.authorization) throw new Error("Hook authentication is required");
        if (Object.values(secrets).some((value) => /[\r\n]/.test(value))) throw new Error("Invalid hook credentials");
    }
    if (["ssh", "nginx", "traefik"].includes(provider)) {
        validateSshConfig(config);
        if (!secrets.password && !secrets.privateKey) throw new Error("SSH password or private key is required");
        if (config.format && !["pem", "pfx"].includes(config.format)) throw new Error("Unsupported certificate format");
        if (provider !== "ssh" && config.format === "pfx") throw new Error("Nginx and Traefik require PEM certificates");
        if (provider === "traefik" && config.traefikMode && !["pem", "acme-json"].includes(config.traefikMode)) throw new Error("Invalid Traefik mode");
        if (provider === "traefik" && config.traefikMode === "acme-json") {
            if (config.externalWriterStopped !== true) throw new Error("Stop external acme.json writers before enabling managed merge");
            remotePath(config.acmePath);
            if (!/^[A-Za-z0-9_-]{1,100}$/.test(config.resolver ?? "")) throw new Error("Traefik resolver is required");
        } else if (config.format === "pfx") {
            remotePath(config.pfxPath);
            if (!secrets.pfxPassword) throw new Error("PFX password is required");
        } else {
            remotePath(config.certificatePath);
            remotePath(config.privateKeyPath);
            if (config.certificatePath === config.privateKeyPath) throw new Error("Certificate and private key paths must differ");
            if (provider === "traefik") remotePath(config.dynamicPath);
        }
        if (config.privateKeyMode && !["0600", "0640"].includes(config.privateKeyMode)) throw new Error("Private key permissions must be 0600 or 0640");
    }
    if (provider === "edgeone" && config.hosts && (!Array.isArray(config.hosts) || config.hosts.length > 100
        || config.hosts.some((host: any) => typeof host !== "string"))) throw new Error("Invalid EdgeOne hosts");
    if (provider === 'edgeone' && config.mode && !['upload', 'bind'].includes(config.mode)) throw new Error('Invalid EdgeOne mode');
    if (config.certificate_id && !/^[A-Za-z0-9_-]{1,128}$/.test(config.certificate_id)) throw new Error('Invalid cloud certificate ID');
}