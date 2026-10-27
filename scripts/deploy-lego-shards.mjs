import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {join, relative, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const digestFiles = ["src/lego/provider-main.go", "src/lego/shard.ts", "src/dns-providers.generated.json", "scripts/create-lego-doh-overlay.mjs",
    "tests/lego-wasm-probe/runtime-shim.js", "tests/lego-wasm-probe/overlay/challenge/internal/client_zone.go", "tests/lego-wasm-probe/overlay/challenge/dns01/client_nameservers.go"];

export function remoteShardMatches(shard, health) {
    const sameMembers = (expected, actual) => Array.isArray(expected) && Array.isArray(actual)
        && expected.length === actual.length && new Set(actual).size === actual.length
        && expected.every((member) => actual.includes(member));
    return !!health && health.runtimeVersion === shard.runtimeVersion && health.buildHash === shard.buildHash
        && health.sourceHash === shard.sourceHash && sameMembers(shard.providers, health.providers)
        && sameMembers(shard.verifiedProviders ?? [], health.verifiedProviders ?? []);
}

function manifestHash(shard) {
    return createHash("sha256").update(JSON.stringify({runtimeVersion: shard.runtimeVersion,
        providers: shard.providers, verifiedProviders: shard.verifiedProviders ?? []})).digest("hex");
}

export async function verifierFetch(url, options, request = fetch) {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const response = await request(url, {...options, signal: AbortSignal.timeout(45000)});
            if ([502, 503, 504].includes(response.status) && attempt < 2) {
                await response.body?.cancel();
                continue;
            }
            return response;
        } catch (error) {
            if (attempt === 2) throw new Error('Remote verifier connection failed after bounded retries; main Worker unchanged', {cause: error});
        }
    }
}

export function mainDeploymentConfig(config, projectRoot, configDirectory, services) {
    const configPath = (path) => relative(configDirectory, resolve(projectRoot, path)).replaceAll("\\", "/");
    const bindings = new Set(services.map((service) => service.binding));
    return {...config, main: configPath(config.main), site: {...config.site, bucket: configPath(config.site.bucket)},
        alias: Object.fromEntries(Object.entries(config.alias ?? {}).map(([name, path]) => [name, configPath(path)])),
        services: [...(config.services ?? []).filter((service) => !bindings.has(service.binding)), ...services]};
}

export function deploymentPlan(report, existingNames = [], maximumWorkers = 100) {
    if (!/^v\d+\.\d+\.\d+$/.test(report.runtimeVersion ?? "") || !Array.isArray(report.shards) || !report.shards.length) throw new Error("Missing verified build report");
    const names = new Set(existingNames);
    const services = report.shards.map((shard) => {
        if (!/^shard-[a-z0-9]+$/.test(shard.id) || !/^LEGO_DNS_[A-Z0-9_]+$/.test(shard.binding)
            || !["built_unverified", "runtime_verified"].includes(shard.status)
            || shard.runtimeVersion !== report.runtimeVersion || !/^[a-f0-9]{64}$/.test(shard.buildHash ?? "")
            || !/^[a-f0-9]{64}$/.test(shard.sourceHash ?? "") || !(shard.wasmBytes > 0 && shard.wasmBytes <= 48 * 1024 * 1024)) {
            throw new Error("A DNS shard is stale, missing, incompatible or over its size limit");
        }
        return {binding: shard.binding, service: `acme-lego-${shard.id}`};
    });
    if (new Set(services.map((service) => service.binding)).size !== services.length || services.length > 50) throw new Error("Invalid or excessive DNS bindings");
    const additions = services.filter((service) => !names.has(service.service)).length;
    if (names.size + additions + 1 > maximumWorkers) throw new Error("DNS shards plus the temporary verification Worker exceed account capacity");
    return {runtimeVersion: report.runtimeVersion, services, additionalWorkers: additions, accountWorkersAfterDeployment: names.size + additions,
        activation: "Built providers require revision-bound account verification before issuance"};
}

