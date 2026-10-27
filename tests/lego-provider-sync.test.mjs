import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {isAbsolute, join, resolve} from "node:path";
import test from "node:test";
import {collectCatalog, compareCatalogs, groupShardImports, syncFromSource} from "../scripts/sync-lego-dns-providers.mjs";
import {createOverlay} from "../scripts/create-lego-doh-overlay.mjs";
import {deploymentPlan, mainDeploymentConfig, remoteShardMatches, verifierFetch} from "../scripts/deploy-lego-shards.mjs";

test("ordinary production deployment preserves DNS shard bindings through the verified publisher", () => {
    const settings = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    assert.match(settings.scripts["deploy-cf"], /npm run providers:deploy/);
    assert.doesNotMatch(settings.scripts["deploy-cf"], /wrangler deploy/);
});

test("main deployment uses config-relative portable paths and preserves unrelated bindings", () => {
    const projectRoot = resolve("fixture-project");
    const directory = join(projectRoot, "_artifacts", "lego-dns");
    const services = [{binding: "LEGO_DNS_SHARD_001", service: "acme-lego-shard-001"}];
    const durable = {bindings: [{name: 'ORDER_WORKFLOW', class_name: 'CertificateWorkflow'}]};
    const migrations = [{tag: 'v1-workflow', new_sqlite_classes: ['CertificateWorkflow']}];
    const config = mainDeploymentConfig({name: "acme", main: "src/cfapp.ts", site: {bucket: "./public"},
        durable_objects: durable, migrations,
        alias: {"cpu-features": "./src/deploy/cpu-features.cjs"},
        services: [{binding: "OTHER", service: "other"}, {binding: "LEGO_DNS_SHARD_001", service: "stale"}]},
    projectRoot, directory, services);
    assert.equal(isAbsolute(config.site.bucket), false);
    assert.equal(config.site.bucket.includes("\\"), false);
    assert.equal(resolve(directory, config.site.bucket), join(projectRoot, "public"));
    assert.equal(resolve(directory, config.main), join(projectRoot, "src", "cfapp.ts"));
    assert.equal(resolve(directory, config.alias["cpu-features"]), join(projectRoot, "src", "deploy", "cpu-features.cjs"));
    assert.deepEqual(config.services, [{binding: "OTHER", service: "other"}, ...services]);
    assert.deepEqual(config.durable_objects, durable);
    assert.deepEqual(config.migrations, migrations);
});

test('verifier retries transient connections with a fresh deadline and never pretends success', async () => {
    let requests = 0;
    const signals = [];
    const response = await verifierFetch('https://verifier.example/check', {method: 'POST'}, async (_url, options) => {
        signals.push(options.signal);
        if (++requests === 1) throw new Error('connection reset');
        return Response.json({ok: true});
    });
    assert.equal(requests, 2);
    assert.notEqual(signals[0], signals[1]);
    assert.equal((await response.json()).ok, true);
    requests = 0;
    await assert.rejects(verifierFetch('https://verifier.example/check', {method: 'POST'}, async () => {
        requests++;
        throw new Error('connection reset');
    }), /main Worker unchanged/);
    assert.equal(requests, 3);
    requests = 0;
    const unavailable = await verifierFetch('https://verifier.example/check', {method: 'POST'}, async () => {
        requests++;
        return new Response('unavailable', {status: 503});
    });
    assert.equal(unavailable.status, 503);
    assert.equal(requests, 3);
});

test("deployment recovery only trusts matching remote versions, hashes and provider coverage", () => {
    const shard = {runtimeVersion: "v5.5.2", buildHash: "a".repeat(64), sourceHash: "b".repeat(64),
        providers: ["cloudflare", "digitalocean"], verifiedProviders: ["cloudflare"]};
    assert.equal(remoteShardMatches(shard, {...shard}), true);
    assert.equal(remoteShardMatches(shard, {...shard, runtimeVersion: "v5.5.1"}), false);
    assert.equal(remoteShardMatches(shard, {...shard, buildHash: "c".repeat(64)}), false);
    assert.equal(remoteShardMatches(shard, {...shard, sourceHash: "d".repeat(64)}), false);
    assert.equal(remoteShardMatches(shard, {...shard, providers: ["cloudflare"]}), false);
    assert.equal(remoteShardMatches(shard, {...shard, verifiedProviders: []}), false);
    assert.equal(remoteShardMatches(shard, null), false);
});

