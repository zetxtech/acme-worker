import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {cpSync, existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {gzipSync} from "node:zlib";
import {collectCatalog, groupShardImports, resolveUpstream, DEFAULT_TAG, MODULE_SUM} from "./sync-lego-dns-providers.mjs";
import {createOverlay} from "./create-lego-doh-overlay.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const output = join(root, "_artifacts", "lego-dns");
const args = process.argv.slice(2);
const requested = args.find((value) => value.startsWith("--providers="))?.slice(12).split(",");
if (!args.includes("--all") && !requested && !args.includes("--gates-only")) throw new Error("Select --all, --providers=id,id or --gates-only; this command never deploys");
const upstream = resolveUpstream(DEFAULT_TAG);
const localSource = join(output, "upstream");
mkdirSync(output, {recursive: true});
cpSync(upstream, localSource, {recursive: true});
const overlay = createOverlay({sourceRoot: localSource, outputDirectory: join(output, "overlay")});
const catalog = collectCatalog(upstream);
let members = catalog.providers.filter((provider) => provider.goFactoryAvailable && provider.status !== "incompatible");
if (requested) {
    for (const id of requested) if (!members.some((provider) => provider.id === id)) throw new Error(`Provider is missing or incompatible: ${id}`);
    members = members.filter((provider) => requested.includes(provider.id));
}
const goEnv = {...process.env, GOOS: "js", GOARCH: "wasm", GOTOOLCHAIN: "auto"};
const sourceDigest = createHash("sha256").update(DEFAULT_TAG + MODULE_SUM);
for (const path of ["src/lego/provider-main.go", "src/lego/shard.ts", "src/dns-providers.generated.json", "scripts/create-lego-doh-overlay.mjs",
    "tests/lego-wasm-probe/runtime-shim.js", "tests/lego-wasm-probe/overlay/challenge/internal/client_zone.go", "tests/lego-wasm-probe/overlay/challenge/dns01/client_nameservers.go"]) {
    sourceDigest.update(path).update(readFileSync(join(root, path)));
}
const sourceHash = sourceDigest.digest("hex");
const moduleText = `module acme-lego-shard\n\ngo 1.26.0\n\nrequire github.com/go-acme/lego/v5 ${DEFAULT_TAG}\n\nreplace github.com/go-acme/lego/v5 => ${JSON.stringify(localSource.replaceAll("\\", "/"))}\n`;
const results = [];
const maxWasm = 48 * 1024 * 1024;

function bundle(directory) {
    const dryRun = execFileSync(process.execPath, [join(root, "node_modules/wrangler/bin/wrangler.js"), "deploy", "--dry-run", "--config", join(directory, "wrangler.jsonc"), "--outdir", join(directory, "bundle")],
        {cwd: root, encoding: "utf8", env: {...process.env, WRANGLER_SEND_METRICS: "false"}, stdio: ["ignore", "pipe", "pipe"]});
    writeFileSync(join(directory, "dry-run.txt"), dryRun);
    return dryRun.match(/Total Upload:[^\r\n]+/)?.[0] ?? "not reported";
}

function writeReport(report) {
    writeFileSync(join(output, "build-report.json"), JSON.stringify(report, null, 2));
    writeFileSync(join(root, "src/lego-shards.generated.json"), JSON.stringify(report, null, 2) + "\n");
    writeFileSync(join(output, "service-bindings.json"), JSON.stringify({name: "acme", services: report.shards.filter((result) => result.status === "runtime_verified").map((result) => ({binding: result.binding, service: `acme-lego-${result.id}`}))}, null, 2));
}

if (args.includes("--gates-only")) {
    const report = JSON.parse(readFileSync(join(output, "build-report.json"), "utf8"));
    const evidence = JSON.parse(readFileSync(join(output, "runtime-evidence.json"), "utf8"));
    for (const manifest of report.shards) {
        if (!manifest.buildHash) continue;
        const directory = join(output, manifest.id);
        const actualHash = createHash("sha256").update(readFileSync(join(directory, "provider.wasm"))).digest("hex");
        manifest.verifiedProviders = manifest.sourceHash === sourceHash && actualHash === manifest.buildHash ? evidence.filter((entry) =>
            entry.buildHash === actualHash && entry.sourceHash === sourceHash && entry.cases >= 4 && entry.runtime === "workerd" && entry.maxSubrequests <= 50
            && entry.maxMemoryBytes > 0 && entry.maxMemoryBytes < 128 * 1024 * 1024).map((entry) => entry.provider) : [];
        manifest.status = manifest.verifiedProviders.length ? "runtime_verified" : "built_unverified";
        writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2));
        manifest.wranglerUpload = bundle(directory);
    }
    writeReport(report);
    console.log(`Verified execution adapters: ${report.shards.flatMap((shard) => shard.verifiedProviders ?? []).join(", ") || "none"}; no deployment performed.`);
    process.exit(0);
}

