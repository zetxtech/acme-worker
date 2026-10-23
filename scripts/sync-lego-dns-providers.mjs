import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

export const DEFAULT_TAG = "v5.5.2";
export const MODULE_SUM = "h1:SJ5cMZDoyg5hB6tYpZoFcwgzkJVJI1yu5f0N8gAEeVs=";
const {parse: parseToml} = createRequire(import.meta.url)("toml");
const MODULE = "github.com/go-acme/lego/v5";
const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const READY_NATIVE = new Map([
    ["alidns", {adapter: "native", applicationProvider: "alidns", test: "DNSPod and Alibaba use signed real provider payloads"}],
    ["cloudflare", {adapter: "native", applicationProvider: "cloudflare", test: "Cloudflare token provider preserves apex/wildcard TXT values"}],
    ["tencentcloud", {adapter: "native", applicationProvider: "dnspod", test: "DNSPod and Alibaba use signed real provider payloads"}],
]);
const DISPLAY_NAMES = new Map([["alidns", "Alibaba Cloud DNS"], ["cloudflare", "Cloudflare DNS"], ["tencentcloud", "Tencent Cloud DNS"]]);
const MAX_IMPORTS_PER_SHARD = 7;
const NATIVE_SCHEMA = {
    alidns: ["accessKeyId", "accessKeySecret"], cloudflare: ["token"], tencentcloud: ["secretId", "secretKey"],
};

function walkFiles(directory) {
    const files = [];
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) files.push(...walkFiles(path));
        else if (entry.name.endsWith(".go") && !entry.name.endsWith("_test.go")) files.push(path);
    }
    return files;
}

