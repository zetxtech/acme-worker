import {strict as assert} from "node:assert";
import {test} from "node:test";
import {DatabaseSync} from "node:sqlite";
import {mkdirSync, readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {Hono} from "hono";
import {setSignedCookie} from "hono/cookie";
import {Server, utils as sshUtils} from "ssh2";
import {createHash} from "node:crypto";
import forge from "node-forge";
import {parse as parseYaml} from "yaml";
import {assertCaAvailable, assertDcvAvailable, caCapabilities, dcvCapability, normalizeDomains, requestedNames} from "../src/capabilities";
import {canUse, inScope, maskedResource, seal, unseal, validateSelections, saveResource, type Resource} from "../src/resources";
import {delegationTarget, DnsProvider, txtPropagated} from "../src/dns";
import {dnsAuthy} from "../src/certs";
import {registeredClient, resolveAccountKey} from "../src/routes/admin_certs_helper";
import {sha256Hex} from "../src/edge/tencent";
import {boundedResponse, publicHost, publicHttps} from "../src/deploy/network";
import {deployHook} from "../src/deploy/hook";
import {hostFingerprintMatches, mergeTraefikAcme, remotePath, replaceRemoteFiles, validateSshConfig} from "../src/deploy/ssh";
import {certificateCoversHost, pushSelectedOrder, syncSelectedOrders} from "../src/deployment";
import {validateResourceConfig} from "../src/deploy/config";
import {D1Dao} from "../src/db/dao.d1";
import {_resetDaoForTests} from "../src/db";
import {invalidateAll} from "../src/db/conf";
import {retryDnsCleanup} from "../src/query";
import {dnsCatalog, dnsShard, validateDnsSettings, verifiedDnsAccount} from "../src/lego/registry";
import {issueLegoOrder, testLegoAccount} from "../src/lego/dispatch";
import shardBuilds from "../src/lego-shards.generated.json";
import {resourceSelectable} from "../frontend/src/api/resources";

test("unconfigured CAs are not selectable", async () => {
    const capabilities = await caCapabilities(async () => null);
    assert.deepEqual(capabilities.filter((item) => item.available).map((item) => item.id), ["lets-encrypt"]);
    assert.throws(() => assertCaAvailable(capabilities, "google-trust", ["example.com"]));
});

test("enabled CA needs EAB only until its ACME account is registered", async () => {
    const bare = await caCapabilities(async (name) => name === "GTS_useIt" ? "true" : null);
    const google = bare.find((item) => item.id === "google-trust")!;
    assert.equal(google.reason, "missing_credentials");
    assert.deepEqual(google.missing, ["GTS_keyID", "GTS_keyMC"]);
    assert.equal(google.available, false);
    assert.equal(google.registered, false);
    const withEab = await caCapabilities(async (name) => name === "GTS_useIt" ? "true"
        : ["GTS_keyID", "GTS_keyMC"].includes(name) ? "fixture" : null);
    const pending = withEab.find((item) => item.id === "google-trust")!;
    assert.equal(pending.available, true);
    assert.equal(pending.eabConfigured, true);
    assert.equal(pending.needsRegistration, true);
});

test("a registered ACME account keeps its CA usable after the one-time EAB is gone", async () => {
    const accountKey = "fixture-account-key";
    const identity = `ACME_ACCOUNT:${await sha256Hex("https://dv.acme-v02.api.pki.goog/directory\n" + accountKey)}`;
    const settings: Record<string, string> = {GTS_useIt: "true", GTS_KeyTS: accountKey, [identity]: "https://ca.example/acct/one"};
    const capabilities = await caCapabilities(async (name) => settings[name] ?? null);
    const google = capabilities.find((item) => item.id === "google-trust")!;
    assert.equal(google.registered, true);
    assert.equal(google.eabConfigured, false);
    assert.equal(google.available, true);
    assert.deepEqual(google.missing, []);
    assert.doesNotThrow(() => assertCaAvailable(capabilities, "google-trust", ["example.com"]));
    // A system-generated account key counts as registered too, so no EAB is demanded.
    const stored: Record<string, string> = {GTS_useIt: "true", "ACME_KEY:google-trust": accountKey, [identity]: "https://ca.example/acct/one"};
    const auto = (await caCapabilities(async (name) => stored[name] ?? null)).find((item) => item.id === "google-trust")!;
    assert.equal(auto.available, true);
    assert.equal(auto.registered, true);
});

test("the CA account key is generated once, persisted and never silently replaced", async () => {
    _resetDaoForTests(); invalidateAll();
    const database = memoryD1();
    const env: any = {DB_CF: database, DB_SOURCE: "d1"};
    try {
        const generated = await resolveAccountKey(env, "google-trust", "");
        assert.match(generated, /BEGIN [A-Z ]*PRIVATE KEY/);
        assert.equal(await resolveAccountKey(env, "google-trust", ""), generated);
        assert.equal(await resolveAccountKey(env, "zeroca-trust", ""), (await resolveAccountKey(env, "zeroca-trust", "")));
        assert.equal(await resolveAccountKey(env, "google-trust", "  fixture-configured  "), "fixture-configured");
        assert.equal(await resolveAccountKey(env, "lets-encrypt", ""), "");
    } finally { _resetDaoForTests(); invalidateAll(); database.close(); }
});

test("configured CA is available and SSL free DV restrictions are enforced", async () => {
    const capabilities = await caCapabilities(async () => "true");
    assert.equal(capabilities.every((item) => item.available), true);
    assert.doesNotThrow(() => assertCaAvailable(capabilities, "google-trust", ["*.example.com"]));
    assert.throws(() => assertCaAvailable(capabilities, "sslcom-trust", ["*.example.com"]));
    assert.throws(() => assertCaAvailable(capabilities, "sslcom-trust", ["example.com", "www.example.com"]));
});

test("CA enforcement expands wildcard and apex options before applying product limits", async () => {
    const capabilities = await caCapabilities(async () => "true");
    const names = requestedNames([{name: "example.com", wild: true, root: true}]);
    assert.deepEqual(names, ["*.example.com", "example.com"]);
    assert.throws(() => assertCaAvailable(capabilities, "sslcom-trust", names));
    assert.throws(() => requestedNames([{name: "https://example.com"}]));
    assert.throws(() => requestedNames([]));
});

test("credentials require a configured key and authenticated resource identity", async () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    await assert.rejects(seal(undefined, "DNS_ACCOUNT:one", {token: "test-secret"}));
    const encrypted = await seal(key, "DNS_ACCOUNT:one", {token: "test-secret"});
    assert.equal(encrypted.includes("test-secret"), false);
    assert.deepEqual(await unseal(key, "DNS_ACCOUNT:one", encrypted), {token: "test-secret"});
    await assert.rejects(unseal(key, "DNS_ACCOUNT:two", encrypted));
    const tampered = JSON.parse(encrypted);
    const changed = Buffer.from(tampered.ciphertext, "base64");
    changed[0] ^= 1;
    tampered.ciphertext = changed.toString("base64");
    await assert.rejects(unseal(key, "DNS_ACCOUNT:one", JSON.stringify(tampered)));
});

test("resource grants and domain scope do not imply administrator-wide usage", () => {
    const resource = {owner: "owner@example.com", grants: ["granted@example.com"], enabled: true,
        zones: ["example.co.uk"], encrypted: "encrypted-value"} as Resource;
    assert.equal(canUse(resource, "owner@example.com", ["*.example.co.uk"]), true);
    assert.equal(canUse(resource, "granted@example.com", ["www.example.co.uk"]), true);
    assert.equal(canUse(resource, "admin@example.com", ["example.co.uk"]), false);
    assert.equal(canUse(resource, "owner@example.com", ["example.co.uk.attacker.com"]), false);
    assert.equal(inScope("notexample.co.uk", resource.zones), false);
    assert.equal("encrypted" in maskedResource(resource), false);
});

test("private DNS account scope is explicit, owner-only and never applies to targets", async () => {
    const storage = new Map<string, string>();
    const dao = {getConf: async (name: string) => storage.get(name) ?? null,
        upsertConf: async (name: string, value: string) => { storage.set(name, value); }} as any;
    const secret = Buffer.alloc(32, 17).toString("base64");
    const actor = {mail: "owner@example.com", is_admin: 1};
    const body = {name: "Personal DNS", provider: "cloudflare", zones: [], scopeMode: "account", secrets: {token: "synthetic-token"}};
    const resource = await saveResource(dao, secret, "DNS_ACCOUNT", actor, body, "personal");
    assert.equal((maskedResource(resource) as any).scopeMode, "account");
    assert.equal(inScope("example.com", []), false);
    assert.equal(canUse(resource, actor.mail, ["*.example.com", "other.org"]), true);
    const selectable = {...maskedResource(resource), available: true};
    assert.equal(resourceSelectable(selectable, actor.mail, ["other.org"]), true);
    assert.equal(resourceSelectable({...selectable, grants: ["guest@example.com"]}, "guest@example.com"), false);
    assert.equal(resourceSelectable({...selectable, kind: "DEPLOY_TARGET"}, actor.mail, ["example.com"]), false);
    assert.equal(resourceSelectable({...selectable, available: false}, actor.mail, ["example.com"]), false);
    assert.equal(canUse({...resource, grants: ["guest@example.com"]}, "guest@example.com", ["example.com"]), false);
    assert.equal(canUse({...resource, grants: ["guest@example.com"]}, "guest@example.com"), false);
    assert.equal(canUse({...resource, kind: "DEPLOY_TARGET"}, actor.mail, ["example.com"]), false);
    await validateSelections(dao, actor.mail, [{name: "example.com", type: "dns-api", dnsAccountId: resource.id}]);
    await assert.rejects(validateSelections(dao, "guest@example.com", [{name: "example.com", type: "dns-api", dnsAccountId: resource.id}]));
    await assert.rejects(saveResource(dao, secret, "DNS_ACCOUNT", actor, {...body, scopeMode: undefined}, "unmarked"));
    await assert.rejects(saveResource(dao, secret, "DNS_ACCOUNT", actor, {...body, grants: ["guest@example.com"]}, "shared"));
    await assert.rejects(saveResource(dao, secret, "DNS_ACCOUNT", actor, {...body, zones: ["example.com"], grants: ["guest@example.com"]}, "forged"));
    await assert.rejects(saveResource(dao, secret, "DEPLOY_TARGET", actor, {...body, provider: "https"}, "target"));
    const limited = await saveResource(dao, secret, "DNS_ACCOUNT", actor, {...body, scopeMode: "zones", zones: ["example.com"], grants: ["guest@example.com"]}, "limited");
    assert.equal(canUse(limited, "guest@example.com", ["www.example.com"]), true);
    assert.equal(canUse(limited, actor.mail, ["outside.org"]), false);
    const edited = await saveResource(dao, secret, "DNS_ACCOUNT", actor, {name: "Renamed", secrets: {token: ""}}, resource.id);
    assert.deepEqual(await unseal(secret, `DNS_ACCOUNT:${resource.id}`, edited.encrypted), {token: "synthetic-token"});
});

test("Cloudflare token provider preserves apex/wildcard TXT values and cleans exact handles", async () => {
    const original = globalThis.fetch;
    const records: any[] = [{id: "foreign", name: "_acme-challenge.example.co.uk", type: "TXT", content: "foreign-value"}];
    const calls: string[] = [];
    let nextRecord = 0;
    globalThis.fetch = (async (input: any, options: any = {}) => {
        const url = new URL(String(input));
        assert.equal(options.headers.Authorization, "Bearer fixture-token");
        calls.push(`${options.method} ${url.pathname}`);
        let result: any;
        if (url.pathname.endsWith("/zones")) result = url.searchParams.get("name") === "example.co.uk" ? [{id: "zone", name: "example.co.uk"}] : [];
        else if (options.method === "POST") {
            result = {...JSON.parse(options.body), id: String(++nextRecord), type: "TXT"};
            records.push(result);
        } else if (options.method === "DELETE") {
            const index = records.findIndex((record) => url.pathname.endsWith(`/${record.id}`));
            result = records.splice(index, 1)[0];
        } else if (url.pathname.endsWith("/dns_records")) result = records;
        else result = records.find((record) => url.pathname.endsWith(`/${record.id}`));
        return Response.json({success: true, result});
    }) as any;
    try {
        const provider = new DnsProvider({provider: "cloudflare", zones: ["example.co.uk"]} as Resource, {token: "fixture-token"});
        const first = await provider.present("_acme-challenge.example.co.uk", "a".repeat(43), "order:first");
        const second = await provider.present("_acme-challenge.example.co.uk", "b".repeat(43), "order:second");
        assert.equal(records.length, 3);
        await provider.cleanup(first);
        assert.deepEqual(records.map((record) => record.id), ["foreign", second.id]);
        assert.equal(calls.some((call) => call === "DELETE /client/v4/zones/zone/dns_records/foreign"), false);
        records[1].content = "changed";
        await assert.rejects(provider.cleanup(second));
        const automatic = new DnsProvider({kind: "DNS_ACCOUNT", provider: "cloudflare", scopeMode: "account", zones: [], grants: []} as Resource, {token: "fixture-token"});
        const automaticHandle = await automatic.present("_acme-challenge.example.co.uk", "c".repeat(43), "order:automatic");
        assert.deepEqual(automaticHandle.zone, {id: "zone", name: "example.co.uk"});
        await automatic.cleanup(automaticHandle);
        assert.equal(records.some((record) => record.content === "c".repeat(43)), false);
        const forged = new DnsProvider({kind: "DNS_ACCOUNT", provider: "cloudflare", scopeMode: "account", zones: [], grants: ["guest@example.com"]} as Resource, {token: "fixture-token"});
        await assert.rejects(forged.zone("example.co.uk"), /scope/);
        await assert.rejects(provider.zone("other.org"), /scope/);
    } finally { globalThis.fetch = original; }
});

test("propagation requires exact TXT values from both resolvers", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => Response.json({Answer: [{type: 16, data: '"first" "second"'}]})) as any;
    try {
        assert.equal(await txtPropagated("_acme-challenge.example.com", "firstsecond"), true);
        assert.equal(await txtPropagated("_acme-challenge.example.com", "other"), false);
    } finally { globalThis.fetch = original; }
});

test('public DNS lookup failures are distinguishable from pending propagation', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response('temporarily unavailable', {status: 503})) as any;
    try { await assert.rejects(txtPropagated('example.com', 'synthetic-value'), /Public DNS query failed/); }
    finally { globalThis.fetch = original; }
});