function build(id, providers) {
    const directory = join(output, id);
    mkdirSync(directory, {recursive: true});
    writeFileSync(join(directory, "go.mod"), moduleText);
    cpSync(join(upstream, "go.sum"), join(directory, "go.sum"));
    cpSync(join(root, "src/lego/provider-main.go"), join(directory, "main.go"));
    writeFileSync(join(directory, "providers.go"), groupShardImports(providers, providers.length)[0].source);
    const runGo = (command) => execFileSync("go", command, {cwd: directory, env: goEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
    let wasm;
    try {
        runGo(["build", "-mod=mod", "-trimpath", "-buildvcs=false", "-ldflags=-s -w", `-overlay=${overlay.overlayPath}`, "-o", join(directory, "provider.wasm"), "."]);
        wasm = readFileSync(join(directory, "provider.wasm"));
    } catch (error) {
        const message = String(error.stderr ?? error.message).slice(-5000).replaceAll(localSource, "<upstream>").replaceAll(root, "<project>");
        results.push({id, providers: providers.map((provider) => provider.id), status: "build_failed", reason: message});
        console.log(`${id}: build failed (disabled)`);
        return;
    }
    if (wasm.length > maxWasm && providers.length > 1) {
        const middle = Math.ceil(providers.length / 2);
        build(`${id}a`, providers.slice(0, middle));
        build(`${id}b`, providers.slice(middle));
        return;
    }
    const manifest = {id, binding: `LEGO_DNS_${id.replaceAll("-", "_").toUpperCase()}`, runtimeVersion: DEFAULT_TAG, upstreamChecksum: MODULE_SUM,
        sourceHash, buildHash: createHash("sha256").update(wasm).digest("hex"), providers: providers.map((provider) => provider.id),
        verifiedProviders: [], wasmBytes: wasm.length, gzipBytes: gzipSync(wasm).length, status: wasm.length <= maxWasm ? "built_unverified" : "size_blocked"};
    const goRoot = runGo(["env", "GOROOT"]);
    manifest.toolchain = runGo(["version"]);
    cpSync(join(goRoot, "lib/wasm/wasm_exec.js"), join(directory, "wasm_exec.js"));
    cpSync(join(root, "tests/lego-wasm-probe/runtime-shim.js"), join(directory, "runtime-shim.js"));
    writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2));
    const entry = `import wasm from "./provider.wasm";\nimport "./runtime-shim.js";\nimport "./wasm_exec.js";\nimport {createShard} from ${JSON.stringify(join(root, "src/lego/shard.ts").replaceAll("\\", "/"))};\nimport manifest from "./manifest.json";\nexport default createShard(wasm, manifest);\n`;
    writeFileSync(join(directory, "entry.ts"), entry);
    const config = {name: `acme-lego-${id}`, main: "entry.ts", compatibility_date: "2026-01-01", compatibility_flags: ["nodejs_compat"], workers_dev: false, preview_urls: false, observability: {enabled: false}};
    writeFileSync(join(directory, "wrangler.jsonc"), JSON.stringify(config, null, 2));
    try {
        manifest.wranglerUpload = bundle(directory);
    } catch (error) { manifest.status = "bundle_failed"; manifest.reason = String(error.stderr ?? error.message).slice(-3000); }
    writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2));
    results.push(manifest);
    console.log(`${id}: ${manifest.status}; ${providers.length} providers; ${wasm.length} bytes; gzip ${manifest.gzipBytes}; ${manifest.wranglerUpload ?? "no bundle"}`);
}

for (const group of groupShardImports(members)) build(group.id, members.filter((provider) => group.providers.includes(provider.id)));
const report = {runtimeVersion: DEFAULT_TAG, upstreamChecksum: MODULE_SUM, providerCount: catalog.providerCount,
    incompatible: catalog.providers.filter((provider) => provider.status === "incompatible").map(({id, reason}) => ({id, reason})),
    limitsSource: "https://developers.cloudflare.com/workers/platform/limits/ (2026-10-12)",
    limits: {freeWorkerCount: 100, paidWorkerCount: 5001, uncompressedBytes: 64 * 1024 * 1024, compressedLimit: null, memoryBytes: 128 * 1024 * 1024, freeCpuMs: 10, paidMaxCpuMs: 300000, startupMs: 1000, freeSubrequests: 50, paidSubrequests: 10000, simultaneousConnections: 6},
    shards: results};
writeReport(report);
console.log(`Built ${results.filter((result) => result.status === "built_unverified").length}/${results.length} shards; verified execution providers: 0. No remote resources created.`);
if (results.some((result) => result.status !== "built_unverified") || results.length > 99) process.exitCode = 1;