async function deploy() {
    const report = JSON.parse(readFileSync(join(root, "src/lego-shards.generated.json"), "utf8"));
    const output = join(root, "_artifacts/lego-dns");
    let source = createHash("sha256").update(report.runtimeVersion + report.upstreamChecksum);
    for (const path of digestFiles) source.update(path).update(readFileSync(join(root, path)));
    const expectedSource = source.digest("hex");
    for (const shard of report.shards) {
        const actualHash = createHash("sha256").update(readFileSync(join(output, shard.id, "provider.wasm"))).digest("hex");
        if (actualHash !== shard.buildHash || expectedSource !== shard.sourceHash) throw new Error("DNS build is stale; run providers:update before deployment");
    }
    const apply = process.argv.includes("--apply");
    if (!apply) { console.log(JSON.stringify(deploymentPlan(report), null, 2)); return; }
    const account = process.env.CLOUDFLARE_ACCOUNT_ID;
    const token = process.env.CLOUDFLARE_API_TOKEN;
    if (!/^[a-f0-9]{32}$/.test(account ?? "") || !token) throw new Error("Existing Cloudflare account and API token environment are required");
    const api = async (path, method = "GET") => {
        const response = await verifierFetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
            method, headers: {Authorization: `Bearer ${token}`}, signal: AbortSignal.timeout(30000),
        });
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error(`Cloudflare operation failed (${response.status}, code ${body.errors?.[0]?.code ?? "unknown"})`);
        return body.result;
    };
    const workers = await api("/workers/scripts");
    const plan = deploymentPlan(report, workers.map((worker) => worker.id));
    const main = JSON.parse(readFileSync(join(root, "wrangler.jsonc"), "utf8"));
    if (main.name !== "acme") throw new Error("Refusing to deploy a different main Worker");
    const wrangler = join(root, "node_modules/wrangler/bin/wrangler.js");
    const progressPath = join(output, "deployment-progress.json");
    let progress = {};
    try { progress = JSON.parse(readFileSync(progressPath, "utf8")); } catch {}
    const latestVersion = async (name) => {
        try { return (await api(`/workers/scripts/${name}/versions`)).items?.[0]?.id; } catch { return undefined; }
    };
    const upload = async (config) => {
        const settings = JSON.parse(readFileSync(config, "utf8"));
        const shard = report.shards.find((entry) => settings.name === `acme-lego-${entry.id}`);
        const previous = progress[settings.name];
        if (shard && previous?.buildHash === shard.buildHash && previous?.sourceHash === shard.sourceHash
            && previous.manifestHash === manifestHash(shard) && previous.versionId
            && await latestVersion(settings.name) === previous.versionId) {
            console.log(`Already deployed and version verified: ${settings.name}`);
            return;
        }
        for (let attempt = 0; ; attempt++) {
            try {
                execFileSync(process.execPath, [wrangler, "deploy", "--config", config], {
                    cwd: root, stdio: "inherit", env: {...process.env, WRANGLER_SEND_METRICS: "false"},
                });
                break;
            } catch (error) {
                if (attempt >= 1) throw error;
                console.log(`Retrying Worker upload once: ${settings.name}`);
            }
        }
        if (shard) {
            progress[settings.name] = {buildHash: shard.buildHash, sourceHash: shard.sourceHash,
                manifestHash: manifestHash(shard), versionId: await latestVersion(settings.name)};
            writeFileSync(progressPath, JSON.stringify(progress, null, 2));
        }
    };
    const checkName = `acme-lego-check-${Date.now().toString(36)}`;
    const checkDirectory = join(output, "remote-check");
    mkdirSync(checkDirectory, {recursive: true});
    const first = report.shards[0];
    const existingNames = new Set(workers.map((worker) => worker.id));
    if (!existingNames.has(plan.services[0].service)) await upload(join(output, first.id, "wrangler.jsonc"));
    const inventoryServices = plan.services.filter((service) => existingNames.has(service.service));
    writeFileSync(join(checkDirectory, "entry.js"), `export default {async fetch(request, env) {
        if (new URL(request.url).pathname === "/inventory" && request.method === "POST") {
            const services = ${JSON.stringify(inventoryServices)};
            return Response.json(await Promise.all(services.map(async service => {
                try {
                    const response = await env[service.binding].fetch("https://lego.internal/health", {signal: AbortSignal.timeout(5000)});
                    if (!response.ok) return {service: service.service};
                    return {service: service.service, health: await response.json()};
                } catch { return {service: service.service}; }
            })));
        }
        if (new URL(request.url).pathname !== "/check" || request.method !== "POST") return new Response(null, {status: 404});
        return env.DNS.fetch("https://lego.internal/test", {method: "POST", body: JSON.stringify({operation: "test", groups: []})});
    }};\n`);
    const checkConfig = {name: checkName, main: "entry.js", compatibility_date: "2026-01-01", workers_dev: true,
        observability: {enabled: false}, services: [{binding: "DNS", service: plan.services[0].service}, ...inventoryServices]};
    const checkPath = join(checkDirectory, "wrangler.jsonc");
    writeFileSync(checkPath, JSON.stringify(checkConfig, null, 2));
    let verifierCreated = false;
    try {
        await upload(checkPath);
        verifierCreated = true;
        const subdomain = await api("/workers/subdomain");
        const checkUrl = `https://${checkName}.${subdomain.subdomain}.workers.dev/check`;
        if (inventoryServices.length) {
            let inventoryResponse;
            for (let attempt = 0; attempt < 4; attempt++) {
                inventoryResponse = await verifierFetch(checkUrl.replace("/check", `/inventory?attempt=${attempt}`), {
                    method: "POST", headers: {"Cache-Control": "no-cache"},
                });
                if (inventoryResponse.status !== 404) break;
                await inventoryResponse.body?.cancel();
                if (attempt < 3) await api(`/workers/scripts/${checkName}/subdomain`);
            }
            if (!inventoryResponse.ok) throw new Error(`Remote shard inventory failed (HTTP ${inventoryResponse.status}); main Worker unchanged`);
            const inventory = await inventoryResponse.json();
            for (const item of inventory) {
                const shard = report.shards.find((entry) => item.service === `acme-lego-${entry.id}`);
                if (!shard || !remoteShardMatches(shard, item.health)) continue;
                const versionId = await latestVersion(item.service);
                if (!versionId) continue;
                progress[item.service] = {buildHash: shard.buildHash, sourceHash: shard.sourceHash,
                    manifestHash: manifestHash(shard), versionId};
                console.log(`Recovered matching deployed shard: ${item.service}`);
            }
            writeFileSync(progressPath, JSON.stringify(progress, null, 2));
        }
        await upload(join(output, first.id, "wrangler.jsonc"));
        let response;
        let responseText = "";
        for (let attempt = 0; attempt < 4; attempt++) {
            response = await verifierFetch(`${checkUrl}?attempt=${attempt}`, {
                method: "POST", headers: {"Cache-Control": "no-cache"},
            });
            responseText = await response.text();
            if (response.status !== 404) break;
            if (attempt < 3) await api(`/workers/scripts/${checkName}/subdomain`);
        }
        let result;
        try { result = JSON.parse(responseText); } catch {}
        if (!response.ok || !result?.ok || !result?.cleanupOk || !result?.tested) {
            writeFileSync(join(output, "remote-runtime-check.json"), JSON.stringify({httpStatus: response.status, ok: false,
                response: responseText.slice(0, 2000), checkedAt: new Date().toISOString()}, null, 2));
            throw new Error(`Online Go runtime check failed (HTTP ${response.status}); main Worker unchanged, no paid plan enabled`);
        }
        writeFileSync(join(output, "remote-runtime-check.json"), JSON.stringify({httpStatus: response.status, ok: true, runtimeVersion: result.runtimeVersion,
            runtimeMetrics: result.runtimeMetrics, checkedAt: new Date().toISOString()}, null, 2));
    } finally {
        if (verifierCreated) await api(`/workers/scripts/${checkName}`, "DELETE");
    }
    for (const shard of report.shards.slice(1)) await upload(join(output, shard.id, "wrangler.jsonc"));
    const mainPath = join(output, "main.wrangler.jsonc");
    writeFileSync(mainPath, JSON.stringify(mainDeploymentConfig(main, root, output, plan.services), null, 2));
    await upload(mainPath);
    writeFileSync(join(output, "deployment-report.json"), JSON.stringify({...plan, deployedAt: new Date().toISOString()}, null, 2));
    console.log("DNS services and main Worker deployed; encrypted resources and Worker secrets were not changed.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    deploy().catch((error) => { console.error(error.message); process.exitCode = 1; });
}