test("manual, delegated and API DNS selections enforce immediate resource scope", async () => {
    const account = {owner: "user@example.com", grants: [], enabled: true, zones: ["example.com"]};
    const dao = {getConf: async () => JSON.stringify(account)} as any;
    assert.deepEqual(await validateSelections(dao, "user@example.com", [{name: "example.com", type: "dns-self"}]), []);
    await validateSelections(dao, "user@example.com", [{name: "example.com", type: "dns-auto"}]);
    await validateSelections(dao, "user@example.com", [{name: "example.com", type: "dns-api", dnsAccountId: "one"}]);
    await assert.rejects(validateSelections(dao, "other@example.com", [{name: "example.com", type: "dns-api", dnsAccountId: "one"}]));
    await assert.rejects(validateSelections(dao, "user@example.com", [{name: "outside.com", type: "dns-api", dnsAccountId: "one"}]));
    await assert.rejects(validateSelections(dao, "other@example.com", [{name: "example.com"}], ["one"]));
});

test("registered CA accounts reuse the same private key and account URL", async () => {
    const storage = new Map<string, string>();
    const dao = {getConf: async (name: string) => storage.get(name) ?? null,
        upsertConf: async (name: string, value: string) => { storage.set(name, value); }};
    let registrations = 0;
    const create = (options: any) => ({options, createAccount: async () => { registrations++; },
        getAccountUrl: () => "https://ca.example/acct/one"});
    const options = {directoryUrl: "https://ca.example/directory", accountKey: "fixture-existing-key",
        externalAccountBinding: {kid: "once", hmacKey: "fixture"}};
    await registeredClient(dao, options, "first@example.com", create);
    const second = await registeredClient(dao, options, "second@example.com", create);
    assert.equal(registrations, 1);
    assert.equal(second.options.accountKey, "fixture-existing-key");
    assert.equal(second.options.accountUrl, "https://ca.example/acct/one");
    // The one-time EAB must not be resent for an account that already exists.
    assert.equal(second.options.externalAccountBinding, undefined);
    await assert.rejects(registeredClient(dao, {...options, accountKey: "fixture-fresh-key"}, "third@example.com",
        (clientOptions: any) => ({...create(clientOptions), createAccount: async () => { throw new Error("spent eab secret"); }})),
    /initial EAB credentials/);
    await assert.rejects(registeredClient(dao, {...options, accountKey: 'fixture-other-key', externalAccountBinding: undefined}, 'first@example.com',
        (clientOptions: any) => ({...create(clientOptions), createAccount: async () => { throw new Error('connection timed out'); }})),
    (error: Error) => error.message === 'connection timed out');
});

test("deployment destinations reject private addresses and URL credential tricks", async () => {
    for (const host of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "::1", "::ffff:127.0.0.1", "metadata.google.internal", "server.local"]) {
        assert.throws(() => publicHost(host));
    }
    for (const url of ["http://example.com", "https://user:pass@example.com", "https://example.com/?token=secret", "https://0x7f000001/"]) {
        assert.throws(() => publicHttps(url));
    }
    assert.equal(publicHttps("https://deploy.example.com/cert").hostname, "deploy.example.com");
    await assert.rejects(boundedResponse(new Response("x".repeat(100)), 10));
});

test('concurrent background requests register a shared CA account only once', async () => {
    const database = memoryD1();
    const dao = new D1Dao(database as any);
    let registrations = 0;
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const options = {directoryUrl: 'https://ca.example/directory', accountKey: 'synthetic-shared-key', externalAccountBinding: {kid: 'once', hmacKey: 'synthetic'}};
    const create = (settings: any) => ({settings, createAccount: async () => { registrations++; entered(); await gate; },
        getAccountUrl: () => 'https://ca.example/acct/shared'});
    try {
        const first = registeredClient(dao, options, 'first@example.com', create);
        await started;
        await assert.rejects(registeredClient(dao, options, 'second@example.com', create), /initialization is busy/);
        release();
        await first;
        const reused = await registeredClient(dao, options, 'second@example.com', create);
        assert.equal(registrations, 1);
        assert.equal(reused.settings.accountUrl, 'https://ca.example/acct/shared');
        assert.equal(reused.settings.externalAccountBinding, undefined);
    } finally { release?.(); database.close(); }
});

test("HTTPS hooks carry authentication, signed timestamp and stable version without redirects", async () => {
    const original = globalThis.fetch;
    let captured: any;
    globalThis.fetch = (async (input: any, options: any) => {
        if (String(input).includes("cloudflare-dns.com")) return Response.json({Answer: [{type: 1, data: "8.8.8.8"}]});
        captured = options;
        return new Response("ok");
    }) as any;
    try {
        await deployHook({url: "https://deploy.example.com/cert"}, {authToken: "fixture", hmacSecret: "fixture-hmac"},
            {orderId: "order", version: "v1", domains: ["example.com"], certificate: "fixture-cert", privateKey: "fixture-key"});
        assert.equal(captured.redirect, "error");
        assert.equal(captured.headers.Authorization, "Bearer fixture");
        assert.equal(captured.headers["Idempotency-Key"], "order:v1");
        assert.match(captured.headers["X-Certificate-Signature"], /^sha256=[a-f0-9]{64}$/);
    } finally { globalThis.fetch = original; }
});

test("SSH requires a pinned host key and refuses path traversal", () => {
    const hex = "11".repeat(32);
    const fingerprint = `SHA256:${Buffer.from(hex, "hex").toString("base64").replace(/=+$/, "")}`;
    assert.equal(hostFingerprintMatches(fingerprint, hex), true);
    assert.equal(hostFingerprintMatches(fingerprint, "22".repeat(32)), false);
    assert.throws(() => validateSshConfig({host: "ssh.example.com", username: "deploy"}));
    assert.throws(() => remotePath("/etc/../root/key"));
    assert.equal(remotePath("/etc/nginx/tls/fullchain.pem"), "/etc/nginx/tls/fullchain.pem");
});

test("Traefik resolver merge preserves accounts and unrelated certificates", () => {
    const store = {other: {Account: {key: "other-account"}, Certificates: []}, selected: {
        Account: {key: "preserve-account"}, Certificates: [{domain: {main: "unrelated.com"}, certificate: "old"}]}};
    const merged = JSON.parse(mergeTraefikAcme(JSON.stringify(store), "selected", ["example.com", "www.example.com"], "pem-cert", "pem-key"));
    assert.deepEqual(merged.other, store.other);
    assert.deepEqual(merged.selected.Account, store.selected.Account);
    assert.equal(merged.selected.Certificates.length, 2);
    assert.equal(merged.selected.Certificates[1].certificate, Buffer.from("pem-cert").toString("base64"));
    assert.throws(() => mergeTraefikAcme(JSON.stringify(store), "missing", ["example.com"], "cert", "key"));
    assert.throws(() => mergeTraefikAcme('{"Account":"remote-private-data"', "selected", ["example.com"], "cert", "key"),
        (error: Error) => !error.message.includes("remote-private-data") && error.message.includes("Invalid Traefik"));
});

test("SFTP activation failure restores original files rather than keeping a failed certificate", async () => {
    const files = new Map<string, string>([["/cert.pem", "old-cert"], ["/key.pem", "old-key"]]);
    const missing = () => Object.assign(new Error("missing"), {code: 2});
    const sftp = {
        writeFile: (path: string, data: Buffer, options: any, callback: any) => { files.set(path, data.toString()); callback(null); },
        chmod: (path: string, mode: number, callback: any) => callback(null),
        lstat: (path: string, callback: any) => callback(files.has(path) ? null : missing(), {}),
        rename: (source: string, target: string, callback: any) => { if (!files.has(source)) return callback(missing()); files.set(target, files.get(source)!); files.delete(source); callback(null); },
        unlink: (path: string, callback: any) => { files.delete(path); callback(null); },
    };
    await assert.rejects(replaceRemoteFiles(sftp, [{path: "/cert.pem", content: "new-cert", mode: 0o644},
        {path: "/key.pem", content: "new-key", mode: 0o600}], async () => { throw new Error("nginx test failed"); }), /previous files restored/);
    assert.equal(files.get("/cert.pem"), "old-cert");
    assert.equal(files.get("/key.pem"), "old-key");
});

test("resource configuration never permits plaintext credential fields or unsafe hook URLs", () => {
    assert.throws(() => validateResourceConfig("cloudflare", {token: "plaintext"}, {token: "encrypted"}));
    assert.throws(() => validateResourceConfig("https", {url: "https://127.0.0.1"}, {authToken: "secret"}));
    assert.throws(() => validateResourceConfig("nginx", {host: "server.example.com", username: "root", format: "pfx"}, {password: "secret"}));
});

test("certificate host coverage does not confuse wildcard coverage with broad resource scopes", () => {
    assert.equal(certificateCoversHost("*.example.com", "www.example.com"), true);
    assert.equal(certificateCoversHost("*.example.com", "example.com"), false);
    assert.equal(certificateCoversHost("*.example.com", "nested.www.example.com"), false);
    assert.equal(certificateCoversHost("example.com", "example.com"), true);
});

test("selected deployment retries failures without redoing successful unchanged targets", async () => {
    const key = Buffer.alloc(32, 8).toString("base64");
    const storage = new Map<string, string>();
    storage.set("ORDER_DEPLOYMENT:order", JSON.stringify(["one", "two"]));
    for (const id of ["one", "two"]) storage.set(`DEPLOY_TARGET:${id}`, JSON.stringify({
        id, kind: "DEPLOY_TARGET", name: id, provider: "https", owner: "user@example.com", grants: [], zones: ["example.com"],
        enabled: true, config: {}, updatedAt: 1, encrypted: await seal(key, `DEPLOY_TARGET:${id}`, {authToken: "secret"})}));
    const dao = {getConf: async (name: string) => storage.get(name) ?? null,
        upsertConf: async (name: string, value: string) => { storage.set(name, value); },
        claimConfLease: async () => true, releaseConfLease: async () => {}} as any;
    const calls: string[] = [];
    let failing = true;
    const executor = async (env: any, target: Resource) => { calls.push(target.id); if (target.id === "two" && failing) throw new Error("fixture failure"); };
    const order = {uuid: "order", flag: 5, mail: "user@example.com", list: JSON.stringify([{name: "example.com"}]), cert: "cert-v1", keys: "key"};
    await pushSelectedOrder({AUTOMATION_KEY: key} as any, order, {}, dao, executor);
    failing = false;
    const states = await pushSelectedOrder({AUTOMATION_KEY: key} as any, order, {manual: true}, dao, executor);
    assert.deepEqual(calls, ["one", "two", "two"]);
    assert.equal(states.every((state) => state.status === "ok"), true);
    await pushSelectedOrder({AUTOMATION_KEY: key} as any, {...order, cert: "cert-v2"}, {}, dao, executor);
    assert.deepEqual(calls, ["one", "two", "two", "one", "two"]);
    const changed = JSON.parse(storage.get("DEPLOY_TARGET:one")!);
    changed.updatedAt = 2;
    storage.set("DEPLOY_TARGET:one", JSON.stringify(changed));
    await pushSelectedOrder({AUTOMATION_KEY: key} as any, {...order, cert: "cert-v2"}, {}, dao, executor);
    assert.deepEqual(calls, ["one", "two", "two", "one", "two", "one"]);
    const countBeforeBudget = calls.length;
    await pushSelectedOrder({AUTOMATION_KEY: key} as any, {...order, cert: "cert-v3"}, {budget: {remaining: 1}}, dao, executor);
    assert.equal(calls.length - countBeforeBudget, 1);
    await pushSelectedOrder({AUTOMATION_KEY: key} as any, {...order, cert: "cert-v3"}, {budget: {remaining: 1}}, dao, executor);
    assert.equal(calls.length - countBeforeBudget, 2);
});

test("selected deployment scans beyond 100 orders while sharing a four-target retry budget", async () => {
    _resetDaoForTests();
    const database = memoryD1();
    const dao = new D1Dao(database as any);
    const key = Buffer.alloc(32, 10).toString("base64");
    const env: any = {DB_CF: database, AUTOMATION_KEY: key};
    const original = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (input: any, options: any = {}) => {
        if (String(input).includes("cloudflare-dns.com")) return Response.json({Answer: [{type: 1, data: "8.8.8.8"}]});
        assert.equal(String(input), "https://deploy.example.com/cert");
        calls.push(`${JSON.parse(options.body).orderId}:${options.headers.Authorization}`);
        return new Response("ok");
    }) as any;
    try {
        for (const id of ["one", "two"]) await dao.upsertConf(`DEPLOY_TARGET:${id}`, JSON.stringify({
            id, kind: "DEPLOY_TARGET", name: id, provider: "https", owner: "user@example.com", grants: [], zones: ["example.com"],
            enabled: true, config: {url: "https://deploy.example.com/cert"}, updatedAt: 1,
            encrypted: await seal(key, `DEPLOY_TARGET:${id}`, {authToken: id})}), 1);
        for (let index = 0; index < 105; index++) {
            const order = {uuid: `paged-${index}`, mail: "user@example.com", sign: null, type: null, auto: 1, flag: 5,
                time: 105 - index, next: 1, main: "{}", data: "{}", list: JSON.stringify([{name: "example.com"}]), cert: "cert-v1", keys: "key"};
            await dao.insertApply(order);
            await dao.upsertConf(`ORDER_DEPLOYMENT:${order.uuid}`, JSON.stringify(["one", "two"]), 1);
            if (index < 100) await pushSelectedOrder(env, order, {}, dao, async () => {});
        }
        const failedOrder = (await dao.getApply("paged-100"))!;
        await pushSelectedOrder(env, failedOrder, {}, dao, async () => { throw new Error("fixture failure"); });
        for (const id of ["one", "two"]) {
            const name = `DEPLOY_STATE:paged-100:${id}`;
            const state = JSON.parse((await dao.getConf(name))!);
            await dao.upsertConf(name, JSON.stringify({...state, nextAttempt: 0}), 1);
        }
        for (const expected of [4, 4, 2, 0]) {
            const before = calls.length;
            await syncSelectedOrders(env);
            assert.equal(calls.length - before, expected);
        }
        assert.equal(new Set(calls).size, 10);
        assert.equal(calls.every((call) => Number(call.match(/^paged-(\d+):/)![1]) >= 100), true);
        for (const id of ["one", "two"]) {
            assert.equal(JSON.parse((await dao.getConf(`DEPLOY_STATE:paged-104:${id}`))!).status, "ok");
            assert.equal(JSON.parse((await dao.getConf(`DEPLOY_STATE:paged-100:${id}`))!).attempts, 2);
        }
    } finally { globalThis.fetch = original; _resetDaoForTests(); database.close(); }
});