function titleCase(value) {
    return value.split(/[-_]/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}

function readProvider(directory, packageName, tag) {
    const files = walkFiles(directory);
    const source = files.map((path) => readFileSync(path, "utf8")).join("\n");
    const metadataPath = join(directory, `${packageName}.toml`);
    let metadata;
    try { metadata = parseToml(readFileSync(metadataPath, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw new Error(`Invalid upstream metadata: ${packageName}`, {cause: error}); }
    const readmePath = join(directory, "README.md");
    let readme = "";
    try { readme = readFileSync(readmePath, "utf8"); } catch {}

    const packageMatch = source.match(/^package\s+([A-Za-z_][A-Za-z0-9_]*)/m);
    const packageDecl = packageMatch?.[1] ?? packageName;
    const documentedName = source.match(/^\/\/ Package [A-Za-z_][A-Za-z0-9_]* implements a DNS provider for solving the DNS-01 challenge using (.+?)\./m)?.[1]
        ?? readme.match(/^#\s+(.+)$/m)?.[1];
    const envNames = new Set();
    const envSymbols = new Map();
    const namespace = source.match(/\benvNamespace\s*=\s*"([A-Z][A-Z0-9_]*)"/)?.[1] ?? "";
    const envConstantPattern = /^\s*(?:const\s+)?(Env[A-Za-z0-9_]+)\s*=\s*(?:envNamespace\s*\+\s*)?"([A-Z][A-Z0-9_]*)"/gm;
    for (const match of source.matchAll(envConstantPattern)) {
        const name = match[2].startsWith(namespace) ? match[2] : `${namespace}${match[2]}`;
        envSymbols.set(match[1], name);
        envNames.add(name);
    }
    const requiredNames = new Set();
    for (const match of source.matchAll(/\benv\.Get\s*\(([^)]*)\)/g)) {
        for (const symbol of match[1].matchAll(/\bEnv[A-Za-z0-9_]+\b/g)) {
            const name = envSymbols.get(symbol[0]);
            if (name) requiredNames.add(name);
        }
    }
    const documentedEnvPattern = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;
    for (const match of readme.matchAll(documentedEnvPattern)) envNames.add(match[0]);
    let credentials = [...envNames].sort().map((name) => {
        const line = readme.split(/\r?\n/).find((item) => item.includes(name)) ?? "";
        const cells = line.split("|").map((cell) => cell.trim()).filter(Boolean);
        const description = cells.find((cell) => cell !== name && !/^[-: ]+$/.test(cell)) ?? "";
        const required = requiredNames.has(name) || /\b(required|mandatory)\b/i.test(line);
        return {name, type: "string", required, description: description || ""};
    });
    const documentedFields = (fields) => Object.entries(fields ?? {}).sort(([left], [right]) => left.localeCompare(right))
        .map(([name, description]) => ({name, type: "string", required: false, description: String(description),
            blocked: /(?:_FILE|_PATH|_DIR|_COMMAND|_EXEC|_BASE_URL|_ENDPOINT|_SERVER|_URL)$/.test(name)}));
    const options = documentedFields(metadata?.Configuration?.Additional);
    if (metadata) {
        if (metadata.Code !== packageName) throw new Error(`Upstream metadata code mismatch: ${packageName}`);
        credentials = documentedFields(metadata.Configuration?.Credentials);
        const singleCredentialGroup = [...source.matchAll(/\benv\.Get\s*\(/g)].length === 1
            && !/env\.GetWithFallback/.test(source) && !credentials.some((field) => /alias/i.test(field.description));
        if (singleCredentialGroup) credentials = credentials.map((field) => ({...field, required: requiredNames.has(field.name)}));
    }

    const packageDocs = files.map((path) => readFileSync(path, "utf8").split(/^package\s/m)[0]).join("\n");
    const deprecatedMatch = packageDocs.match(/Deprecated:\s*([^\r\n]*)/);
    const unsupported = [];
    if (/"os\/exec"/.test(source) || /\bexec\.Command\s*\(/.test(source)) unsupported.push("provider invokes subprocesses");
    if (/"os\/user"/.test(source) || /user\.Current\s*\(/.test(source)) unsupported.push("provider requires operating-system identity APIs unavailable in Workers");
    if (/net\.Dial(?:Timeout)?\s*\(\s*"udp"/.test(source)) unsupported.push("provider opens raw UDP sockets, unavailable in Workers");
    if (/os\.(?:Create|WriteFile|Mkdir|MkdirAll)\s*\(/.test(source)) unsupported.push("provider requires filesystem writes, unavailable in Workers");
    if (/os\.(?:ReadFile|Open|OpenFile)\s*\(/.test(source)) unsupported.push("provider reads filesystem credentials or configuration");
    if (/\b(?:dns\.Exchange|\.ExchangeContext|net\.DialTimeout)\s*\(/.test(source)) unsupported.push("provider uses a direct network resolver instead of the shared DoH path");
    if (/InstancePrincipal|InstanceIdentity|instance.?metadata|ManagedIdentityCredential|WorkloadIdentityCredential|DefaultAzureCredential|DefaultClient\(ctx/i.test(source)) unsupported.push("provider identity discovery is not verified in Workers");
    if (/\bos\.Stdin\b/.test(source)) unsupported.push("provider requires interactive standard input");
    if (/LoadDefaultConfig\s*\(/.test(source)) unsupported.push("provider default cloud credential/file/instance identity chain is not verified in Workers");
    if (packageName === "bunny") unsupported.push("upstream cleanup selects the first TXT by name/type instead of the owned value or record ID");

    const hasFactory = /func\s+NewDNSProvider\s*\(/.test(source);
    const native = READY_NATIVE.get(packageName);
    const status = native ? "ready" : unsupported.length ? "incompatible" : "not_implemented";
    const reason = native ? "Uses the existing Worker-native DNS adapter and its lifecycle tests."
        : unsupported.length ? unsupported.join("; ")
            : !hasFactory ? "Upstream package does not expose the expected NewDNSProvider constructor."
                : "Awaiting built shard, same-invocation lifecycle verification and service binding.";

    return {
        id: packageName,
        displayName: DISPLAY_NAMES.get(packageName) ?? metadata?.Name ?? documentedName ?? titleCase(packageName),
        package: `${MODULE}/providers/dns/${packageName}`,
        packageName: packageDecl,
        upstreamTag: tag,
        deprecated: Boolean(deprecatedMatch),
        deprecatedReason: deprecatedMatch?.[1]?.trim() || (deprecatedMatch ? "Deprecated upstream." : null),
        credentials,
        options,
        resourceSchema: native ? {credentials: NATIVE_SCHEMA[packageName].map((name) => ({name, type: "string", required: true, description: name})), options: []}
            : {credentials: credentials.filter((field) => !field.blocked), options: options.filter((field) => !field.blocked)},
        schemaSource: metadata ? "upstream-toml" : "source-fallback",
        sourceChecksum: createHash("sha256").update(files.sort().map((path) => readFileSync(path, "utf8")).join("\n") + (metadata ? readFileSync(metadataPath, "utf8") : "")).digest("hex"),
        status,
        adapter: native?.adapter ?? null,
        applicationProvider: native?.applicationProvider ?? null,
        lifecycleTest: native?.test ?? null,
        reason,
        goFactoryAvailable: hasFactory,
        incompatibleReasons: unsupported,
    };
}

export function collectCatalog(sourceRoot, tag = DEFAULT_TAG) {
    const providersRoot = join(sourceRoot, "providers", "dns");
    const registryPath = join(providersRoot, "zz_gen_dns_providers.go");
    let ids;
    try {
        const registry = readFileSync(registryPath, "utf8");
        ids = [...registry.matchAll(/"github\.com\/go-acme\/lego\/v\d+\/providers\/dns\/([a-zA-Z0-9_-]+)"/g)]
            .map((match) => match[1]);
        if (!ids.length) throw new Error("lego DNS registry contains no provider imports");
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
        ids = readdirSync(providersRoot, {withFileTypes: true})
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name);
    }
    const providers = [...new Set(ids)]
        .map((id) => readProvider(join(providersRoot, id), id, tag))
        .sort((a, b) => a.id.localeCompare(b.id));
    return {upstream: MODULE, upstreamTag: tag, upstreamChecksum: MODULE_SUM, providerCount: providers.length, providers};
}

export function groupShardImports(providers, maxImports = MAX_IMPORTS_PER_SHARD) {
    if (!Number.isInteger(maxImports) || maxImports < 1) throw new Error("maxImports must be a positive integer");
    const candidates = providers.filter((provider) => provider.goFactoryAvailable && provider.status !== "incompatible");
    const shards = [];
    for (let offset = 0; offset < candidates.length; offset += maxImports) {
        const members = candidates.slice(offset, offset + maxImports);
        const number = String(shards.length + 1).padStart(3, "0");
        const aliases = members.map((provider, index) => ({...provider, alias: `provider${index + 1}`}));
        const imports = aliases.map((provider) => `\t${provider.alias} "${provider.package}"`).join("\n");
        const factories = aliases.map((provider) => `\t${JSON.stringify(provider.id)}: func() (challenge.Provider, error) { return ${provider.alias}.NewDNSProvider() },`).join("\n");
        shards.push({
            id: `shard-${number}`,
            status: "candidate_only",
            providers: members.map((provider) => provider.id),
            testSource: `package main\n\nimport "testing"\n\nfunc TestFactoryRegistry(t *testing.T) {\n\tif len(factories) != ${members.length} {\n\t\tt.Fatalf("factory count = %d, want ${members.length}", len(factories))\n\t}\n\tfor name, factory := range factories {\n\t\tif factory == nil {\n\t\t\tt.Fatalf("factory %s is nil", name)\n\t\t}\n\t}\n}\n`,
            source: `package main\n\nimport (\n\t"github.com/go-acme/lego/v5/challenge"\n${imports}\n)\n\nvar factories = map[string]func() (challenge.Provider, error){\n${factories}\n}\n`,
        });
    }
    return shards;
}

export function compareCatalogs(previous, next) {
    const before = new Map((previous?.providers ?? []).map((provider) => [provider.id, provider]));
    const after = new Map(next.providers.map((provider) => [provider.id, provider]));
    const added = [...after.keys()].filter((id) => !before.has(id)).sort();
    const removed = [...before.keys()].filter((id) => !after.has(id)).sort();
    const changed = [...after.keys()].filter((id) => before.has(id)
        && JSON.stringify(before.get(id)) !== JSON.stringify(after.get(id))).sort();
    return {added, removed, changed};
}

export function resolveUpstream(tag) {
    if (tag !== DEFAULT_TAG) throw new Error(`Unverified lego release: ${tag}; update the release checksum and DoH context pins explicitly`);
    const temporaryModule = mkdtempSync(join(tmpdir(), "cfworker-lego-sync-"));
    try {
        writeFileSync(join(temporaryModule, "go.mod"), "module provider-sync\n\ngo 1.26\n", "utf8");
        const result = execFileSync("go", ["mod", "download", "-json", `${MODULE}@${tag}`], {
            cwd: temporaryModule,
            encoding: "utf8",
            env: {...process.env, GOTOOLCHAIN: "auto"},
            stdio: ["ignore", "pipe", "inherit"],
        });
        const module = JSON.parse(result);
        if (module.Error || !module.Dir) throw new Error(module.Error || `Go module source not found for ${tag}`);
        if (module.Sum !== MODULE_SUM) throw new Error(`Upstream checksum mismatch for ${tag}`);
        return module.Dir;
    } finally {
        rmSync(temporaryModule, {recursive: true, force: true});
    }
}

function renderReport(tag, report) {
    const lines = [`lego DNS provider sync ${tag}`, `Added (${report.added.length}): ${report.added.join(", ") || "none"}`,
        `Removed (${report.removed.length}): ${report.removed.join(", ") || "none"}`,
        `Changed (${report.changed.length}): ${report.changed.join(", ") || "none"}`];
    return `${lines.join("\n")}\n`;
}

export function syncFromSource({sourceRoot, tag = DEFAULT_TAG, outputRoot, write = false, check = false}) {
    const catalog = collectCatalog(sourceRoot, tag);
    const shards = groupShardImports(catalog.providers);
    const catalogPath = join(outputRoot, "src", "dns-providers.generated.json");
    let previous;
    try { previous = JSON.parse(readFileSync(catalogPath, "utf8")); } catch {}
    const report = compareCatalogs(previous, catalog);
    const output = {
        ...catalog,
        shards: shards.map(({id, status, providers}) => ({id, status, providers})),
    };
    const serialized = `${JSON.stringify(output, null, 2)}\n`;
    if (check && readFileSync(catalogPath, "utf8") !== serialized) throw new Error("Generated provider registry is stale; run providers:sync");
    if (check) for (const shard of shards) {
        const directory = join(outputRoot, "tests", "lego-wasm-probe", "generated", "shards", shard.id);
        if (readFileSync(join(directory, "providers.go"), "utf8") !== shard.source
            || readFileSync(join(directory, "providers_test.go"), "utf8") !== shard.testSource) throw new Error(`Generated factory imports are stale: ${shard.id}`);
    }
    if (write) {
        mkdirSync(join(outputRoot, "src"), {recursive: true});
        const shardRoot = join(outputRoot, "tests", "lego-wasm-probe", "generated", "shards");
        mkdirSync(shardRoot, {recursive: true});
        writeFileSync(join(outputRoot, "tests", "lego-wasm-probe", "generated", "go.mod"),
            "module cfworkeracme/lego-dns-provider-shards\n\ngo 1.26.0\n\nrequire github.com/go-acme/lego/v5 v5.5.2\n", "utf8");
        try {
            writeFileSync(join(outputRoot, "tests", "lego-wasm-probe", "generated", "go.sum"),
                readFileSync(join(sourceRoot, "go.sum")));
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
        }
        writeFileSync(catalogPath, serialized, "utf8");
        for (const shard of shards) {
            const shardDirectory = join(shardRoot, shard.id);
            mkdirSync(shardDirectory, {recursive: true});
            writeFileSync(join(shardDirectory, "providers.go"), shard.source, "utf8");
            writeFileSync(join(shardDirectory, "providers_test.go"), shard.testSource, "utf8");
        }
    }
    return {catalog, shards, report, output};
}

function parseArgs(args) {
    const options = {tag: DEFAULT_TAG, write: false};
    for (let index = 0; index < args.length; index++) {
        const value = args[index];
        if (value === "--write") options.write = true;
        else if (value === "--dry-run") options.write = false;
        else if (value === "--check") options.check = true;
        else if (value === "--tag") options.tag = args[++index];
        else throw new Error(`Unknown argument: ${value}`);
    }
    if (!/^v\d+\.\d+\.\d+$/.test(options.tag ?? "")) throw new Error("--tag must be a fixed lego release tag such as v5.5.2");
    return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const options = parseArgs(process.argv.slice(2));
        const sourceRoot = resolveUpstream(options.tag);
        const result = syncFromSource({sourceRoot, tag: options.tag, outputRoot: PROJECT_ROOT, write: options.write, check: options.check});
        process.stdout.write(renderReport(options.tag, result.report));
        process.stdout.write(`Providers: ${result.catalog.providerCount}; candidate shards: ${result.shards.length}; ready: ${result.catalog.providers.filter((provider) => provider.status === "ready").length}.\n`);
        process.stdout.write(options.write ? "Generated catalog and shard import sources updated.\n" : "Dry run only; no project files changed.\n");
    } catch (error) {
        process.stderr.write(`${error.stack ?? error}\n`);
        process.exitCode = 1;
    }
}