test("deployment plan enforces actual build evidence, size and account capacity without deploying", () => {
    const shard = {id: "shard-001", binding: "LEGO_DNS_SHARD_001", runtimeVersion: "v5.5.2", status: "built_unverified",
        buildHash: "a".repeat(64), sourceHash: "b".repeat(64), wasmBytes: 15000000};
    const report = {runtimeVersion: "v5.5.2", shards: [shard]};
    assert.equal(deploymentPlan(report, ["acme"]).accountWorkersAfterDeployment, 2);
    assert.equal(deploymentPlan(report, ["acme", "acme-lego-shard-001"]).additionalWorkers, 0);
    assert.throws(() => deploymentPlan(report, Array.from({length: 99}, (_, index) => `existing-${index}`)), /capacity/);
    assert.throws(() => deploymentPlan({...report, shards: [{...shard, wasmBytes: 70 * 1024 * 1024}]}), /size/);
    assert.throws(() => deploymentPlan({...report, shards: [{...shard, status: "build_failed"}]}), /stale/);
    assert.throws(() => deploymentPlan({...report, shards: [{...shard, buildHash: ""}]}), /stale/);
});

function fixtureProvider(root, id, source, readme = "") {
    const directory = join(root, "providers", "dns", id);
    mkdirSync(directory, {recursive: true});
    writeFileSync(join(directory, `${id}.go`), source, "utf8");
    if (readme) writeFileSync(join(directory, "README.md"), readme, "utf8");
}

test("catalogue extracts upstream env schema and never promotes unimplemented providers", () => {
    const root = mkdtempSync(join(tmpdir(), "lego-catalog-test-"));
    try {
        fixtureProvider(root, "cloudflare", `package cloudflare
import "os"
func NewDNSProvider() { _ = os.Getenv("CLOUDFLARE_DNS_API_TOKEN") }
`, "# Cloudflare\n| CLOUDFLARE_DNS_API_TOKEN | Required API token |\n");
        fixtureProvider(root, "unsafe", `// Package unsafe is a test provider.
    // Deprecated: use another provider.
    package unsafe
import "os/exec"
func NewDNSProvider() { _ = exec.Command("sh") }
`, "# Unsafe\n");
        fixtureProvider(root, "tencentcloud", `// Package tencentcloud implements a DNS provider for solving the DNS-01 challenge using Tencent Cloud DNS.
    package tencentcloud
    const envNamespace = "TENCENTCLOUD_"
    const EnvSecretID = envNamespace + "SECRET_ID"
    const EnvSecretKey = envNamespace + "SECRET_KEY"
    func NewDNSProvider() {}
    `);
        fixtureProvider(root, "newdns", `package newdns
func NewDNSProvider() {}
`, "# New DNS\n");
        fixtureProvider(root, "bunny", "package bunny\nfunc NewDNSProvider() {}\n");

        const catalog = collectCatalog(root, "v5.5.2");
        const cloudflare = catalog.providers.find((provider) => provider.id === "cloudflare");
        const unsafe = catalog.providers.find((provider) => provider.id === "unsafe");
        const tencentcloud = catalog.providers.find((provider) => provider.id === "tencentcloud");
        const newdns = catalog.providers.find((provider) => provider.id === "newdns");
        assert.equal(cloudflare.status, "ready");
        assert.deepEqual(cloudflare.credentials, [{name: "CLOUDFLARE_DNS_API_TOKEN", type: "string", required: true, description: "Required API token"}]);
        assert.equal(unsafe.status, "incompatible");
        assert.match(unsafe.reason, /subprocesses/);
        assert.equal(unsafe.deprecated, true);
        assert.equal(unsafe.deprecatedReason, "use another provider.");
        assert.equal(tencentcloud.status, "ready");
        assert.equal(tencentcloud.displayName, "Tencent Cloud DNS");
        assert.deepEqual(tencentcloud.credentials.map((credential) => credential.name), ["TENCENTCLOUD_SECRET_ID", "TENCENTCLOUD_SECRET_KEY"]);
        assert.equal(newdns.status, "not_implemented");
        assert.match(newdns.reason, /same-invocation lifecycle/);
        assert.equal(catalog.providers.find((provider) => provider.id === "bunny").status, "incompatible");
    } finally {
        rmSync(root, {recursive: true, force: true});
    }
});

test("shard import sources and sync reports are deterministic and expose additions/removals/changes", () => {
    const providers = Array.from({length: 9}, (_, index) => ({
        id: `provider-${String(index).padStart(2, "0")}`,
        package: `github.com/go-acme/lego/v5/providers/dns/provider-${String(index).padStart(2, "0")}`,
        goFactoryAvailable: true,
        status: "not_implemented",
    }));
    const shards = groupShardImports(providers, 7);
    assert.deepEqual(shards.map((shard) => shard.providers.length), [7, 2]);
    assert.match(shards[0].source, /return provider1\.NewDNSProvider/);
    assert.equal(shards[0].status, "candidate_only");

    const before = {providers: [{id: "kept", status: "ready"}, {id: "removed", status: "ready"}]};
    const after = {providers: [{id: "added", status: "not_implemented"}, {id: "kept", status: "incompatible"}]};
    assert.deepEqual(compareCatalogs(before, after), {added: ["added"], removed: ["removed"], changed: ["kept"]});

    const root = mkdtempSync(join(tmpdir(), "lego-sync-test-"));
    try {
        fixtureProvider(root, "sample", "package sample\nfunc NewDNSProvider() {}\n");
        const result = syncFromSource({sourceRoot: root, outputRoot: root, tag: "v5.5.2", write: false});
        assert.equal(result.catalog.providerCount, 1);
        assert.equal(result.report.added.length, 1);
    } finally {
        rmSync(root, {recursive: true, force: true});
    }
});