test("order input strips forged DNS handles while preserving HTTP-01 and expanding API wildcards", () => {
    const normalized = normalizeDomains([{name: "Example.com", wild: true, root: true, type: "dns-api", dnsAccountId: "saved",
        dnsHandle: {id: "forged"}, legacyRecordId: "forged", flag: 4, auth: "forged"}]);
    assert.deepEqual(normalized.map((item) => item.name), ["*.example.com", "example.com"]);
    assert.equal(normalized.some((item) => item.dnsHandle || item.legacyRecordId || item.auth), false);
    assert.equal(normalized.every((item) => item.flag === 0), true);
    assert.deepEqual(requestedNames([{name: "8.8.8.8", isIP: true, type: "web-self"}]), ["8.8.8.8"]);
    assert.throws(() => normalizeDomains([{name: "*.example.com", type: "web-self"}]));
});

test("DNSPod and Alibaba use signed real provider payloads, including empty DNSPod record lists", async () => {
    const original = globalThis.fetch;
    const calls: any[] = [];
    globalThis.fetch = (async (input: any, options: any) => {
        const url = new URL(String(input));
        calls.push({url, ...options});
        if (url.hostname === "dnspod.tencentcloudapi.com") {
            assert.match(options.headers.Authorization, /^TC3-HMAC-SHA256 Credential=fixture-id\//);
            assert.equal(options.headers["X-TC-Version"], "2021-03-23");
            const payload = JSON.parse(options.body);
            if (options.headers["X-TC-Action"] === "DescribeDomain") return Response.json({Response: {DomainInfo: {Domain: payload.Domain, DomainId: 7}}});
            if (options.headers["X-TC-Action"] === "DescribeRecordList") return Response.json({Response: {Error: {Code: "ResourceNotFound.NoDataOfRecord", Message: "empty"}}});
            assert.equal(payload.SubDomain, "_acme-challenge");
            assert.equal(payload.RecordType, "TXT");
            return Response.json({Response: {RecordId: 123}});
        }
        assert.equal(url.hostname, "alidns.cn-hangzhou.aliyuncs.com");
        assert.match(options.headers.Authorization, /^ACS3-HMAC-SHA256 Credential=fixture-id,/);
        assert.equal(options.headers["x-acs-version"], "2015-01-09");
        if (options.headers["x-acs-action"] === "DescribeDomainInfo") return Response.json({DomainName: "example.com", DomainId: "zone"});
        if (options.headers["x-acs-action"] === "DescribeSubDomainRecords") return Response.json({DomainRecords: {Record: []}, TotalCount: 0});
        assert.equal(url.searchParams.get("RR"), "_acme-challenge");
        assert.equal(url.searchParams.get("Type"), "TXT");
        return Response.json({RecordId: "456"});
    }) as any;
    try {
        const dnspod = new DnsProvider({provider: "dnspod", zones: ["example.com"]} as Resource, {secretId: "fixture-id", secretKey: "fixture-key"});
        assert.equal((await dnspod.present("_acme-challenge.example.com", "a".repeat(43), "order")).id, "123");
        const alidns = new DnsProvider({provider: "alidns", zones: ["example.com"]} as Resource, {accessKeyId: "fixture-id", accessKeySecret: "fixture-key"});
        assert.equal((await alidns.present("_acme-challenge.example.com", "b".repeat(43), "order")).id, "456");
        assert.equal(calls.every((call) => !("host" in call.headers) && !("Host" in call.headers)), true);
    } finally { globalThis.fetch = original; }
});

function memoryD1() {
    const database = new DatabaseSync(":memory:");
    database.exec(readFileSync(new URL("../schema.set.sql", import.meta.url), "utf8"));
    const prepare = (sql: string, values: any[] = []): any => ({
        bind: (...bound: any[]) => prepare(sql, bound),
        first: async (column?: string) => { const row: any = database.prepare(sql).get(...values); return column ? row?.[column] ?? null : row ?? null; },
        all: async () => ({results: database.prepare(sql).all(...values), success: true}),
        run: async () => ({meta: {changes: Number(database.prepare(sql).run(...values).changes)}, success: true}),
    });
    return {prepare, close: () => database.close()};
}

test("D1 deployment leases atomically exclude concurrent execution and stale release", async () => {
    const database = memoryD1();
    const dao = new D1Dao(database as any);
    try {
        assert.equal(await dao.claimConfLease("lease", "first", 200, 100), true);
        assert.equal(await dao.claimConfLease("lease", "second", 250, 150), false);
        assert.equal(await dao.claimConfLease("lease", "second", 350, 210), true);
        await dao.releaseConfLease("lease", "first");
        assert.equal(await dao.getConf("lease"), "second");
        await dao.releaseConfLease("lease", "second");
        assert.equal(await dao.getConf("lease"), null);
    } finally { database.close(); }
});

test("real web/API routes reject unavailable CA and ungranted resources before saving orders", async () => {
    _resetDaoForTests(); invalidateAll();
    const database = memoryD1();
    const dao = new D1Dao(database as any);
    const env: any = {DB_CF: database, DB_SOURCE: "d1", AUTOMATION_KEY: Buffer.alloc(32, 9).toString("base64")};
    const {app} = await import("../src/index");
    await dao.insertUser({mail: "route@example.com", pass: "fixture-session-key", apis: "fixture-api", flag: "1", is_admin: 0, quota: -1});
    await dao.insertUser({mail: "other@example.com", pass: "other-fixture", apis: "other-api", flag: "1", is_admin: 0, quota: -1});
    const signer = new Hono();
    signer.get("/", async (context) => { await setSignedCookie(context, "auth", "fixture-session", "fixture-session-key"); return context.text("ok"); });
    const cookie = (await signer.request("http://localhost/")).headers.get("set-cookie")!.split(";")[0];
    const webHeaders = {"Content-Type": "application/json", Cookie: `mail=route%40example.com; ${cookie}`};
    const apiHeaders = {"Content-Type": "application/json", "X-API-Mail": "route@example.com", "X-API-Token": "fixture-api"};
    const payload = {domains: [{name: "example.com", type: "dns-self"}], globals: {ca: "google-trust", encryption: "eccp256"}};
    try {
        const providerCatalogResponse = await app.request("http://localhost/resources/dns/providers", {headers: webHeaders}, env);
        assert.equal(providerCatalogResponse.status, 200);
        const providerCatalog: any = await providerCatalogResponse.json();
        assert.equal(providerCatalog.providerCount, 223);
        assert.equal(providerCatalog.readyCount, 3);
        assert.equal(providerCatalog.configurableCount, 3);
        assert.equal(providerCatalog.providers.filter((provider: any) => provider.status === "ready").length, 3);
        assert.equal(providerCatalog.providers.find((provider: any) => provider.id === "tencentcloud").applicationProvider, "dnspod");
        assert.equal(providerCatalog.providers.some((provider: any) => provider.credentials?.some((field: any) => /secret|token/i.test(field.name))), true);
        assert.equal((await app.request("http://localhost/apply/", {method: "POST", headers: webHeaders, body: JSON.stringify(payload)}, env)).status, 400);
        assert.equal((await app.request("http://localhost/api/v1/orders", {method: "POST", headers: apiHeaders, body: JSON.stringify(payload)}, env)).status, 400);
        assert.equal((await dao.listApplies()).total, 0);
        const missingKey = await app.request("http://localhost/resources/dns", {method: "POST", headers: webHeaders,
            body: JSON.stringify({name: "fixture", provider: "cloudflare", zones: ["example.com"], secrets: {token: "fixture-only-token"}})}, {...env, AUTOMATION_KEY: undefined});
        assert.equal(missingKey.status, 400);
        const created = await app.request("http://localhost/resources/dns", {method: "POST", headers: webHeaders,
            body: JSON.stringify({name: "fixture", provider: "cloudflare", zones: ["example.com"], secrets: {token: "fixture-only-token"}})}, env);
        assert.equal(created.status, 200);
        const view: any = await created.json();
        assert.equal(JSON.stringify(view).includes("fixture-only-token"), false);
        const personalResponse = await app.request("http://localhost/resources/dns", {method: "POST", headers: webHeaders,
            body: JSON.stringify({name: "personal", provider: "cloudflare", scopeMode: "account", zones: [], secrets: {token: "synthetic-token"}})}, env);
        assert.equal(personalResponse.status, 200);
        const personal: any = await personalResponse.json();
        const checkUrl = `http://localhost/resources/dns/${personal.item.id}/test`;
        for (const domain of [undefined, "", "https://example.com", ["example.com"], "_acme-challenge.example.com"]) {
            assert.equal((await app.request(checkUrl, {method: "POST", headers: webHeaders, body: JSON.stringify({domain})}, env)).status, 400);
        }
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async (input: any, options: any) => {
            assert.equal(options.method, "GET");
            const url = new URL(String(input));
            assert.equal(url.hostname, "api.cloudflare.com");
            return Response.json({success: true, result: url.searchParams.get("name") === "example.com" ? [{id: "synthetic-zone", name: "example.com"}] : []});
        }) as any;
        try {
            const checked = await app.request(checkUrl, {method: "POST", headers: webHeaders, body: JSON.stringify({domain: "www.example.com"})}, env);
            assert.equal(checked.status, 200);
            assert.deepEqual((await checked.json() as any).zone, {id: "synthetic-zone", name: "example.com"});
            const list: any = await (await app.request("http://localhost/resources/dns", {headers: webHeaders}, env)).json();
            assert.equal(list.items.find((item: any) => item.id === personal.item.id).connectionChecked, true);
            assert.equal(list.items.find((item: any) => item.id === view.item.id).connectionChecked, false);
        } finally { globalThis.fetch = originalFetch; }
        const request = {domains: [{name: "example.com", type: "dns-api", dnsAccountId: view.item.id}], globals: {ca: "lets-encrypt"}};
        const denied = await app.request("http://localhost/api/v1/orders", {method: "POST", headers: {...apiHeaders, "X-API-Mail": "other@example.com", "X-API-Token": "other-api"}, body: JSON.stringify(request)}, env);
        assert.equal(denied.status, 400);
        assert.equal((await dao.listApplies()).total, 0);
        const accepted = await app.request("http://localhost/api/v1/orders", {method: "POST", headers: apiHeaders, body: JSON.stringify(request)}, env);
        assert.equal(accepted.status, 202);
        assert.equal((await dao.listApplies()).total, 1);
        const removed = await app.request(`http://localhost/resources/dns/${view.item.id}`, {method: "DELETE", headers: webHeaders}, env);
        assert.equal(removed.status, 409);
    } finally { _resetDaoForTests(); invalidateAll(); database.close(); }
});

test("orders are accepted for background execution and modify never deletes the request", async () => {
    _resetDaoForTests(); invalidateAll();
    const database = memoryD1();
    const dao = new D1Dao(database as any);
    const scheduled: string[] = [];
    const env: any = {DB_CF: database, DB_SOURCE: "d1", ORDER_WORKFLOW: {
        idFromName: (name: string) => name,
        get: (name: string) => ({fetch: async () => { scheduled.push(name); return Response.json({accepted: true}); }}),
    }};
    const {app} = await import("../src/index");
    await dao.insertUser({mail: "background@example.com", pass: "fixture-session-key", apis: "fixture-api", keys: "never-used-fixture-key", flag: "1", is_admin: 0, quota: -1});
    const signer = new Hono();
    signer.get("/", async (context) => { await setSignedCookie(context, "auth", "fixture-session", "fixture-session-key"); return context.text("ok"); });
    const cookie = (await signer.request("http://localhost/")).headers.get("set-cookie")!.split(";")[0];
    const headers = {"Content-Type": "application/json", Cookie: `mail=background%40example.com; ${cookie}`};
    const originalFetch = globalThis.fetch;
    let externalCalls = 0;
    globalThis.fetch = (async () => { externalCalls++; throw new Error("External work must not run in the submission request"); }) as any;
    try {
        const response = await app.request("http://localhost/apply/", {method: "POST", headers,
            body: JSON.stringify({domains: [{name: "example.com", type: "dns-self"}], subject: {}, globals: {ca: "lets-encrypt", encryption: "eccp256", auto_renew: 1}})}, env);
        assert.equal(response.status, 202, await response.clone().text());
        const body: any = await response.json();
        assert.equal(body.flags, 0);
        assert.equal((await dao.getApply(body.order))?.flag, 0);
        assert.deepEqual(scheduled, [body.order]);
        assert.equal(externalCalls, 0);
        await app.request(`http://localhost/order/?id=${body.order}&op=modify`, {headers}, env);
        assert.ok(await dao.getApply(body.order), "Changing an application must never delete its original request");
        const original = (await dao.getApply(body.order))!;
        const {runOrderStep, readOrderWork} = await import('../src/order-workflow');
        const pause = await app.request(`http://localhost/apply/${body.order}/edit`, {method: 'POST', headers, body: '{}'}, env);
        const session: any = await pause.json();
        assert.equal(pause.status, 202);
        await runOrderStep(env, body.order, async () => { throw new Error('Editing must pause external processing'); });
        assert.equal((await readOrderWork(dao, body.order))!.status, 'action_required');
        assert.ok((await readOrderWork(dao, body.order))!.nextRun > Date.now());
        const edit = {domains: [{name: "updated.example.org", type: "dns-self"}], subject: {O: "Updated"},
            globals: {ca: "lets-encrypt", encryption: "eccp384", auto_renew: false}, targetIds: [], editRevision: session.revision};
        const edited = await app.request(`http://localhost/apply/${body.order}`, {method: "PUT", headers, body: JSON.stringify(edit)}, env);
        assert.equal(edited.status, 202);
        assert.equal((await edited.json() as any).order, body.order);
        assert.equal((await dao.getApply(body.order))!.list, original.list);
        await runOrderStep(env, body.order, async () => []);
        const updated = (await dao.getApply(body.order))!;
        assert.equal(updated.uuid, original.uuid);
        assert.equal(updated.time, original.time);
        assert.equal(JSON.parse(updated.list)[0].name, "updated.example.org");
        assert.equal(updated.type, "eccp384");
        const cancelled = await app.request(`http://localhost/order/?id=${body.order}&op=cancel`, {headers}, env);
        assert.equal(cancelled.status, 202);
        await runOrderStep(env, body.order, async () => { throw new Error("Cancelled work must not call the CA"); });
        assert.ok(await dao.getApply(body.order));
        assert.equal((await dao.getApply(body.order))!.flag, -1);
        const listed: any = await (await app.request('http://localhost/order/?id=all', {headers}, env)).json();
        assert.equal(listed.order[0].work.status, 'cancelled');
    } finally { globalThis.fetch = originalFetch; _resetDaoForTests(); invalidateAll(); database.close(); }
});

