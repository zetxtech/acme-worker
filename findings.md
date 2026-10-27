# Findings

## Background Lifecycle Repair (2026-10-27)
- The submission handler awaited the ACME/DNS state machine. The modify and cancel operations shared a hard-delete branch. The state machine stopped between persisted stages, and the detail page did not poll. These were business-flow defects, not just missing loading messages.
- A transformed PageShell trapped descendant fixed overlays. Body-level portals now cover the entire layout while the short acceptance request is pending; long CA/DNS work never holds that overlay open.
- Worker-native SQLite Durable Object alarms provide durable continuation without another backend or a new cron allocation. The existing D1 stores the work outbox, per-order lease, revision, edits, deployment state and encrypted artifact backup.
- A lease alone does not protect command intent: a cancellation can arrive after the worker reads its revision but before it writes running state. A deterministic regression reproduced the lost cancellation. Conditional Confs updates now refuse stale revisions before starting work.
- Automated DNS waiting, public-resolver failure, provider failure, manual configuration, CA validation, issuance, deployment and cleanup are separate states. Domain flag 4 means verified, not the order-level issuing phase.
- Post-issuance DNS cleanup must remain a scheduled stage; finishing certificate issuance cannot stop pending cleanup. Its retry never invalidates or reissues an already-issued certificate.
- Final lifecycle suite: 40 passed, zero skipped, including actual local workerd alarms and SSH/SFTP plus synthetic-API desktop/mobile browser flows. Publisher binding/network-retry checks: 6 passed. Real provider issuance is not implied by fixture success.
- Production b60ce2aa-9568-486b-bfc1-f206f16724d8 is verified: current entry matches the build, homepage/assets 200, database healthy, anonymous apply 401, workflow binding active, original D1 and 31 DNS services plus AUTOMATION_KEY retained. The original request remains in real DNS propagation waiting; it is not reported as issued.
- Local proxy/TLS failures blocked deployment verification. IPv4-first/direct Node networking worked; environment changes were scoped and restored. Verification still required a successful remote Go runtime check before main upload.

## Earlier Findings

- The current application uses acme-client with a persistent order state machine.
- dns-auto means Cloudflare delegation, not a generic DNS API account.
- CA choices are static and default to Google even without configured credentials.
- Existing edge targets support EdgeOne and ESA; SSH and deployment hooks are missing.
- Workers supports outbound TCP, but native Node SSH dependencies must be bundle- and runtime-tested.
- Production D1 is workacme-db, bound as DB_CF. No schema replacement is permitted.
- Existing ownership helpers are currentUser/requireAdmin in src/middleware/admin.ts.
- Both /apply/ in src/index.ts and /api/v1/orders in src/routes/openapi.ts create orders and must enforce the same policy.
- Confs DAO supports listConfs/getConf/upsertConf/deleteConf, allowing per-resource storage without replacing the schema.
- The existing edge module has Tencent TC3 and Alibaba ACS3 signing helpers suitable for DNS API reuse.
- The user explicitly requested planning first and then execution by the Work agent. No additional executors or private-network agent are authorized.
- User corrected the scope: DNS accounts must track lego/acme-go scale (or equivalent), with a repeatable update workflow. Do not present three hard-coded adapters as adequate.
- Official lego v5.5.2 has 223 provider package directories and requires Go 1.26. Local Go v4.35.2 all-provider registry is 125,783,961 bytes; representative 7-provider selected build is 31,460,929 bytes.
- Workerd successfully ran Go js/wasm with the Go runtime shim, constructed the lego Cloudflare adapter from fixture environment values, and Go net/http reached example.com (HTTP 200).
- Unmodified lego Cloudflare `Present` fails before its API call because shared `dns01.FindZoneByFqdn` performs raw UDP SOA queries. Worker-compatible implementation must replace zone discovery with bounded DoH.
- lego Cloudflare adapter retains record IDs in instance memory; do not claim durable separate Present/CleanUp RPCs. Full issue/validate/cleanup in a single shard operation or another durable lifecycle is required.
- Cloudflare Workers supports internal service bindings; this may permit multiple size-bounded provider shard Workers while keeping every service inside the Worker platform.
- ssh2 can bundle in Wrangler after disabling its optional CPU-feature native addon and defining the directory constant used by an unused system-agent path. No SSH cryptography was reimplemented.
- Actual workerd supports the tested ECDH/key parsing/SSH path. ssh2 AES-GCM decryption hit "No auth tag provided"; AES-CTR plus SHA256 negotiated successfully with GitHub's public SSH endpoint and verified official host fingerprints.
- An isolated workerd probe also authenticated with password and a generated ECDSA private key against a temporary Windows in-memory SSH/SFTP fixture. It transferred real SFTP files, enforced 0600, recovered a simulated Nginx validation failure and rejected a wrong host fingerprint. This is local protocol integration, not live production SSH deployment.
- Manual TXT comparison previously compared quoted DoH strings literally. Exact TXT parsing fixes this, and persisted CA polling must not recheck already validated/cleaned domains or resubmit an already-submitted challenge.
- The canonical deployable SQL template is schema.set.sql; the legacy schema.sql has a trailing comma and is not used by new memory-D1 tests.
- Traefik acme.json mode requires explicit external-writer shutdown acknowledgement, a remote exclusive directory lock and a before-swap content check. Other resolver accounts and unrelated certificates are preserved.
- Actual workerd fixture verification also passed PFX generation/parse, Traefik dynamic YAML preservation, acme.json 0600, foreign-lock preservation and before-swap concurrent update refusal. Dynamic PEM locks the shared dynamic configuration file, not only a certificate filename.
- Personal EdgeOne deployment uses exact TLS host coverage: a wildcard does not cover the apex or multiple nested labels. The optional filter does not change legacy global target matching.
- Failed DNS cleanup must retry even when no legacy DCV zone is configured. Cleanup uses an execution lease, exact owned handles, already-missing idempotency and compare-and-swap list updates.
- Browser inspection found the first-open resource Form lost provider/enabled defaults before Modal mount; forceRender fixed it. A mobile screenshot also revealed internal Segmented clipping despite no document overflow; compact labels, full Tooltips and internal bounds assertions fixed it. The updated screenshot was visually confirmed.
- Root tsconfig has no include/exclude boundary and uses hono/jsx while also sweeping React frontend files. A sampling run reported 2186 root diagnostics; added Worker module sampling was zero. Frontend's own typecheck/build passes; whole-repository tsc is not a passing gate here and was not represented as clean.
- npm audit still reports 65 dependency-tree advisories (including pre-existing tooling); the four new package names checked did not have matching audit entries. No broad dependency upgrade or audit-fix operation was performed.
- Final real local health: frontend 200, anonymous /capabilities 401, local D1 ready=true, initialized=false. No local administrator or production secrets were created/read.