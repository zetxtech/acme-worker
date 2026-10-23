import assert from "node:assert/strict";
import {createHash, createPublicKey, verify} from "node:crypto";
import {readFileSync, writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {join, resolve} from "node:path";
import test from "node:test";
import {Miniflare} from "miniflare";
import acmeCrypto from "acme-client/src/crypto/index.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const report = JSON.parse(readFileSync(join(root, "_artifacts/lego-dns/build-report.json"), "utf8"));
const valueFor = (value) => createHash("sha256").update(value).digest("base64url");

function fixture(provider, {failCA = false, failDeleteOnce = false, badDns = false, cname = false, foreignCname = false} = {}) {
    const records = new Map([["foreign", "unrelated-foreign-value"]]);
    const events = [];
    let sequence = 100;
    let validations = 0;
    let finalized = false;
    let deleteFailed = false;
    let accountPublicKey;
    let expectedValues = [];
    const json = (value, status = 200, headers = {}) => Response.json(value, {status, headers});
    const outbound = async (request) => {
        const url = new URL(request.url);
        if (["cloudflare-dns.com", "dns.google"].includes(url.hostname)) {
            if (badDns) return new Response("x".repeat(70000));
            const name = url.searchParams.get("name");
            const type = url.searchParams.get("type");
            events.push(`dns:${type}:${name}`);
            if (["6", "SOA"].includes(type)) return json({Status: 0, Answer: name === "example.com." ? [{name, type: 6, TTL: 60, data: "ns.example.com. hostmaster.example.com. 1 1 1 1 60"}] : []});
            if (["5", "CNAME"].includes(type)) return json({Status: 0, Answer: (cname || foreignCname) && name === "_acme-challenge.alias.example.com."
                ? [{name, type: 5, TTL: 60, data: foreignCname ? "_acme-challenge.outside.invalid." : "_acme-challenge.example.com."}] : []});
            return json({Status: 0, Answer: [...records.values()].map((data) => ({name, type: 16, TTL: 60, data: JSON.stringify(data)}))});
        }
        if (url.hostname === "desec.io") {
            assert.equal(request.headers.get("authorization"), "Token synthetic-tenant-token");
            if (url.pathname.endsWith("/domains/")) return json([{name: "example.com", minimum_ttl: 60}]);
            const rrset = () => ({domain: "example.com", subname: "_acme-challenge", type: "TXT", ttl: 3600, records: [...records.values()].map((value) => JSON.stringify(value))});
            if (request.method === "GET") return json(rrset());
            if (request.method === "PATCH") {
                const body = await request.json();
                const next = body.records.map((value) => JSON.parse(value));
                assert.ok(next.includes("unrelated-foreign-value"), "RRset updates must preserve external TXT records");
                if (next.length < records.size && failDeleteOnce && !deleteFailed) { deleteFailed = true; events.push("cleanup:retry"); return json({detail: "synthetic failure"}, 500); }
                for (const [id, value] of records) if (!next.includes(value)) { records.delete(id); events.push(`cleanup:${id}`); }
                for (const value of next) if (![...records.values()].includes(value)) { const id = String(++sequence); records.set(id, value); events.push(`present:${id}`); }
                return json(rrset());
            }
        }
        if (url.hostname === "api.porkbun.com") {
            const body = await request.json();
            assert.equal(body.apikey, "synthetic-tenant-token");
            assert.equal(body.secretapikey, "synthetic-tenant-token");
            if (url.pathname.includes("/dns/create/")) {
                const id = String(++sequence);
                records.set(id, body.content); events.push(`present:${id}`);
                return json({status: "SUCCESS", id: Number(id)});
            }
            if (url.pathname.includes("/dns/delete/")) {
                if (failDeleteOnce && !deleteFailed) { deleteFailed = true; events.push("cleanup:retry"); return json({status: "ERROR", message: "synthetic failure"}, 500); }
                const id = url.pathname.split("/").at(-1);
                assert.ok(records.has(id)); assert.notEqual(id, "foreign");
                records.delete(id); events.push(`cleanup:${id}`);
                return json({status: "SUCCESS"});
            }
        }
        if (["api.cloudflare.com", "api.digitalocean.com", "api.vercel.com"].includes(url.hostname)) {
            assert.equal(request.headers.get("authorization"), "Bearer synthetic-tenant-token");
            if (url.pathname.endsWith("/zones")) return json({success: true, result: [{id: "zone-fixture", name: "example.com"}], result_info: {page: 1, total_pages: 1}});
            if (request.method === "POST") {
                const body = await request.json();
                const value = provider === "cloudflare" ? JSON.parse(body.content) : provider === "vercel" ? body.value : body.data;
                const id = String(++sequence);
                records.set(id, value);
                events.push(`present:${id}`);
                return provider === "cloudflare" ? json({success: true, result: {id}}) : provider === "vercel" ? json({uid: id}) : json({domain_record: {id: Number(id)}});
            }
            if (request.method === "DELETE") {
                const id = url.pathname.split("/").at(-1);
                if (failDeleteOnce && !deleteFailed) { deleteFailed = true; events.push("cleanup:retry"); return json({error: "synthetic failure"}, 500); }
                assert.ok(records.has(id), "cleanup must use the exact Present record ID");
                assert.notEqual(id, "foreign");
                records.delete(id);
                events.push(`cleanup:${id}`);
                return provider === "cloudflare" ? json({success: true, result: {id}}) : new Response(null, {status: 204});
            }
        }
        if (url.hostname === "ca.fixture") {
            if (request.method === "POST") {
                const envelope = await request.clone().json();
                const protectedHeader = JSON.parse(Buffer.from(envelope.protected, "base64url").toString());
                assert.equal(protectedHeader.alg, "ES256");
                assert.equal(protectedHeader.kid, "https://ca.fixture/account");
                assert.equal(verify("sha256", Buffer.from(`${envelope.protected}.${envelope.payload}`), {key: accountPublicKey, dsaEncoding: "ieee-p1363"}, Buffer.from(envelope.signature, "base64url")), true);
            }
            const headers = {"replay-nonce": `fixture-nonce-${++sequence}`, "content-type": "application/json"};
            const order = {url: "https://ca.fixture/order", status: finalized ? "valid" : validations >= 2 ? "ready" : "pending", finalize: "https://ca.fixture/finalize", certificate: "https://ca.fixture/certificate", identifiers: [{type: "dns", value: "example.com"}], authorizations: ["https://ca.fixture/authz/1", "https://ca.fixture/authz/2"]};
            if (url.pathname === "/directory") return json({newNonce: "https://ca.fixture/nonce", newAccount: "https://ca.fixture/account", newOrder: "https://ca.fixture/order"}, 200, headers);
            if (url.pathname === "/nonce") return new Response(null, {status: 200, headers});
            if (url.pathname.startsWith("/challenge/")) { validations++; events.push("ca:validate"); return json({status: "pending"}, 200, headers); }
            if (url.pathname.startsWith("/authz/")) return json({status: failCA ? "invalid" : "valid", identifier: {type: "dns", value: "example.com"}}, 200, headers);
            if (url.pathname === "/order") return json(order, 200, headers);
            if (url.pathname === "/finalize") {
                const envelope = await request.json();
                const payload = JSON.parse(Buffer.from(envelope.payload, "base64url").toString());
                assert.ok(Buffer.from(payload.csr, "base64url").length > 100);
                assert.equal(records.size, 3, "both TXT values must remain until issuance completes");
                for (const value of expectedValues) assert.ok([...records.values()].includes(value), "CA must see the key-authorization hash for this account");
                finalized = true;
                events.push("ca:finalize");
                return json({...order, status: "valid"}, 200, headers);
            }
            if (url.pathname === "/certificate") { events.push("ca:certificate"); return new Response("-----BEGIN CERTIFICATE-----\nSYNTHETIC-OFFLINE-FIXTURE\n-----END CERTIFICATE-----", {headers}); }
        }
        throw new Error(`Unexpected synthetic request: ${request.method} ${url.hostname}${url.pathname}`);
    };
    return {outbound, records, events, expect(input) {
        accountPublicKey = createPublicKey(input.account.accountKey);
        expectedValues = input.groups.flatMap((group) => group.challenges.map((challenge) => valueFor(challenge.keyAuthorization)));
    }};
}

async function payload(provider, operation = "issue") {
    const accountKey = await acmeCrypto.createPrivateEcdsaKey("P-256");
    const [, csr] = await acmeCrypto.createCsr({commonName: "example.com", altNames: ["example.com", "*.example.com"]});
    const jwk = createPublicKey(accountKey).export({format: "jwk"});
    const thumbprint = valueFor(JSON.stringify({crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y}));
    const challenges = [1, 2].map((id) => ({domain: "example.com", token: `synthetic-token-${id}`, keyAuthorization: `synthetic-token-${id}.${thumbprint}`}));
    const credentialNames = {cloudflare: ["CLOUDFLARE_DNS_API_TOKEN"], digitalocean: ["DO_AUTH_TOKEN"], desec: ["DESEC_TOKEN"], porkbun: ["PORKBUN_API_KEY", "PORKBUN_SECRET_API_KEY"], vercel: ["VERCEL_API_TOKEN"]};
    return {operation, groups: [{provider, zones: ["example.com"], env: Object.fromEntries(credentialNames[provider].map((name) => [name, "synthetic-tenant-token"])), challenges}],
        csr: csr.toString(), account: {directoryUrl: "https://ca.fixture/directory", accountUrl: "https://ca.fixture/account", accountKey: accountKey.toString()},
        order: {url: "https://ca.fixture/order", finalize: "https://ca.fixture/finalize", status: "pending"},
        authorizations: [1, 2].map((id) => ({url: `https://ca.fixture/authz/${id}`, status: "pending", identifier: {type: "dns", value: "example.com"}, challenges: [{type: "dns-01", token: `synthetic-token-${id}`, url: `https://ca.fixture/challenge/${id}`}]}))};
}

test("actual workerd runs pinned lego providers through Present, DoH, ACME and same-instance cleanup", async (suite) => {
    const evidence = [];
    for (const provider of ["cloudflare", "digitalocean", "desec", "porkbun", "vercel"]) {
        const manifest = report.shards.find((shard) => shard.buildHash && shard.providers.includes(provider));
        assert.ok(manifest, `${provider} needs a successful actual build`);
        const bundle = join(root, "_artifacts/lego-dns", manifest.id, "bundle/entry.js");
        const gate = {provider, buildHash: manifest.buildHash, sourceHash: manifest.sourceHash, runtime: "workerd", cases: 0, maxMemoryBytes: 0, maxSubrequests: 0};
        const scenarios = [{}, {failCA: true}, {failDeleteOnce: true}, {badDns: true}, {cname: true}, {foreignCname: true}];
        for (const scenario of scenarios) {
            await suite.test(`${provider} ${JSON.stringify(scenario)}`, async () => {
                const state = fixture(provider, scenario);
                const runtime = new Miniflare({workers: [
                    {name: "main-router", modules: true, script: 'export default {fetch(request, env) {return env.DNS.fetch(request)}}', serviceBindings: {DNS: "provider-shard"}},
                    {name: "provider-shard", modules: true, modulesRoot: resolve(bundle, ".."), scriptPath: bundle, modulesRules: [{type: "CompiledWasm", include: ["**/*.wasm"], fallthrough: true}], compatibilityDate: "2026-01-01", compatibilityFlags: ["nodejs_compat"], outboundService: state.outbound},
                ]});
                try {
                    const input = await payload(provider);
                    if (scenario.cname || scenario.foreignCname) {
                        input.operation = "test";
                        for (const challenge of input.groups[0].challenges) challenge.domain = "alias.example.com";
                    }
                    state.expect(input);
                    const response = await runtime.dispatchFetch("http://shard/issue", {method: "POST", body: JSON.stringify(input)});
                    const body = await response.json();
                    assert.equal(body.ok, !scenario.failCA && !scenario.badDns && !scenario.foreignCname, JSON.stringify(body));
                    assert.equal(body.cleanupOk, true, JSON.stringify(body));
                    assert.equal(body.runtimeVersion, "v5.5.2");
                    assert.ok(body.runtimeMetrics.memoryBytes > 0 && body.runtimeMetrics.memoryBytes < 128 * 1024 * 1024);
                    assert.ok(body.runtimeMetrics.subrequests <= 50);
                    assert.deepEqual([...state.records], [["foreign", "unrelated-foreign-value"]]);
                    assert.equal(JSON.stringify(body).includes("synthetic-tenant-token"), false);
                    if (body.ok && input.operation === "issue") {
                        assert.match(body.certificate, /BEGIN CERTIFICATE/);
                        assert.ok(state.events.indexOf("ca:certificate") < state.events.findIndex((event) => event.startsWith("cleanup:")));
                        assert.equal(state.events.filter((event) => event.startsWith("present:")).length, 2);
                    }
                    if (scenario.failDeleteOnce) assert.ok(state.events.includes("cleanup:retry"));
                    if (scenario.cname || scenario.foreignCname) assert.equal(state.events.filter((event) => event === "dns:5:_acme-challenge.alias.example.com.").length, 1, "CNAME result must stay frozen throughout the lifecycle");
                    if (scenario.foreignCname) assert.equal(state.events.some((event) => event.startsWith("present:")), false);
                    gate.cases++;
                    gate.maxMemoryBytes = Math.max(gate.maxMemoryBytes, body.runtimeMetrics.memoryBytes);
                    gate.maxSubrequests = Math.max(gate.maxSubrequests, body.runtimeMetrics.subrequests);
                } finally { await runtime.dispose(); }
            });
        }
        if (gate.cases === scenarios.length) evidence.push(gate);
    }
    writeFileSync(join(root, "_artifacts/lego-dns/runtime-evidence.json"), JSON.stringify(evidence, null, 2));
});

test("workerd isolates tenant environments between requests and rejects concurrent Go execution", async () => {
    const provider = "digitalocean";
    const manifest = report.shards.find((shard) => shard.buildHash && shard.providers.includes(provider));
    const bundle = join(root, "_artifacts/lego-dns", manifest.id, "bundle/entry.js");
    const state = fixture(provider);
    const runtime = new Miniflare({modules: true, modulesRoot: resolve(bundle, ".."), scriptPath: bundle,
        modulesRules: [{type: "CompiledWasm", include: ["**/*.wasm"], fallthrough: true}], compatibilityDate: "2026-01-01", compatibilityFlags: ["nodejs_compat"], outboundService: state.outbound});
    const send = (input) => runtime.dispatchFetch("http://shard/test", {method: "POST", body: JSON.stringify(input)});
    try {
        const input = await payload(provider, "test");
        assert.equal((await (await send(input)).json()).ok, true);
        const before = state.events.filter((event) => event.startsWith("present:")).length;
        const missing = structuredClone(input);
        missing.groups[0].env = {};
        const missingResult = await (await send(missing)).json();
        assert.equal(missingResult.ok, false);
        assert.equal(missingResult.stage, "credentials");
        assert.equal(state.events.filter((event) => event.startsWith("present:")).length, before);
        const concurrent = await Promise.all([send(input), send(input)]);
        assert.deepEqual(concurrent.map((response) => response.status).sort(), [200, 429]);
        assert.deepEqual([...state.records], [["foreign", "unrelated-foreign-value"]]);
    } finally { await runtime.dispose(); }
});