test("workerd durable alarms finish a queued request without a browser driving processing", {skip: !process.env.WORKFLOW_WORKER_SMOKE_URL, timeout: 45000}, async () => {
    const origin = process.env.WORKFLOW_WORKER_SMOKE_URL!;
    const schema = readFileSync(new URL('../schema.set.sql', import.meta.url), 'utf8');
    const statements = schema.split(';').map((statement) => statement.trim()).filter(Boolean);
    const accepted = await fetch(`${origin}/seed`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({statements})});
    assert.equal(accepted.status, 202, await accepted.clone().text());
    const observed = new Set<number>();
    const deadline = Date.now() + 30000;
    let result: any;
    while (Date.now() < deadline) {
        result = await (await fetch(`${origin}/status`)).json();
        observed.add(result.flag);
        if (result.work?.status === 'complete') break;
        await new Promise((resolve) => setTimeout(resolve, 400));
    }
    assert.equal(result.flag, 5, JSON.stringify(result));
    assert.equal(result.work.status, 'complete');
    assert.equal(result.work.nextRun, 0);
    assert.ok(observed.size >= 3);
});

test("delegated targets are stable and custom patterns cannot escape the administrator zone", () => {
    assert.equal(delegationTarget("legacy.dcv.example.com", "bad", "changed.example.com"), "legacy.dcv.example.com");
    assert.equal(delegationTarget(undefined, "a".repeat(16), "dcv.example.com"), `${"a".repeat(16)}.dcv.example.com`);
    assert.equal(delegationTarget(undefined, "a".repeat(16), "dcv.example.com", "tenant-{hash}.{zone}"), `tenant-${"a".repeat(16)}.dcv.example.com`);
    assert.throws(() => delegationTarget(undefined, "a".repeat(16), "dcv.example.com", "{hash}.attacker.com"));
});

test("persisted CA polling does not resubmit challenges or regress cleaned validated domains", async () => {
    const database = memoryD1();
    const dao = new D1Dao(database as any);
    const original = globalThis.fetch;
    const env: any = {DB_CF: database};
    const value = "b".repeat(43);
    let status = "pending";
    let completions = 0;
    const client = {getOrder: async () => ({status: "pending"}), getAuthorizations: async () => [
        {identifier: {value: "example.com"}, challenges: [{type: "dns-01", status: "valid"}]},
        {identifier: {value: "www.example.com"}, challenges: [{type: "dns-01", status}]},
    ], getChallengeKeyAuthorization: async () => value, completeChallenge: async () => { completions++; }};
    globalThis.fetch = (async () => Response.json({Answer: [{type: 16, data: `"${value}"`}]})) as any;
    try {
        await dao.insertApply({uuid: "poll", mail: "user@example.com", sign: null, type: null, auto: 1, flag: 3, time: 1, next: 1, main: "{}", data: "{}",
            list: JSON.stringify([{name: "example.com", type: "dns-api", flag: 4, dnsStatus: "cleaned"},
                {name: "www.example.com", type: "dns-self", auth: value, flag: 3}])});
        await dnsAuthy(env, {mail: "user@example.com"}, await dao.getApply("poll"), client);
        assert.equal((await dao.getApply("poll"))!.flag, 3);
        assert.equal(JSON.parse((await dao.getApply("poll"))!.list)[0].flag, 4);
        await dnsAuthy(env, {mail: "user@example.com"}, await dao.getApply("poll"), client);
        assert.equal(completions, 1);
        status = "valid";
        await dnsAuthy(env, {mail: "user@example.com"}, await dao.getApply("poll"), client);
        assert.equal((await dao.getApply("poll"))!.flag, 4);
    } finally { globalThis.fetch = original; database.close(); }
});

test("workerd authenticates password/private key and performs real SFTP with recovery", {skip: !process.env.SSH_WORKER_SMOKE_URL, timeout: 60000}, async () => {
    const hostPair = sshUtils.generateKeyPairSync("ecdsa", {bits: 256});
    const clientPair = sshUtils.generateKeyPairSync("ecdsa", {bits: 256});
    const hostKey: any = sshUtils.parseKey(hostPair.private);
    const clientKey: any = sshUtils.parseKey(clientPair.private);
    const fingerprint = `SHA256:${createHash("sha256").update(hostKey.getPublicSSH()).digest("base64").replace(/=+$/, "")}`;
    const files = new Map<string, Buffer>([["/cert.pem", Buffer.from("old-cert")], ["/key.pem", Buffer.from("old-key")]]);
    const modes = new Map<string, number>();
    const directories = new Set<string>();
    const authenticated = new Set<string>();
    const connections = new Set<any>();
    let failNextTest = false;
    let mutateAcmeDuringStage = false;
    const server = new Server({hostKeys: [hostPair.private]}, (connection) => {
        connections.add(connection);
        connection.on("error", () => {});
        connection.on("close", () => connections.delete(connection));
        connection.on("authentication", (context: any) => {
            if (context.method === "password" && context.password === "fixture-password") { authenticated.add("password"); context.accept(); }
            else if (context.method === "publickey" && context.key.data.equals(clientKey.getPublicSSH())
                && (!context.signature || clientKey.verify(context.blob, context.signature, context.hashAlgo))) {
                if (context.signature) authenticated.add("publickey");
                context.accept();
            } else context.reject();
        });
        connection.on("ready", () => connection.on("session", (accept: any) => {
            const session = accept();
            session.on("exec", (acceptCommand: any, reject: any, info: any) => {
                const stream = acceptCommand();
                const fail = failNextTest && info.command === "nginx -t";
                if (fail) failNextTest = false;
                stream.exit(fail ? 1 : 0); stream.end();
            });
            session.on("sftp", (acceptSftp: any) => {
                const stream = acceptSftp();
                const handles = new Map<string, string>();
                let nextHandle = 0;
                const status = (request: number, code = 0) => stream.status(request, code);
                const attributes = (request: number, path: string) => files.has(path) ? stream.attrs(request,
                    {mode: modes.get(path) ?? 0o100600, size: files.get(path)!.length, uid: 0, gid: 0, atime: 0, mtime: 0}) : status(request, 2);
                stream.on("OPEN", (request: number, path: string, flags: number, attrs: any) => {
                    if (mutateAcmeDuringStage && path.startsWith("/acme.json.acme-") && path.endsWith(".stage")) {
                        mutateAcmeDuringStage = false;
                        const concurrent = JSON.parse(files.get("/acme.json")!.toString());
                        concurrent.concurrentUpdate = true;
                        files.set("/acme.json", Buffer.from(JSON.stringify(concurrent)));
                    }
                    if (files.has(path) && flags & 32) return status(request, 4);
                    if (!files.has(path) && !(flags & 8)) return status(request, 2);
                    if (!files.has(path) || flags & 16) files.set(path, Buffer.alloc(0));
                    if (attrs.mode) modes.set(path, attrs.mode);
                    const handle = Buffer.alloc(4); handle.writeUInt32BE(++nextHandle); handles.set(handle.toString("hex"), path); stream.handle(request, handle);
                });
                stream.on("WRITE", (request: number, handle: Buffer, offset: number, data: Buffer) => {
                    const path = handles.get(handle.toString("hex"));
                    if (!path) return status(request, 2);
                    const previous = files.get(path)!;
                    const content = Buffer.alloc(Math.max(previous.length, offset + data.length)); previous.copy(content); data.copy(content, offset); files.set(path, content); status(request);
                });
                stream.on("READ", (request: number, handle: Buffer, offset: number, length: number) => {
                    const path = handles.get(handle.toString("hex")); const content = path ? files.get(path) : undefined;
                    if (!content) return status(request, 2);
                    if (offset >= content.length) return status(request, 1);
                    stream.data(request, content.subarray(offset, offset + length));
                });
                stream.on("CLOSE", (request: number, handle: Buffer) => { handles.delete(handle.toString("hex")); status(request); });
                stream.on("STAT", attributes); stream.on("LSTAT", attributes);
                stream.on("FSTAT", (request: number, handle: Buffer) => attributes(request, handles.get(handle.toString("hex")) ?? ""));
                stream.on("SETSTAT", (request: number, path: string, attrs: any) => { modes.set(path, attrs.mode); status(request); });
                stream.on("RENAME", (request: number, source: string, destination: string) => {
                    if (!files.has(source)) return status(request, 2);
                    files.set(destination, files.get(source)!); modes.set(destination, modes.get(source)!); files.delete(source); modes.delete(source); status(request);
                });
                stream.on("REMOVE", (request: number, path: string) => { const exists = files.delete(path); modes.delete(path); status(request, exists ? 0 : 2); });
                stream.on("MKDIR", (request: number, path: string) => { if (directories.has(path)) return status(request, 4); directories.add(path); status(request); });
                stream.on("RMDIR", (request: number, path: string) => { status(request, directories.delete(path) ? 0 : 2); });
            });
        }));
    });
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const port = (server.address() as any).port;
    const invoke = async (body: any) => (await fetch(`${process.env.SSH_WORKER_SMOKE_URL}/sftp-fixture`, {method: "POST",
        headers: {"Content-Type": "application/json"}, body: JSON.stringify({port, fingerprint, ...body}), signal: AbortSignal.timeout(20000)})).json() as Promise<any>;
    try {
        const password = await invoke({password: "fixture-password"});
        assert.equal(password.ok, true, password.error);
        assert.equal(files.get("/cert.pem")!.toString(), "fixture-new-cert");
        assert.equal(modes.get("/key.pem")! & 0o777, 0o600);
        files.set("/cert.pem", Buffer.from("old-cert")); files.set("/key.pem", Buffer.from("old-key"));
        failNextTest = true;
        const privateKey = await invoke({privateKey: clientPair.private});
        assert.equal(privateKey.ok, false);
        assert.match(privateKey.error, /previous files restored/);
        assert.equal(files.get("/cert.pem")!.toString(), "old-cert");
        assert.equal(files.get("/key.pem")!.toString(), "old-key");
        const mismatch = await invoke({password: "fixture-password", fingerprint: `SHA256:${"A".repeat(43)}`});
        assert.equal(mismatch.ok, false);
        assert.equal(authenticated.has("password"), true);
        assert.equal(authenticated.has("publickey"), true);
        files.set("/dynamic.yml", Buffer.from("http:\n  routers: {}\ntls:\n  certificates:\n    - certFile: /unrelated.pem\n      keyFile: /unrelated-key.pem\n"));
        const dynamic = await invoke({provider: "traefik", password: "fixture-password", config: {dynamicPath: "/dynamic.yml"}});
        assert.equal(dynamic.ok, true, dynamic.error);
        const dynamicConfig = parseYaml(files.get("/dynamic.yml")!.toString());
        assert.deepEqual(dynamicConfig.http, {routers: {}});
        assert.equal(dynamicConfig.tls.certificates.length, 2);
        files.set("/acme.json", Buffer.from(JSON.stringify({fixture: {Account: {key: "fixture-account"}, Certificates: [
            {domain: {main: "unrelated.example"}, certificate: "preserve"}]}, other: {Account: {key: "other-account"}}})));
        const acmeConfig = {traefikMode: "acme-json", acmePath: "/acme.json", resolver: "fixture", externalWriterStopped: true};
        const merged = await invoke({provider: "traefik", password: "fixture-password", config: acmeConfig});
        assert.equal(merged.ok, true, merged.error);
        const store = JSON.parse(files.get("/acme.json")!.toString());
        assert.equal(store.fixture.Account.key, "fixture-account");
        assert.equal(store.other.Account.key, "other-account");
        assert.equal(store.fixture.Certificates.length, 2);
        assert.equal(modes.get("/acme.json")! & 0o777, 0o600);
        directories.add("/acme.json.acme-lock");
        const locked = await invoke({provider: "traefik", password: "fixture-password", config: acmeConfig});
        assert.equal(locked.ok, false);
        assert.equal(directories.has("/acme.json.acme-lock"), true);
        directories.delete("/acme.json.acme-lock");
        mutateAcmeDuringStage = true;
        const concurrent = await invoke({provider: "traefik", password: "fixture-password", config: acmeConfig});
        assert.equal(concurrent.ok, false);
        assert.equal(JSON.parse(files.get("/acme.json")!.toString()).concurrentUpdate, true);
        const tlsKeys = forge.pki.rsa.generateKeyPair(2048);
        const certificate = forge.pki.createCertificate();
        certificate.publicKey = tlsKeys.publicKey;
        certificate.serialNumber = "01";
        certificate.validity.notBefore = new Date();
        certificate.validity.notAfter = new Date(Date.now() + 86400000);
        certificate.setSubject([{name: "commonName", value: "example.com"}]);
        certificate.setIssuer(certificate.subject.attributes);
        certificate.sign(tlsKeys.privateKey, forge.md.sha256.create());
        const pfx = await invoke({provider: "ssh", password: "fixture-password", pfxPassword: "fixture-pfx-password",
            config: {format: "pfx", pfxPath: "/bundle.pfx"}, artifact: {certificate: forge.pki.certificateToPem(certificate),
                privateKey: forge.pki.privateKeyToPem(tlsKeys.privateKey), domains: ["example.com"]}});
        assert.equal(pfx.ok, true, pfx.error);
        const parsed = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(files.get("/bundle.pfx")!.toString("binary")), false, "fixture-pfx-password");
        assert.equal(parsed.getBags({bagType: forge.pki.oids.certBag})[forge.pki.oids.certBag]!.length, 1);
        assert.equal(modes.get("/bundle.pfx")! & 0o777, 0o600);
        assert.equal(directories.size, 0);
    } finally {
        for (const connection of connections) connection.end();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
});