test("DoH overlay pins upstream file contents and refuses a changed source context", () => {
    const root = mkdtempSync(join(tmpdir(), "lego-overlay-test-"));
    const sourceRoot = join(root, "upstream");
    const projectRoot = join(root, "project");
    const outputDirectory = join(root, "output");
    const files = ["challenge/internal/client_zone.go", "challenge/dns01/client_nameservers.go"];
    const expectedHashes = {};
    try {
        for (const relativePath of files) {
            const path = join(sourceRoot, relativePath);
            mkdirSync(join(path, ".."), {recursive: true});
            writeFileSync(path, `pinned ${relativePath}\n`, "utf8");
            const overridePath = join(projectRoot, "tests", "lego-wasm-probe", "overlay", relativePath);
            mkdirSync(join(overridePath, ".."), {recursive: true});
            writeFileSync(overridePath, `package ${relativePath.includes("dns01") ? "dns01" : "internal"}\n`, "utf8");
            expectedHashes[relativePath] = createHash("sha256").update(`pinned ${relativePath}\n`).digest("hex").toUpperCase();
        }
        const result = createOverlay({sourceRoot, outputDirectory, projectRoot, expectedHashes});
        assert.equal(Object.keys(result.replacements).length, 2);
        assert.throws(() => createOverlay({sourceRoot, outputDirectory, projectRoot,
            expectedHashes: {...expectedHashes, [files[0]]: "0".repeat(64)}}), /Pinned lego source changed/);
    } finally {
        rmSync(root, {recursive: true, force: true});
    }
});

test("official TOML separates credentials/options and check mode is deterministic and never writes", () => {
    const root = mkdtempSync(join(tmpdir(), "lego-official-schema-"));
    try {
        fixtureProvider(root, "sample", 'package sample\nfunc NewDNSProvider() {}\n');
        const metadata = join(root, "providers/dns/sample/sample.toml");
        writeFileSync(metadata, 'Name = "Example DNS"\nCode = "sample"\n[Configuration.Credentials]\nSAMPLE_TOKEN = "API token"\n[Configuration.Additional]\nSAMPLE_TTL = "TXT record TTL"\nSAMPLE_TOKEN_FILE = "Unsupported file"\n');
        const result = syncFromSource({sourceRoot: root, outputRoot: root, write: true});
        assert.equal(result.catalog.providers[0].schemaSource, "upstream-toml");
        assert.deepEqual(result.catalog.providers[0].credentials.map((field) => field.name), ["SAMPLE_TOKEN"]);
        assert.deepEqual(result.catalog.providers[0].resourceSchema.options.map((field) => field.name), ["SAMPLE_TTL"]);
        const generated = join(root, "src/dns-providers.generated.json");
        const before = readFileSync(generated, "utf8");
        syncFromSource({sourceRoot: root, outputRoot: root, check: true});
        assert.equal(readFileSync(generated, "utf8"), before);
        writeFileSync(metadata, readFileSync(metadata, "utf8") + '\nSAMPLE_TIMEOUT = "Request timeout"\n');
        assert.throws(() => syncFromSource({sourceRoot: root, outputRoot: root, check: true}), /registry is stale/);
        assert.equal(readFileSync(generated, "utf8"), before);
        assert.equal(readdirSync(root).includes("credentials.json"), false);
    } finally { rmSync(root, {recursive: true, force: true}); }
});

test('verifier transport protects authenticated control requests without changing credentials', async () => {
    let attempts = 0;
    const response = await verifierFetch('https://api.cloudflare.com/client/v4/accounts/fixture/workers/scripts',
        {method: 'GET', headers: {Authorization: 'Bearer synthetic-control-token'}}, async (url, options) => {
            assert.equal(new URL(url).hostname, 'api.cloudflare.com');
            assert.equal(options.headers.Authorization, 'Bearer synthetic-control-token');
            if (++attempts < 3) throw new Error('temporary connection reset');
            return Response.json({success: true, result: []});
        });
    assert.equal(attempts, 3);
    assert.equal((await response.json()).success, true);
});