test("desktop/mobile UI submits scoped resources and exposes CA and deployment states", {skip: !process.env.WORKFLOW_UI_URL, timeout: 180000}, async () => {
    const {chromium} = await import("playwright-core");
    const browser = await chromium.launch({channel: "chrome", headless: true});
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}, hasTouch: true});
    const page = await context.newPage();
    const base = process.env.WORKFLOW_UI_URL!;
    const directory = fileURLToPath(new URL("../_artifacts/certificate-workflow/", import.meta.url));
    mkdirSync(directory, {recursive: true});
    const errors: string[] = [];
    const calls: {path: string; method: string; body?: any}[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let admin = true;
    let dcvAvailable = false;
    let encryptionReady = true;
    let dnsGate: Promise<void> | undefined;
    let dnsEntered: (() => void) | undefined;
    let failResourceLoad = false;
    let failResourceSave = false;
    let fixturePayload: any;
    let fixtureFlag = 2;
    let editingOrder = false;
    let allowCompletion = false;
    let completionPolls = 0;
    let releaseSubmission!: () => void;
    let submissionEntered!: () => void;
    const submissionGate = new Promise<void>((resolve) => { releaseSubmission = resolve; });
    const submissionStarted = new Promise<void>((resolve) => { submissionEntered = resolve; });
    const resource = (id: string, name: string, provider: string) => ({id, name, provider, kind: provider === "cloudflare" || provider.startsWith("lego:") ? "DNS_ACCOUNT" : "DEPLOY_TARGET",
        owner: "fixture@example.org", grants: [], zones: ["example.com"], enabled: true, config: {}, credentialsConfigured: true});
    const resources: Record<string, any[]> = {dns: [resource("dns-one", "Example DNS", "cloudflare")],
        targets: [resource("hook-one", "Certificate receiver", "https"), resource("nginx-one", "Public Nginx", "nginx")]};
    let deployments = [{targetId: "hook-one", name: "Certificate receiver", status: "ok", attempts: 1, version: "fixture-version", detail: "Certificate deployed"},
        {targetId: "nginx-one", name: "Public Nginx", status: "fail", attempts: 1, version: "fixture-version", detail: "Connection timeout"}];
    await page.route("**/bootstrap", (route) => route.fulfill({json: {initialized: true, site_title: "CertHub Local Acceptance", db_source: "d1", db_ok: true,
        mail_enabled: false, register_allow: false, cert_captcha: {enabled: false}, base_captcha: {enabled: false}}}));
    await page.route("**/check/", (route) => route.fulfill({json: {flags: 0, texts: "fixture@example.org", is_admin: admin ? 1 : 0, quota: -1}}));
    await page.route("**/apply/quota", (route) => route.fulfill({json: {flags: 0, monthly_limit: 0, month_used: 0, quota: -1, active_certs: 0}}));
    await page.route("**/account/apitoken*", (route) => route.fulfill({json: {flags: 0, configured: false, fingerprint: "", mail: "fixture@example.org"}}));
    await page.route("**/admin/users*", (route) => route.fulfill({json: {flags: 0, items: [], total: 0, page: 1, page_size: 20}}));
    await page.route("**/admin/confs*", (route) => route.fulfill({json: {flags: 0, items: {}, secret_keys: []}}));
    await page.route("**/capabilities", (route) => route.fulfill({json: {flags: 0, dcv: dcvAvailable
        ? {available: true, domain: "dcv.example.org", reason: "ready", missing: []}
        : {available: false, domain: "", reason: "missing_configuration", missing: admin ? ["DCV_AGENT", "DCV_ZONES", "DCV_API_TOKEN"] : []}, cas: [
        {id: "lets-encrypt", name: "Let's Encrypt", available: true, wildcard: true, reason: "ready", missing: [], pricing: "free", registered: true},
        {id: "google-trust", name: "Google Public CA", available: false, wildcard: true, reason: "missing_credentials", missing: admin ? ["GTS_keyID", "GTS_keyMC"] : [], pricing: "free", registered: false, eabConfigured: false},
        {id: "zeroca-trust", name: "ZeroSSL", available: false, wildcard: true, reason: "disabled", missing: [], pricing: "free-acme", registered: false},
        {id: "sslcom-trust", name: "SSL.com", available: true, wildcard: false, reason: "ready", missing: [], pricing: "product-dependent", registered: true},
    ]}}));
    await page.route("**/apply/", async (route) => {
        fixturePayload = route.request().postDataJSON();
        calls.push({path: '/apply/', method: 'POST', body: fixturePayload});
        submissionEntered();
        await submissionGate;
        await route.fulfill({status: 202, json: {flags: 0, order: 'fixture-order'}});
    });
    await page.route(/\/apply\/fixture-order(?:\/.*)?$/, async (route) => {
        const path = new URL(route.request().url()).pathname;
        const method = route.request().method();
        const body = route.request().postDataJSON();
        calls.push({path, method, body});
        if (path.endsWith('/edit')) editingOrder = true;
        else if (path.endsWith('/resume')) editingOrder = false;
        else if (method === 'PUT') { fixturePayload = body; editingOrder = false; }
        await route.fulfill({status: 202, json: {flags: 0, revision: 'fixture-edit-session', order: 'fixture-order'}});
    });
    await page.route('**/order/**', (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.get('op')) calls.push({path: `/order/?op=${url.searchParams.get('op')}`, method: 'GET'});
        if (allowCompletion && !editingOrder && ++completionPolls >= 2) fixtureFlag = 5;
        const payload = fixturePayload ?? {domains: [{name: 'example.com', type: 'dns-api', dnsAccountId: 'dns-one'}], targetIds: []};
        const record = {
            uuid: 'fixture-order', mail: 'fixture@example.org', sign: 'lets-encrypt', type: 'eccp256', auto: 1,
            flag: fixtureFlag, time: Date.now(), next: Date.now() + 86400000 * 60, main: JSON.stringify(payload.subject ?? {}),
            targetIds: payload.targetIds,
            list: JSON.stringify(payload.domains.map((domain: any) => ({...domain, flag: fixtureFlag === 5 ? 4 : 2,
                dnsStatus: fixtureFlag === 5 ? 'cleaned' : 'waiting_propagation', auth: 'x'.repeat(43)}))), cert: '', keys: '', text: 'Local acceptance fixture',
            work: {status: editingOrder ? 'action_required' : fixtureFlag === 5 ? 'complete' : 'waiting', intent: editingOrder ? 'edit' : 'process',
                detail: editingOrder ? '\u6b63\u5728\u7f16\u8f91' : fixtureFlag === 5 ? '\u8bc1\u4e66\u5df2\u7b7e\u53d1' : '\u7b49\u5f85 DNS \u8bb0\u5f55\u751f\u6548\uff0c\u5c06\u81ea\u52a8\u590d\u67e5',
                updatedAt: Date.now(), nextRun: fixtureFlag === 5 ? 0 : Date.now() + 4000},
        };
        return route.fulfill({json: {flags: 0, order: url.searchParams.get('id') === 'all' ? fixturePayload ? [record] : [] : record}});
    });
    await page.route("**/resources/**", async (route) => {
        const request = route.request(); const path = new URL(request.url()).pathname; const method = request.method();
        if (path === "/resources/dcv") {
            const body = request.postData() ? request.postDataJSON() : {};
            calls.push({path, method, body});
            dcvAvailable = true;
            return route.fulfill({json: {flags: 0, dcv: {available: true, domain: body.domain, reason: "ready", missing: []}}});
        }
        if (path === "/resources/dns/providers") {
            const registry: any = (await import("../src/dns-providers.generated.json")).default;
            const providers = registry.providers.map((provider: any) => ({...provider,
                applicationProvider: provider.applicationProvider ?? `lego:${provider.id}`,
                status: provider.status === "incompatible" ? "incompatible" : provider.adapter === "native" ? "ready" : "requires_test",
                resourceSchema: provider.adapter === "native" ? provider.resourceSchema : {
                    credentials: provider.credentials.filter((field: any) => !field.blocked), options: provider.options.filter((field: any) => !field.blocked)}}));
            return route.fulfill({json: {flags: 0, providerCount: registry.providerCount,
                readyCount: providers.filter((provider: any) => provider.status === "ready").length,
                configurableCount: providers.filter((provider: any) => ["ready", "requires_test"].includes(provider.status)).length, providers}});
        }
        if (path.includes("/orders/")) {
            if (method !== "GET") calls.push({path, method, body: request.postData() ? request.postDataJSON() : undefined});
            if (path.endsWith("/retry")) deployments = deployments.map((item) => path.includes(`/${item.targetId}/`) ? {...item, status: "ok", attempts: item.attempts + 1} : item);
            return route.fulfill({json: {flags: 0, items: deployments}});
        }
        const [, , kind, id, action] = path.split("/");
        if (!resources[kind]) return route.fulfill({status: 404, json: {flags: 4}});
        if (method === "GET") {
            if (kind === "dns" && dnsGate) { dnsEntered?.(); await dnsGate; }
            if (failResourceLoad) { failResourceLoad = false; return route.fulfill({json: {flags: 3, texts: "Synthetic load failure"}}); }
            return route.fulfill({json: {flags: 0, items: resources[kind], encryptionReady}});
        }
        const body = request.postData() ? request.postDataJSON() : {};
        calls.push({path, method, body});
        if (action === "test") return route.fulfill({json: {flags: 0, zone: kind === "dns" ? {name: body.domain, writable: body.confirmWrite} : undefined}});
        if (failResourceSave) { failResourceSave = false; return route.fulfill({json: {flags: 3, texts: "Synthetic save failure"}}); }
        if (method === "DELETE") resources[kind] = resources[kind].filter((item) => item.id !== id);
        else {
            const item = {...resource(id || `new-${resources[kind].length}`, body.name, body.provider), zones: body.zones, scopeMode: body.scopeMode, grants: body.grants ?? [], config: body.config, enabled: body.enabled};
            resources[kind] = [...resources[kind].filter((existing) => existing.id !== item.id), item];
        }
        return route.fulfill({json: {flags: 0}});
    });
    await page.route("https://www.gravatar.com/**", (route) => route.abort());
    try {
        await page.goto(`${base}/#/panel`);
        await page.getByText("welcome back", {exact: false}).waitFor({state: "visible"});
        await page.screenshot({path: directory + "desktop-panel-ux.png", fullPage: true});
        const sidebar = await page.locator("aside").first().elementHandle();
        assert.ok(sidebar);
        const assertShell = async () => {
            assert.equal(await sidebar.evaluate((element) => element.isConnected && element === document.querySelector("aside")), true);
            assert.equal(await page.locator('[aria-label^="terminal prompt "]').count(), 1);
        };
        const navigate = async (path: string) => {
            await page.locator("aside").first().locator(`a[href$="#${path}"]`).click();
            await page.waitForURL(`**/#${path}`);
        };
        await assertShell();
        await navigate("/certs");
        await page.getByText("ls -la", {exact: true}).waitFor();
        await assertShell();
        let releaseChunk: () => void = () => {};
        let chunkEntered: () => void = () => {};
        const chunkGate = new Promise<void>((resolve) => { releaseChunk = resolve; });
        const chunkStarted = new Promise<void>((resolve) => { chunkEntered = resolve; });
        await page.route("**/src/pages/Account/index.tsx*", async (route) => { chunkEntered(); await chunkGate; await route.continue(); });
        await navigate("/account");
        await chunkStarted;
        await page.locator('[role="status"][aria-busy="true"]').waitFor();
        assert.match(await page.locator('[role="status"][aria-busy="true"]').getAttribute("class") ?? "", /overlay/i);
        await assertShell();
        await page.screenshot({path: directory + "desktop-overlay-ux.png", fullPage: true});
        releaseChunk();
        await page.getByText("whoami", {exact: true}).waitFor();
        await page.locator('[role="status"][aria-busy="true"]').waitFor({state: "hidden"});
        await assertShell();
        let releaseDns: () => void = () => {};
        const enteredDns = new Promise<void>((resolve) => { dnsEntered = resolve; });
        dnsGate = new Promise<void>((resolve) => { releaseDns = resolve; });
        await navigate("/domains");
        await enteredDns;
        assert.equal(await page.getByText(/AUTOMATION_KEY/).count(), 0);
        assert.equal(await page.getByRole("button", {name: /\u65b0\s*\u5efa/}).isDisabled(), true);
        await assertShell();
        await navigate("/deployments");
        await page.getByRole("row").filter({hasText: "Certificate receiver"}).waitFor();
        const lateResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/resources/dns");
        releaseDns(); dnsGate = undefined;
        await lateResponse;
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        assert.equal(await page.getByRole("row").filter({hasText: "Example DNS"}).count(), 0);
        assert.equal(await page.getByRole("row").filter({hasText: "Certificate receiver"}).count(), 1);
        const adminLoaded = page.waitForResponse((response) => new URL(response.url()).pathname === "/admin/users");
        await navigate("/admin/users");
        await adminLoaded;
        await page.getByRole("table").waitFor();
        await assertShell();
        // DCV 托管设置属于管理员系统设置，未启用时先展示状态，配置后才启用“DCV 托管”验证方式
        await navigate("/admin/system");
        await page.getByText("DCV \u6258\u7ba1\uff08Cloudflare DNS \u4ee3\u7406\uff09", {exact: true}).waitFor();
        await page.getByText("\u672a\u542f\u7528\uff1a\u7533\u8bf7\u9875\u7684\u300cDCV \u6258\u7ba1\u300d\u9a8c\u8bc1\u65b9\u5f0f\u4e0d\u53ef\u9009", {exact: true}).waitFor();
        await page.getByRole("button", {name: "\u542f\u7528 DCV \u6258\u7ba1", exact: true}).click();
        await page.getByPlaceholder("dcv.example.com").fill("dcv.example.org");
        await page.getByPlaceholder("\u7c98\u8d34 Cloudflare DNS API Token").fill("fixture-dcv-token");
        await page.getByRole("checkbox", {name: "\u5141\u8bb8\u4e34\u65f6\u5199\u5165\u5e76\u6e05\u7406 TXT \u8bb0\u5f55\u4ee5\u9a8c\u8bc1\u6743\u9650"}).check();
        await page.locator(".ant-modal:visible .ant-modal-footer button.ant-btn-primary").click();
        await page.getByText("\u5df2\u542f\u7528\uff1a\u59d4\u6d3e\u57df\u540d dcv.example.org", {exact: true}).waitFor();
        assert.deepEqual(calls.find((call) => call.path === "/resources/dcv")!.body,
            {domain: "dcv.example.org", token: "fixture-dcv-token", confirmWrite: true});
        await assertShell();
        await page.screenshot({path: directory + "desktop-admin-system.png", fullPage: true});
        await page.setViewportSize({width: 1440, height: 1000});
        await page.goto(`${base}/#/about`);
        await page.getByText("技术栈", {exact: false}).first().waitFor();
        await page.screenshot({path: directory + "desktop-about.png", fullPage: true});
        await page.goto(`${base}/#/help`);
        await page.getByText("支持的证书品牌", {exact: false}).first().waitFor();
        await page.screenshot({path: directory + "desktop-help.png", fullPage: true});
        await page.goto(`${base}/#/apply`);
        await page.getByPlaceholder("example.com", {exact: true}).fill("example.com");
        await page.getByText("DNS \u8d26\u6237", {exact: true}).click();
        await page.getByRole("combobox").click();
        await page.getByText("Example DNS (cloudflare)", {exact: true}).click();
        await page.getByText('\u901a\u914d\u7b26 (*.)', {exact: true}).locator('..').getByRole('switch').click();
        await page.getByRole("button", {name: "\u4e0b\u4e00\u6b65", exact: true}).click();
        const google = page.getByRole("button", {name: /Google/});
        await google.waitFor({state: "visible"});
        assert.equal(await google.isDisabled(), true);
        assert.match(await page.getByRole("button", {name: /Let's Encrypt/}).getAttribute("class") ?? "", /caCardActive/);
        await google.locator("..").focus();
        await page.getByText(/\u7f3a\u5c11\u914d\u7f6e/).waitFor({state: "visible"});
        await page.screenshot({path: directory + "desktop-ca.png", fullPage: true});
        await page.keyboard.press("Escape");
        await page.getByRole("combobox").click();
        await page.getByText("Certificate receiver (https)", {exact: true}).click();
        await page.getByText("Public Nginx (nginx)", {exact: true}).click();
        await page.keyboard.press("Escape");
        await page.getByRole("button", {name: "\u4e0b\u4e00\u6b65", exact: true}).click();
        await page.getByRole("button", {name: "\u63d0\u4ea4\u7533\u8bf7", exact: true}).click();
        await submissionStarted;
        const overlay = page.locator('[role="status"][aria-busy="true"]').filter({hasText: '\u6b63\u5728\u63d0\u4ea4\u7533\u8bf7'});
        await overlay.waitFor();
        const overlayBounds = (await overlay.boundingBox())!;
        assert.equal(overlayBounds.x, 0);
        assert.equal(overlayBounds.y, 0);
        assert.equal(overlayBounds.width, 1440);
        assert.equal(overlayBounds.height, 1000);
        assert.equal(await page.evaluate(() => !!document.elementFromPoint(120, 240)?.closest('[role="status"][aria-busy="true"]')), true);
        await page.screenshot({path: directory + 'submission-overlay-background.png', fullPage: true});
        releaseSubmission();
        await page.waitForURL("**/#/order/fixture-order");
        const submission = calls.find((call) => call.path === "/apply/")!.body;
        assert.equal(submission.globals.ca, "lets-encrypt");
        assert.equal(submission.domains[0].dnsAccountId, "dns-one");
        assert.deepEqual(submission.targetIds, ["hook-one", "nginx-one"]);
        await page.getByText('\u7b49\u5f85 DNS \u751f\u6548', {exact: true}).first().waitFor();
        assert.equal(await page.getByRole('button', {name: '\u7acb\u5373\u5904\u7406', exact: true}).count(), 0);
        assert.equal(await page.getByRole('button', {name: '\u9a8c\u8bc1\u5168\u90e8', exact: true}).count(), 0);
        assert.equal(await page.getByText('dns-api', {exact: true}).count(), 0);
        const verifyBounds = (await page.locator('[class*="verifyCard"]').boundingBox())!;
        const deploymentBounds = (await page.getByRole('heading', {name: '\u90e8\u7f72\u72b6\u6001', exact: true}).locator('xpath=../..').boundingBox())!;
        assert.ok(deploymentBounds.y - verifyBounds.y - verifyBounds.height >= 20);
        await page.screenshot({path: directory + 'automatic-dns-background.png', fullPage: true});
        await page.setViewportSize({width: 390, height: 844});
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
        await page.screenshot({path: directory + 'automatic-dns-background-mobile.png', fullPage: true});
        await page.setViewportSize({width: 1440, height: 1000});
        await page.getByRole('button', {name: '\u4fee\u6539\u7533\u8bf7', exact: true}).click();
        await page.waitForURL('**/#/apply?edit=fixture-order');
        await page.waitForFunction(() => {
            const inputs = document.querySelectorAll<HTMLInputElement>('input[placeholder="example.com"]');
            return inputs.length === 1 && inputs[0].value === 'example.com';
        });
        await page.getByRole('button', {name: '\u53d6\u6d88\u7f16\u8f91', exact: true}).click();
        await page.waitForURL('**/#/order/fixture-order');
        assert.equal(calls.some((call) => call.path.includes('op=modify')), false);
        await page.getByRole('button', {name: '\u4fee\u6539\u7533\u8bf7', exact: true}).click();
        await page.waitForURL('**/#/apply?edit=fixture-order');
        await page.waitForFunction(() => {
            const inputs = document.querySelectorAll<HTMLInputElement>('input[placeholder="example.com"]');
            return inputs.length === 1 && inputs[0].value === 'example.com';
        });
        await page.getByPlaceholder('example.com', {exact: true}).fill('updated.example.com');
        await page.getByRole('button', {name: '\u4e0b\u4e00\u6b65', exact: true}).click();
        await page.getByRole('button', {name: '\u4e0b\u4e00\u6b65', exact: true}).click();
        await page.getByRole('button', {name: '\u4fdd\u5b58\u66f4\u6539', exact: true}).click();
        await page.waitForURL('**/#/order/fixture-order');
        const editedPayload = calls.find((call) => call.path === '/apply/fixture-order' && call.method === 'PUT')!.body;
        assert.equal(editedPayload.domains[0].name, 'updated.example.com');
        assert.equal(editedPayload.editRevision, 'fixture-edit-session');
        assert.equal(calls.filter((call) => call.path === '/apply/').length, 1);
        await navigate('/certs');
        await page.getByText('updated.example.com', {exact: true}).first().waitFor();
        completionPolls = 0;
        const refreshedList = page.waitForResponse((response) => {
            const url = new URL(response.url());
            return url.pathname === '/order/' && url.searchParams.get('id') === 'all' && completionPolls >= 2;
        });
        allowCompletion = true;
        await refreshedList;
        await page.getByText('\u5df2\u7b7e\u53d1', {exact: true}).first().waitFor();
        await page.goto(`${base}/#/order/fixture-order`);
        await page.getByText('\u5168\u90e8\u57df\u540d\u5df2\u9a8c\u8bc1', {exact: true}).waitFor();
        const failed = page.getByRole("row").filter({hasText: "Public Nginx"});
        await failed.getByRole("button", {name: "\u91cd\u8bd5\u6b64\u76ee\u6807"}).click();
        await failed.getByText("\u5df2\u90e8\u7f72", {exact: true}).waitFor({state: "visible"});
        assert.equal(calls.filter((call) => call.path.endsWith("/retry")).length, 1);
        assert.equal(calls.find((call) => call.path.endsWith("/retry"))!.path.includes("nginx-one"), true);
        await page.screenshot({path: directory + "desktop-order.png", fullPage: true});
        deployments = [];
        fixturePayload = {...fixturePayload, targetIds: []};
        await page.reload();
        await page.getByText('\u672a\u8bbe\u7f6e\u81ea\u52a8\u90e8\u7f72\uff0c\u7b7e\u53d1\u540e\u53ef\u4e0b\u8f7d\u8bc1\u4e66\u3002', {exact: true}).waitFor();
        assert.equal(await page.getByRole('table').count(), 0);
        await page.screenshot({path: directory + 'automatic-dns-empty-deployment.png', fullPage: true});
        await page.goto(`${base}/#/domains`);
        await page.getByRole("button", {name: /\u65b0\s*\u5efa/}).click();
        await page.getByLabel("\u8d26\u6237\u540d", {exact: true}).fill("Local acceptance DNS");
        assert.equal(await page.getByLabel("\u5141\u8bb8\u4f7f\u7528\u7684\u57df\u540d", {exact: true}).isVisible(), false);
        assert.equal(await page.getByLabel("\u5171\u4eab\u7ed9\u54ea\u4e9b\u7528\u6237", {exact: true}).count(), 0);
        await page.getByLabel("API Token", {exact: true}).fill("fixture-only-token");
        failResourceSave = true;
        await page.getByRole("button", {name: /\u4fdd\s*\u5b58/}).click();
        await page.getByText("Synthetic save failure", {exact: true}).waitFor();
        assert.equal(await page.getByRole("dialog").isVisible(), true);
        await page.getByRole("button", {name: /\u4fdd\s*\u5b58/}).click();
        const created = page.getByRole("row").filter({hasText: "Local acceptance DNS"});
        await created.waitFor({state: "visible"});
        const personalPayload = calls.filter((call) => call.path === "/resources/dns" && call.body?.name === "Local acceptance DNS").at(-1)!.body;
        assert.equal(personalPayload.scopeMode, "account");
        assert.deepEqual(personalPayload.zones, []);
        assert.deepEqual(personalPayload.grants, []);
        assert.equal(calls.some((call) => call.path.endsWith("/test")), false);
        await created.getByRole("button", {name: "\u68c0\u67e5\u8fde\u63a5", exact: true}).click();
        assert.equal(await page.getByLabel("\u68c0\u67e5\u54ea\u4e2a\u57df\u540d").inputValue(), "");
        await page.getByLabel("\u68c0\u67e5\u54ea\u4e2a\u57df\u540d").fill("check.example.net");
        await page.getByRole("button", {name: /\u5f00\u59cb\u68c0\u67e5/}).click();
        await page.getByText("\u5df2\u627e\u5230\u533a\u57df check.example.net", {exact: true}).waitFor();
        await created.getByRole("button", {name: "\u7f16\u8f91", exact: true}).click();
        assert.equal(await page.getByLabel("API Token", {exact: true}).inputValue(), "");
        await page.getByRole("button", {name: "\u9ad8\u7ea7\u8bbe\u7f6e", exact: true}).click();
        await page.getByRole("radio", {name: "\u5171\u4eab\u7ed9\u6307\u5b9a\u7528\u6237", exact: true}).check();
        assert.equal(await page.getByRole("radio", {name: "\u6309\u7533\u8bf7\u57df\u540d\u81ea\u52a8\u67e5\u627e", exact: true}).isDisabled(), true);
        await page.getByLabel("\u5141\u8bb8\u4f7f\u7528\u7684\u57df\u540d", {exact: true}).fill("example.com");
        await page.getByLabel("\u5141\u8bb8\u4f7f\u7528\u7684\u57df\u540d", {exact: true}).press("Enter");
        await page.getByLabel("\u5171\u4eab\u7ed9\u54ea\u4e9b\u7528\u6237", {exact: true}).fill("guest@example.org");
        await page.getByLabel("\u5171\u4eab\u7ed9\u54ea\u4e9b\u7528\u6237", {exact: true}).press("Enter");
        await page.getByRole("button", {name: "\u9ad8\u7ea7\u8bbe\u7f6e", exact: true}).click();
        await page.getByRole("button", {name: /\u4fdd\s*\u5b58/}).click();
        await page.getByRole("dialog").waitFor({state: "hidden"});
        const sharedPayload = calls.filter((call) => call.method === "PUT" && call.body?.name === "Local acceptance DNS").at(-1)!.body;
        assert.equal(sharedPayload.scopeMode, "zones");
        assert.deepEqual(sharedPayload.zones, ["example.com"]);
        assert.deepEqual(sharedPayload.grants, ["guest@example.org"]);
        assert.equal(sharedPayload.secrets?.token ?? "", "");
        await page.screenshot({path: directory + "desktop-resources.png", fullPage: true});
        await page.getByRole("button", {name: /\u65b0\s*\u5efa/}).click();
        await page.getByLabel("\u8d26\u6237\u540d", {exact: true}).fill("Lego schema acceptance");
        await page.getByLabel("API Token", {exact: true}).fill("old-provider-token");
        const registry: any = (await import("../src/dns-providers.generated.json")).default;
        const digitalOcean = registry.providers.find((provider: any) => provider.id === "digitalocean");
        await page.getByLabel("DNS \u670d\u52a1\u5546", {exact: true}).fill(digitalOcean.displayName);
        await page.locator(".ant-select-dropdown:visible").getByText(digitalOcean.displayName, {exact: true}).click();
        assert.equal(await page.getByText(/\u9700\u9a8c\u8bc1\u8d26\u6237/).count(), 0);
        await page.locator('[data-dns-field="DO_AUTH_TOKEN"] input').fill("synthetic-lego-token");
        await page.getByRole("button", {name: "\u9ad8\u7ea7\u8bbe\u7f6e", exact: true}).click();
        await page.locator('[data-dns-field="DO_TTL"] input').fill("60");
        await page.getByRole("button", {name: "\u9ad8\u7ea7\u8bbe\u7f6e", exact: true}).click();
        await page.screenshot({path: directory + "desktop-dns-lego-form.png", fullPage: true});
        await page.setViewportSize({width: 390, height: 844});
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
        await page.screenshot({path: directory + "mobile-dns-lego-form.png", fullPage: true});
        await page.getByRole("button", {name: /\u4fdd\s*\u5b58/}).click();
        const legoPayload = calls.find((call) => call.body?.provider === "lego:digitalocean")!.body;
        assert.equal(legoPayload.secrets.DO_AUTH_TOKEN, "synthetic-lego-token");
        assert.equal(legoPayload.config.DO_TTL, "60");
        assert.equal("DO_AUTH_TOKEN" in legoPayload.config, false);
        assert.equal("DO_TTL" in legoPayload.secrets, false);
        assert.equal("token" in legoPayload.secrets, false);
        assert.deepEqual(legoPayload.zones, []);
        const legoRow = page.getByRole("row").filter({hasText: "Lego schema acceptance"});
        await legoRow.getByText(digitalOcean.displayName, {exact: true}).waitFor();
        await legoRow.getByText("\u5f85\u68c0\u67e5", {exact: true}).waitFor();
        await legoRow.getByRole("button", {name: "\u68c0\u67e5\u8fde\u63a5"}).click();
        await page.getByLabel("\u68c0\u67e5\u54ea\u4e2a\u57df\u540d").fill("lego.example.net");
        const checksBefore = calls.filter((call) => call.path.endsWith("/test")).length;
        await page.getByRole("button", {name: /\u5f00\u59cb\u68c0\u67e5/}).click();
        await page.getByText("\u8bf7\u786e\u8ba4\u5141\u8bb8\u4e34\u65f6 TXT \u5199\u5165\u548c\u6e05\u7406", {exact: true}).waitFor();
        assert.equal(calls.filter((call) => call.path.endsWith("/test")).length, checksBefore);
        await page.getByRole("checkbox", {name: "\u5141\u8bb8\u4e34\u65f6\u5199\u5165 TXT \u5e76\u5728\u68c0\u67e5\u540e\u6e05\u7406"}).check();
        await page.getByRole("button", {name: /\u5f00\u59cb\u68c0\u67e5/}).click();
        await page.getByText("\u5df2\u9a8c\u8bc1 DNS \u5199\u5165\u3001\u4f20\u64ad\u548c\u6e05\u7406", {exact: true}).waitFor();
        assert.deepEqual(calls.filter((call) => call.path.endsWith("/test")).at(-1)!.body, {domain: "lego.example.net", confirmWrite: true});
        await page.getByRole("row").filter({hasText: "Lego schema acceptance"}).getByRole("button", {name: "\u7f16\u8f91", exact: true}).click();
        assert.equal(await page.locator('[data-dns-field="DO_AUTH_TOKEN"] input').inputValue(), "");
        await page.getByRole("button", {name: /\u53d6\s*\u6d88/}).click();
        failResourceLoad = true;
        await page.getByRole("button", {name: "\u5237\u65b0", exact: true}).click();
        await page.getByText("\u8d44\u6e90\u52a0\u8f7d\u5931\u8d25", {exact: true}).waitFor();
        assert.equal(await page.getByText(/AUTOMATION_KEY/).count(), 0);
        await page.getByRole("button", {name: /\u91cd\s*\u8bd5/, exact: true}).click();
        await page.getByText("\u8d44\u6e90\u52a0\u8f7d\u5931\u8d25", {exact: true}).waitFor({state: "hidden"});
        await page.setViewportSize({width: 1440, height: 1000});
        await page.goto(`${base}/#/deployments`);
        await page.getByRole("button", {name: /\u65b0\s*\u5efa/}).click();
        await page.getByLabel("\u540d\u79f0", {exact: true}).fill("Target defaults");
        assert.equal(await page.getByLabel("\u7aef\u53e3", {exact: true}).inputValue(), "22");
        await page.getByLabel("\u670d\u52a1\u5668\u5730\u5740", {exact: true}).fill("old.example.org");
        await page.getByLabel("\u7c7b\u578b", {exact: true}).press("ArrowDown");
        await page.locator(".ant-select-dropdown:visible").getByText("HTTPS", {exact: true}).click();
        await page.getByLabel("\u63a5\u6536\u5730\u5740", {exact: true}).fill("https://old.example.org/cert");
        await page.getByLabel("\u7c7b\u578b", {exact: true}).press("ArrowDown");
        await page.locator(".ant-select-dropdown:visible").getByText("Nginx (SSH)", {exact: true}).click();
        assert.equal(await page.getByLabel("\u670d\u52a1\u5668\u5730\u5740", {exact: true}).inputValue(), "");
        assert.equal(await page.getByLabel("\u7aef\u53e3", {exact: true}).inputValue(), "22");
        assert.equal(await page.getByLabel("\u8bc1\u4e66\u5b8c\u6574\u94fe\u8def\u5f84", {exact: true}).inputValue(), "/etc/nginx/tls/fullchain.pem");
        await page.getByLabel("\u670d\u52a1\u5668\u5730\u5740", {exact: true}).fill("nginx.example.org");
        await page.getByLabel("\u7528\u6237\u540d", {exact: true}).fill("deploy");
        await page.getByLabel("\u767b\u5f55\u5bc6\u7801", {exact: true}).fill("synthetic-target-password");
        await page.getByLabel("SSH \u4e3b\u673a\u6307\u7eb9 (SHA256)", {exact: true}).fill("SHA256:synthetic-only");
        await page.getByLabel("\u90e8\u7f72\u54ea\u4e9b\u57df\u540d", {exact: true}).fill("example.com");
        await page.getByLabel("\u90e8\u7f72\u54ea\u4e9b\u57df\u540d", {exact: true}).press("Enter");
        await page.getByRole("button", {name: /\u4fdd\s*\u5b58/}).click();
        await page.getByRole("dialog").waitFor({state: "hidden"});
        const targetPayload = calls.find((call) => call.body?.name === "Target defaults")!.body;
        assert.equal(targetPayload.config.port, 22);
        assert.equal(targetPayload.config.certificatePath, "/etc/nginx/tls/fullchain.pem");
        assert.equal("url" in targetPayload.config, false);
        assert.deepEqual(targetPayload.zones, ["example.com"]);
        await page.setViewportSize({width: 390, height: 844});
        await page.goto(`${base}/#/apply`);
        await page.getByPlaceholder("example.com", {exact: true}).fill("example.com");
        await page.screenshot({path: directory + "mobile-domain.png", fullPage: true});
        assert.equal(await page.locator(".ant-segmented").first().evaluate((group) => {
            const bounds = group.getBoundingClientRect();
            return Array.from(group.querySelectorAll<HTMLElement>(".ant-segmented-item-label")).every((label) => {
                const rect = label.getBoundingClientRect();
                return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 && label.scrollWidth <= label.clientWidth + 1;
            });
        }), true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
        await page.getByRole("button", {name: "\u4e0b\u4e00\u6b65", exact: true}).click();
        await page.getByRole("button", {name: /Google/}).waitFor({state: "visible"});
        await page.getByRole("button", {name: /Google/}).locator("..").tap();
        await page.getByText(/\u7f3a\u5c11\u914d\u7f6e/).waitFor({state: "visible"});
        await page.screenshot({path: directory + "mobile-ca.png", fullPage: true});
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
        admin = false;
        dcvAvailable = false;
        await page.reload();
        await page.getByPlaceholder("example.com", {exact: true}).fill("example.com");
        assert.equal(await page.locator(".ant-segmented-item-disabled").filter({hasText: "DCV \u6258\u7ba1"}).count(), 1);
        await page.getByRole("button", {name: "\u4e0b\u4e00\u6b65", exact: true}).click();
        await page.getByRole("button", {name: /Google/}).locator("..").focus();
        await page.getByText("\u6682\u4e0d\u53ef\u7528\uff0c\u8bf7\u8054\u7cfb\u7ba1\u7406\u5458", {exact: true}).waitFor({state: "visible"});
        encryptionReady = false;
        await page.goto(`${base}/#/domains`);
        await page.getByRole("button", {name: /\u65b0\s*\u5efa/}).waitFor({state: "visible"});
        assert.equal(await page.getByRole("button", {name: /\u65b0\s*\u5efa/}).isDisabled(), true);
        await page.screenshot({path: directory + "mobile-resources-locked.png", fullPage: true});
        assert.deepEqual(errors, []);
    } catch (error) {
        await page.screenshot({path: directory + "ui-failure.png", fullPage: true});
        throw error;
    } finally { await browser.close(); }
});

test("failed DNS cleanup retries without a legacy DCV zone and safely accepts already deleted records", async () => {
    _resetDaoForTests(); invalidateAll();
    const database = memoryD1(); const dao = new D1Dao(database as any); const original = globalThis.fetch;
    const env: any = {DB_SOURCE: "d1", DB_CF: database, AUTOMATION_KEY: Buffer.alloc(32, 3).toString("base64")};
    const account = await saveResource(dao, env.AUTOMATION_KEY, "DNS_ACCOUNT", {mail: "user@example.com"}, {
        name: "fixture", provider: "cloudflare", zones: ["example.com"], secrets: {token: "fixture-token"}});
    const handle = {id: "exact", zone: {name: "example.com", id: "zone"}, name: "_acme-challenge.example.com", value: "a".repeat(43), owned: true};
    let missing = true;
    globalThis.fetch = (async (url: any) => {
        assert.match(String(url), /\/zones\/zone\/dns_records\/exact$/);
        return missing ? Response.json({success: false}, {status: 404}) : Response.json({success: false}, {status: 503});
    }) as any;
    try {
        await dao.insertApply({uuid: "cleanup", mail: "user@example.com", sign: null, type: null, auto: 1, flag: 5,
            time: 1, next: 1, main: "{}", list: JSON.stringify([{name: "example.com", dnsAccountId: account.id, dnsStatus: "cleanup_pending", dnsHandle: handle}])});
        missing = false;
        assert.equal(await retryDnsCleanup(env), 0);
        assert.equal(JSON.parse((await dao.getApply("cleanup"))!.list)[0].dnsStatus, "cleanup_pending");
        missing = true;
        assert.equal(await retryDnsCleanup(env), 1);
        assert.equal(JSON.parse((await dao.getApply("cleanup"))!.list)[0].dnsStatus, "cleaned");
        assert.equal(await retryDnsCleanup(env), 0);
    } finally { globalThis.fetch = original; _resetDaoForTests(); invalidateAll(); database.close(); }
});

test("lego registry rejects unbound/mismatched services and separates credential/options fields", async () => {
    const manifest: any = shardBuilds.shards.find((shard) => shard.providers.includes("digitalocean"));
    assert.ok(manifest?.buildHash);
    const previous = manifest.verifiedProviders;
    manifest.verifiedProviders = ["digitalocean"];
    try {
        assert.equal((await dnsCatalog({})).filter((provider) => provider.status === "ready").length, 3);
        await assert.rejects(dnsShard({}, "lego:digitalocean"));
        await assert.rejects(dnsShard({[manifest.binding]: {fetch: async () => Response.json({...manifest, buildHash: "wrong-version"})}}, "lego:digitalocean"));
        const env = {[manifest.binding]: {fetch: async () => Response.json(manifest)}};
        assert.equal((await dnsShard(env, "lego:digitalocean")).definition.id, "digitalocean");
        assert.doesNotThrow(() => validateDnsSettings("lego:digitalocean", {DO_TTL: "60"}, {DO_AUTH_TOKEN: "synthetic-only-secret"}));
        assert.throws(() => validateDnsSettings("lego:digitalocean", {DO_AUTH_TOKEN: "synthetic-only-secret"}, {}));
        assert.throws(() => validateDnsSettings("lego:digitalocean", {}, {DO_AUTH_TOKEN_FILE: "C:/not-allowed"}));
        assert.throws(() => validateDnsSettings("lego:digitalocean", {DO_API_URL: "https://attacker.invalid"}, {DO_AUTH_TOKEN: "synthetic-only-secret"}));
    } finally { manifest.verifiedProviders = previous; }
});

test("main lego issuance rechecks tenant grants, holds an order lease and persists issuance for the existing completion flow", async () => {
    _resetDaoForTests(); invalidateAll();
    const database = memoryD1();
    const dao = new D1Dao(database as any);
    const manifest: any = shardBuilds.shards.find((shard) => shard.providers.includes("digitalocean"));
    const previous = manifest.verifiedProviders;
    manifest.verifiedProviders = ["digitalocean"];
    let executions = 0;
    let hold: Promise<void> | undefined;
    let started: (() => void) | undefined;
    let lastPayload: any;
    const env: any = {DB_SOURCE: "d1", DB_CF: database, AUTOMATION_KEY: Buffer.alloc(32, 13).toString("base64"),
        [manifest.binding]: {fetch: async (url: string, options: any = {}) => {
            if (url.endsWith("/health")) return Response.json(manifest);
            executions++;
            lastPayload = JSON.parse(options.body);
            started?.();
            if (hold) await hold;
            return Response.json({ok: true, cleanupOk: true, stage: "complete", certificate: "-----BEGIN CERTIFICATE-----\nSYNTHETIC\n-----END CERTIFICATE-----", order: {url: "https://ca.fixture/order", status: "valid"}});
        }}};
    try {
        const resource = await saveResource(dao, env.AUTOMATION_KEY, "DNS_ACCOUNT", {mail: "owner@example.com", is_admin: 1},
            {name: "Lego fixture", provider: "lego:digitalocean", zones: ["example.com"], grants: ["tenant@example.com"], secrets: {DO_AUTH_TOKEN: "synthetic-only-secret"}}, "lego-fixture", env);
        const order: any = {uuid: "lego-order", mail: "tenant@example.com", sign: "lets-encrypt", type: "eccp256", auto: 1, flag: 1, time: Date.now(), next: 0,
            list: JSON.stringify([{name: "example.com", type: "dns-api", dnsAccountId: resource.id}]), data: JSON.stringify({url: "https://ca.fixture/order"}), main: "{}", cert: "", keys: "", text: ""};
        await dao.insertApply(order);
        const client: any = {getOrder: async () => ({url: "https://ca.fixture/order", status: "pending"}), getAccountUrl: () => "https://ca.fixture/account",
            getAuthorizations: async () => [{url: "https://ca.fixture/authz", status: "pending", identifier: {value: "example.com"}, challenges: [{type: "dns-01", token: "synthetic-token", url: "https://ca.fixture/challenge"}]}],
            getChallengeKeyAuthorization: async (challenge: any) => { assert.equal(challenge.type, "http-01"); return "synthetic-token.synthetic-thumbprint"; }};
        const options = {directoryUrl: "https://ca.fixture/directory", accountKey: "synthetic-account-key"};
        assert.equal(await issueLegoOrder(env, {mail: order.mail}, order, client, options), true);
        const issued = (await dao.getApply(order.uuid))!;
        assert.equal(Number(issued.flag), 4);
        assert.match(issued.cert!, /BEGIN CERTIFICATE/);
        assert.match(issued.keys!, /PRIVATE KEY/);
        assert.equal(lastPayload.groups[0].provider, "digitalocean");
        assert.deepEqual(lastPayload.groups[0].zones, ["example.com"]);
        assert.equal(lastPayload.groups[0].challenges[0].keyAuthorization, "synthetic-token.synthetic-thumbprint");
        assert.equal(lastPayload.groups[0].env.DO_AUTH_TOKEN, "synthetic-only-secret");
        assert.equal(JSON.stringify(lastPayload).includes(issued.keys!), false);
        assert.equal((await dao.getConf(`LEGO_STATE:${order.uuid}`))!.includes("synthetic-only-secret"), false);
        assert.equal(await dao.getConf(`LEGO_LEASE:${order.uuid}`), null);
        await dao.updateApply(order.uuid, {flag: 1});
        await dao.upsertConf(`DNS_ACCOUNT:${resource.id}`, JSON.stringify({...resource, grants: []}), Date.now());
        await assert.rejects(issueLegoOrder(env, {mail: order.mail}, order, client, options), /scope/);
        assert.equal(executions, 1);
        await dao.upsertConf(`DNS_ACCOUNT:${resource.id}`, JSON.stringify(resource), Date.now());
        let release: () => void = () => {};
        hold = new Promise<void>((resolve) => { release = resolve; });
        const entered = new Promise<void>((resolve) => { started = resolve; });
        const first = issueLegoOrder(env, {mail: order.mail}, order, client, options);
        await entered;
        assert.equal(await issueLegoOrder(env, {mail: order.mail}, order, client, options), true);
        assert.equal(executions, 2);
        release();
        await first;
        assert.equal(Number((await dao.getApply(order.uuid))!.flag), 4);
        hold = undefined;
        const automatic = await saveResource(dao, env.AUTOMATION_KEY, "DNS_ACCOUNT", {mail: order.mail},
            {name: "Automatic", provider: "lego:digitalocean", scopeMode: "account", zones: [], secrets: {DO_AUTH_TOKEN: "synthetic-token"}}, "automatic", env);
        const {app} = await import("../src/index");
        await dao.insertUser({mail: order.mail, pass: "synthetic-session-key", apis: "synthetic-api", flag: "1", is_admin: 0, quota: -1});
        const signer = new Hono();
        signer.get("/", async (context) => { await setSignedCookie(context, "auth", "synthetic-session", "synthetic-session-key"); return context.text("ok"); });
        const cookie = (await signer.request("http://localhost/")).headers.get("set-cookie")!.split(";")[0];
        const headers = {"Content-Type": "application/json", Cookie: `mail=tenant%40example.com; ${cookie}`};
        const checkUrl = `http://localhost/resources/dns/${automatic.id}/test`;
        const beforeCheck = executions;
        assert.equal((await app.request(checkUrl, {method: "POST", headers, body: JSON.stringify({domain: "test.example.net"})}, env)).status, 400);
        assert.equal(executions, beforeCheck);
        const serviceFetch = env[manifest.binding].fetch;
        env[manifest.binding].fetch = async (url: string, init: any = {}) => {
            if (url.endsWith("/test")) {
                lastPayload = JSON.parse(init.body);
                return Response.json({ok: true, tested: true, cleanupOk: true});
            }
            return serviceFetch(url, init);
        };
        assert.equal((await app.request(checkUrl, {method: "POST", headers, body: JSON.stringify({domain: "Test.Example.NET", confirmWrite: true})}, env)).status, 200);
        assert.deepEqual(lastPayload.groups[0].zones, ["test.example.net"]);
        assert.equal(lastPayload.groups[0].challenges[0].domain, "test.example.net");
        await assert.rejects(testLegoAccount(env, "stranger@example.com", automatic.id, "example.com"), /scope/);
        await dao.updateApply(order.uuid, {flag: 1, mail: automatic.owner, list: JSON.stringify([{name: "example.com", type: "dns-api", dnsAccountId: automatic.id}])});
        assert.equal(await issueLegoOrder(env, {mail: automatic.owner}, (await dao.getApply(order.uuid))!, client, options), true);
        assert.deepEqual(lastPayload.groups[0].zones, ["example.com"]);
        client.getAuthorizations = async () => [{status: "valid", identifier: {value: "example.com"}, challenges: []}];
        await dao.updateApply(order.uuid, {flag: 1});
        assert.equal(await issueLegoOrder(env, {mail: automatic.owner}, (await dao.getApply(order.uuid))!, client, options), true);
        assert.deepEqual(lastPayload.groups[0].challenges, []);
        assert.deepEqual(lastPayload.groups[0].zones, ["example.com"]);
    } finally { manifest.verifiedProviders = previous; _resetDaoForTests(); invalidateAll(); database.close(); }
});

test("built lego accounts require revision-bound verification before issuance", async () => {
    const manifest: any = shardBuilds.shards.find((shard) => shard.providers.includes("digitalocean"));
    const previous = manifest.verifiedProviders;
    manifest.verifiedProviders = [];
    const evidence = new Map<string, string>();
    const dao: any = {getConf: async (name: string) => evidence.get(name) ?? null};
    const resource: any = {id: "pending", provider: "lego:digitalocean", owner: "user@example.com", updatedAt: 42};
    const env = {[manifest.binding]: {fetch: async () => Response.json(manifest)}};
    try {
        assert.equal((await dnsCatalog(env)).find((item) => item.id === "digitalocean")?.status, "requires_test");
        await assert.rejects(dnsShard(env, resource.provider), /verification/);
        assert.ok((await dnsShard(env, resource.provider, {forTest: true})).service);
        await assert.rejects(verifiedDnsAccount(dao, env, resource), /Verify this DNS account/);
        evidence.set("DNS_VALIDATION:pending", JSON.stringify({owner: resource.owner, resourceUpdatedAt: 42,
            buildHash: manifest.buildHash, sourceHash: manifest.sourceHash, runtimeVersion: manifest.runtimeVersion, cleaned: true}));
        assert.ok((await verifiedDnsAccount(dao, env, resource)).service);
        await assert.rejects(verifiedDnsAccount(dao, env, {...resource, updatedAt: 43}), /Verify this DNS account/);
        evidence.set("DNS_VALIDATION:pending", JSON.stringify({owner: resource.owner, resourceUpdatedAt: 42,
            buildHash: "old-build", sourceHash: manifest.sourceHash, runtimeVersion: manifest.runtimeVersion, cleaned: true}));
        await assert.rejects(verifiedDnsAccount(dao, env, resource), /Verify this DNS account/);
    } finally { manifest.verifiedProviders = previous; }
});

test("DCV hosting is unavailable until its domain, zone and supported authentication are configured", async () => {
    const empty = await dcvCapability(async () => null);
    assert.equal(empty.available, false);
    assert.throws(() => assertDcvAvailable(empty, [{type: "dns-auto"}]));
    assert.doesNotThrow(() => assertDcvAvailable(empty, [{type: "dns-self"}]));
    const settings: Record<string, string> = {DCV_AGENT: "dcv.example.com", DCV_ZONES: "a".repeat(32), DCV_API_TOKEN: "synthetic-token"};
    const configured = await dcvCapability(async (name) => settings[name] ?? null);
    assert.equal(configured.available, true);
    assert.deepEqual(configured.missing, []);
    assert.equal(JSON.stringify(configured).includes("synthetic-token"), false);
    delete settings.DCV_API_TOKEN;
    settings.DCV_EMAIL = "admin@example.com";
    settings.DCV_TOKEN = "synthetic-legacy-key";
    assert.equal((await dcvCapability(async (name) => settings[name] ?? null)).available, true);
    settings.DCV_ZONES = "invalid";
    assert.equal((await dcvCapability(async (name) => settings[name] ?? null)).available, false);
});

test("background workflow continues automatic DNS, pauses manual input and preserves superseding cancellation", async () => {
    _resetDaoForTests(); invalidateAll();
    const database = memoryD1();
    const dao = new D1Dao(database as any);
    const env: any = {DB_CF: database, DB_SOURCE: "d1"};
    const {queueOrder, runOrderStep, readOrderWork, CertificateWorkflow} = await import("../src/order-workflow");
    await dao.insertUser({mail: "flow@example.com", flag: "1", is_admin: 0, quota: -1});
    const insert = async (uuid: string, type = "dns-api") => dao.insertApply({uuid, mail: "flow@example.com", sign: null, type: null,
        auto: 1, flag: 1, time: 1, next: 100000, main: "{}", data: "{}", keys: "", cert: "",
        list: JSON.stringify([{name: "example.com", type, flag: 0}])});
    try {
        await insert("automatic");
        await queueOrder(env, "automatic");
        const waiting = await runOrderStep(env, "automatic", async () => {
            await dao.updateApply("automatic", {flag: 2, list: JSON.stringify([{name: "example.com", type: "dns-api", flag: 2, dnsStatus: "waiting_propagation"}])});
            return [];
        });
        assert.equal(waiting!.status, "waiting");
        assert.ok(waiting!.nextRun > Date.now());
        await runOrderStep(env, "automatic", async () => { await dao.updateApply("automatic", {flag: 5}); return []; });
        assert.equal((await readOrderWork(dao, "automatic"))!.status, "complete");
        await insert("manual", "dns-self");
        await queueOrder(env, "manual");
        const manual = await runOrderStep(env, "manual", async () => {
            await dao.updateApply("manual", {flag: 2, list: JSON.stringify([{name: "example.com", type: "dns-self", flag: 2}])}); return [];
        });
        assert.equal(manual!.status, "action_required");
        assert.equal(manual!.nextRun, 0);
        await insert("superseded");
        await queueOrder(env, "superseded");
        const superseded = await runOrderStep(env, "superseded", async () => {
            await queueOrder(env, "superseded", "cancel");
            await dao.updateApply("superseded", {flag: 2}); return [];
        });
        assert.equal(superseded!.intent, "cancel");
        assert.equal(superseded!.status, "queued");
        await runOrderStep(env, "superseded", async () => { throw new Error("Cancellation must win"); });
        assert.equal((await readOrderWork(dao, "superseded"))!.status, "cancelled");
        assert.ok(await dao.getApply("superseded"));
        await insert('early-cancel');
        await queueOrder(env, 'early-cancel');
        const persistent = await (await import('../src/db')).ensureDao(env);
        const originalClaim = persistent.claimConfLease!.bind(persistent);
        let cancelledBeforeStart = false;
        let advances = 0;
        persistent.claimConfLease = async (name, value, expiresAt, now) => {
            const claimed = await originalClaim(name, value, expiresAt, now);
            if (claimed && name === 'ORDER_WORK_LEASE:early-cancel' && !cancelledBeforeStart) {
                cancelledBeforeStart = true;
                await queueOrder(env, 'early-cancel', 'cancel');
            }
            return claimed;
        };
        try {
            const cancelled = await runOrderStep(env, 'early-cancel', async () => { advances++; return []; });
            assert.equal(cancelled!.intent, 'cancel');
            assert.equal(advances, 0);
        } finally { persistent.claimConfLease = originalClaim; }
        await insert("retryable");
        await queueOrder(env, "retryable");
        const retry = await runOrderStep(env, "retryable", async () => { throw new Error("connection timed out"); });
        assert.equal(retry!.status, "waiting");
        assert.equal((await dao.getApply("retryable"))!.flag, 1);
        const saved = new Map<string, any>();
        let alarm = 0;
        const state: any = {storage: {put: async (key: string, value: any) => saved.set(key, value),
            get: async (key: string) => saved.get(key), setAlarm: async (time: number) => { alarm = time; }, deleteAlarm: async () => { alarm = 0; }}};
        const actor = new CertificateWorkflow(state, env);
        const accepted = await actor.fetch(new Request("https://order.internal/start", {method: "POST", body: JSON.stringify({uuid: "automatic"})}));
        assert.equal(accepted.status, 202);
        assert.ok(alarm > 0);
        await actor.alarm();
        assert.equal(alarm, 0);
        await insert('renewal');
        env.AUTOMATION_KEY = Buffer.alloc(32, 7).toString('base64');
        const originalExpiry = Date.now() + 86400000;
        await dao.updateApply('renewal', {flag: 5, cert: 'original-certificate', keys: 'original-private-key', next: originalExpiry});
        await queueOrder(env, 'renewal', 'retry');
        assert.equal((await dao.getConf('ORDER_PREVIOUS:renewal'))!.includes('original-private-key'), false);
        await runOrderStep(env, 'renewal', async () => {
            await dao.updateApply('renewal', {keys: 'unfinished-replacement-key', next: Date.now() + 7 * 86400000});
            throw new Error('Unsupported fixture failure');
        });
        const preserved = (await dao.getApply('renewal'))!;
        assert.equal(preserved.flag, 5);
        assert.equal(preserved.cert, 'original-certificate');
        assert.equal(preserved.keys, 'original-private-key');
        assert.equal(preserved.next, originalExpiry);
        await insert('timeout');
        const timed = await queueOrder(env, 'timeout');
        await dao.upsertConf('ORDER_WORK:timeout', JSON.stringify({...timed, startedAt: Date.now() - 3 * 3600000}), Date.now());
        const paused = await runOrderStep(env, 'timeout', async () => { throw new Error('Timed out work must pause before external requests'); });
        assert.equal(paused!.reason, 'timeout');
        assert.equal(paused!.nextRun, 0);
        await new CertificateWorkflow({storage: {...state.storage, get: async () => { throw new Error('Temporary storage error'); }}} as any, env).alarm();
        assert.ok(alarm > Date.now());
        await insert('cleanup');
        await dao.updateApply('cleanup', {flag: 5, cert: 'issued-certificate', keys: 'issued-private-key',
            list: JSON.stringify([{name: 'example.com', type: 'dns-api', dnsAccountId: 'unavailable-account', flag: 4,
                dnsStatus: 'cleanup_pending', dnsHandle: {id: 'owned-record'}}])});
        await queueOrder(env, 'cleanup');
        const cleaning = await runOrderStep(env, 'cleanup', async () => { throw new Error('Cleanup must not reissue the certificate'); });
        assert.equal(cleaning!.status, 'waiting');
        assert.ok(cleaning!.nextRun > Date.now());
        assert.equal((await dao.getApply('cleanup'))!.flag, 5);
        await dao.updateApply('cleanup', {list: JSON.stringify([{name: 'example.com', type: 'dns-api', flag: 4, dnsStatus: 'cleaned'}])});
        const clean = await runOrderStep(env, 'cleanup', async () => []);
        assert.equal(clean!.status, 'complete');
        assert.equal(clean!.nextRun, 0);
        await dao.updateApply('cleanup', {list: JSON.stringify([{name: 'example.com', type: 'dns-api', flag: 4, dnsStatus: 'cleanup_pending'}])});
        const recovered: string[] = [];
        env.ORDER_WORKFLOW = {idFromName: (name: string) => name,
            get: (name: string) => ({fetch: async () => { recovered.push(name); return Response.json({accepted: true}); }})};
        await (await import('../src/order-workflow')).resumePendingOrders(env);
        assert.equal(recovered.includes('cleanup'), true);
        assert.equal((await dao.getApply('cleanup'))!.flag, 5);
    } finally { _resetDaoForTests(); invalidateAll(); database.close(); }
});