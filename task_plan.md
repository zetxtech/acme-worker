# Worker Certificate Workflow Implementation Plan

## Current Work: Form Borders And Cloud Diagnostics (2026-10-28)
- Completed and released as 7a7fa608-5d49-4593-be20-82e987b5448e. Full 48-test suite, production build, browser style/hover/mobile checks and live non-mutating health/binding/credential readback passed. Tests do not claim real cloud certificate deployment success. Original artifact-check order absent on readback; no recreation performed. Source ready for final commit/push.
- Reproduce nested AntD input focus/background painting over the outer border; fix nested decoration rather than increasing arbitrary border width.
- System settings: responsive label/control/action rows, unknown loading state, placeholders for absent/configured credentials rather than configuration badges; retain safe secret editing and save semantics.
- Cloud operations: preserve sanitized method, endpoint, action, HTTP status and bounded response body across signer, persistence, API and hover detail. Never expose signed authorization, private keys, query secrets or raw credentials.
- Verify mainland/international ESA and EdgeOne endpoints against official references. Make account site explicit and backward-compatible without silently trying credentials at other sites.
- Focused tests, browser focus/layout/hover assertions, full regression/build, verified release and authorized commit/push. No Tasks, WSL, external backend or production certificate mutations.

## Current Work: Certificate Management Cleanup (2026-10-28)
- Released: 3b405e53-aa9b-48c1-b177-84ee6e065efb. All implementation and acceptance gates passed (45/45 full tests, frontend build, actual Worker release, live health/credential/artifact verification). Existing external monitor migration was refused on destination mismatch and left unchanged; the old alias preserves its operation. Real cloud-account writes remain untested without a supplied target. Source ready for final commit/push.
- Separate permanent record deletion from cancellation/revocation; require exact ID and ownership, remove only owned challenge records and order-local state under the execution lock.
- Simplify operational surfaces: one fixed authenticated cron endpoint; deployment targets replace global edge targets; no manual trigger/job switches. Preserve the existing scheduler credential while migrating its monitor URL.
- Cloud deployment: verify official ESA upload/replacement semantics and Tencent SSL certificate update/link behavior before implementing; make EdgeOne host binding optional.
- UI: stable modal scroll, no empty/loading table horizontal bars, constrained application width, disabled IP-incompatible switches, always-open account panels, DNS validation account naming, confirmed domains not expandable, horizontal icon/text alignment and order navigation placement.
- Gates: focused regression after each slice, complete browser/runtime suite, build/dry-run, live health and signed-artifact preservation, commit and authorized push. No WSL or VS Code Tasks.

## Current Work: Background Certificate Lifecycle (2026-10-27)
- Implemented: order acceptance independent of CA/DNS latency; durable server-side continuation and retries; request identity preserved during edits; detail/list synchronization without keeping the tab open; post-issuance cleanup continuation.
- Final acceptance: 40/40 lifecycle tests with zero skipped, including actual workerd alarms and SSH/SFTP and browser scenarios; production frontend build and complete Worker binding/bundle checks passed. Publisher retry/binding tests passed 6/6.
- Latest production release 1b4a562a-5062-4e8c-a74a-0917b3be2673 fixes the remaining real-world Google DoH TXT format incompatibility. The original request is now issued and complete, with actual certificate/key/hostname/validity checks passing. The backend-only follow-up passed 38 relevant tests and real Cloudflare response validation. Temporary probes are absent. The owner created the intended GitHub repository and it is now reachable for source delivery.
- Regression gates: submission returns 202 without external calls; modify never deletes; owner-only in-place update; automatic DNS needs no manual process/verify buttons; manual DNS/HTTP retain actionable instructions; UI polls without starting work; portal overlays cover the entire layout; sections retain spacing and empty deployments stay compact.
- Preserve D1, existing credentials, precise DNS cleanup, service bindings, authorization, and Worker-only/free-plan constraints. Do not claim background completion from a pending request or a browser polling loop.

## Status And Handoff
- Latest release: Worker-native lego v5.5.2 expansion deployed on 2026-10-22, with 31 private execution shards bound to the acme main Worker (version 97c95ead-32e9-46e7-bdbf-1db24ec17727). Source catalog: 223; compiled: 212; explicitly incompatible: 11. Real account/provider issuance remains subject to account verification, not implied by successful build/deployment. The earlier phase reports below describe historical local acceptance.
- Phase 1: capability endpoint, both creation gates, account URL reuse and UI implemented. Focused and actual Hono creation-route tests plus browser checks passed. Real CA account/product issuance is not claimed.
- Phase 2: three real DNS implementations, encrypted resources, ownership/grants/scope, selection enforcement, persisted polling/backoff and exact cleanup implemented. Provider requests were mocked; real Hono routes and D1 semantics were tested with process-memory SQLite. Live provider credentials were unavailable.
- Phase 3: SSH/SFTP, authenticated/HMAC hooks, Nginx recovery, Traefik PEM/acme.json and per-order deployment implemented. Public GitHub host pin/SSH handshake passed. Actual workerd password/key authentication, SFTP, PEM/PFX, permissions, rollback, merge preservation, locks and concurrent-change refusal passed against a temporary Windows protocol fixture. Real user hosts, service reloads and provider deployments were not tested.
- Phase 4: authenticated Resources, Apply and Order UI implemented. Independent Windows headless Chrome passed desktop/mobile flow checks with explicit synthetic API fixtures. Resource first-open defaults and mobile segmented-label clipping were found and fixed. Updated mobile screenshots were read by the vision tool and confirmed complete labels without overlap/cutoff.
- Phase 5: final focused file passed 27/27 tests with 0 skipped, including both runtime/UI gates. Frontend tsc + Vite build, actual main/SSH Wrangler dry-runs and diff whitespace check passed. Final main bundle: 4450.13 KiB / gzip 852.12 KiB. Root all-repository tsc remains nonzero; added Worker modules had zero sampled diagnostics, not a claim that the whole repository is clean.
- Starting slice was src/capabilities.ts and three passing tests; all initial dirty worktree changes were preserved.
- Existing dirty worktree contains earlier automation, edge deployment, database migration and UI work. Preserve it.
- The user has authorized implementation, but no unsolicited account registration, paid resources, new backend or database replacement.

## Hard Constraints
- Implement inside the existing Cloudflare Worker. No client daemon, external execution agent, WSL, self-hosted backend or Containers dependency.
- Windows native tooling only. Do not invoke WSL or read Linux source copies.
- Keep D1 workacme-db and its existing DB_CF binding. Never replace or delete databases.
- Preserve existing API compatibility, manual TXT, HTTP-01, legacy DCV delegation, EdgeOne/ESA and Uptimer triggers.
- No secret values in responses, logs, fixtures, plan files, command output or URLs.
- Source identifiers and comments are English. Follow existing UI language and visual system; do not redesign unrelated pages.
- Ordinary public Workers cannot directly reach arbitrary RFC1918 hosts. Implement outbound SSH for reachable hosts. Clearly reject unsupported connectivity instead of introducing another service or claiming private access works.

## Product Flow
1. User selects Apply and creates a new certificate request.
2. Enter domains, wildcard/root coverage, CA, key algorithm and renewal policy.
3. Choose validation for each domain: manual TXT, Cloudflare CNAME delegation, or a saved DNS API account.
4. Choose zero or more saved deployment targets. A certificate can use multiple target types and multiple hosts at once.
5. Review and submit. Manual challenges pause with exact instructions; automated challenges proceed when DNS propagation is confirmed.
6. After issuance and every renewal, deploy the new certificate version to selected targets. Track issuance and each target separately.
7. Show retry actions for failed targets without reissuing a certificate or rerunning successful unchanged targets.

## Architecture And Storage
- Keep acme-client and the current persistent order state machine. Do not replace working ACME protocol code with Go/Wasm.
- Add small DNS and deployment modules with real implementations and testable interfaces; reuse existing Tencent/Alibaba WebCrypto signing helpers.
- Use the existing Confs DAO for independent per-resource records, not one read-modify-write JSON catalog shared by all users.
- Suggested keys: DNS_ACCOUNT:<id>, DEPLOY_TARGET:<id>, ORDER_DEPLOYMENT:<orderId>, DEPLOY_STATE:<orderId>:<targetId>.
- Persist order target selection so renewal reuses it. Do not rely on temporary browser state.
- Records include owner, allowed domain scopes, enabled state and timestamps. Users may access their own resources; administrator-shared resources require explicit grants.
- Encrypt credential-bearing data with AES-GCM using a Worker secret AUTOMATION_KEY. Use a random nonce and authenticated resource identity. Return masked views only.
- Missing encryption configuration must disable resource creation with an actionable administrator message; never store secrets in clear text as a fallback.
- Validate inputs, maximum sizes/counts, ownership and domain scope on both web and API routes. Recheck authorization before performing side effects.
- Prevent cross-user order/target access and resource deletion that silently breaks active renewals.

## Phase 1: CA Capabilities And Enforcement
- Extend the tested CA metadata and connect it to a backend capabilities endpoint, application UI and both creation paths (/apply/ and /api/v1/orders).
- Distinguish disabled, missing configuration, available and incompatible certificate type. Do not treat a boolean switch alone as readiness.
- Let us Encrypt is free and does not need EAB. Google Public CA is free but requires project/API/EAB/account setup. ZeroSSL ACME has a free path requiring EAB.
- SSL.com free DV is limited to the explicitly supported single-domain product. Do not label all SSL.com products free or claim all account paths are tested.
- Store/reuse the ACME account key and account registration state correctly; do not repeatedly consume a one-use EAB for a new key.
- Default to an available CA rather than always selecting Google.
- Unavailable options stay visible but disabled. Administrators see exact missing configuration and a settings link. Normal users see a contact-administrator message. Display cost/product information separately from readiness.
- Backend validation is authoritative; bypassing the disabled UI must not create an invalid order.

## Phase 2: DNS Accounts And Challenge Lifecycle
- Initial real providers: Cloudflare API Token, Tencent Cloud DNSPod SecretId/SecretKey, Alibaba Cloud DNS AccessKeyId/AccessKeySecret.
- Provide account create/list/edit/delete and connection/zone permission tests with masked secrets and explicit DNS zone scope.
- DNS provider interface: validate credentials/zone, present exact TXT, return record handles, query propagation, cleanup owned record handles.
- Discover the correct authoritative zone; do not assume the last two labels form a registered domain. Reject credentials outside the permitted scope.
- Manual TXT keeps current pause/verify workflow and states that unattended renewal requires another method.
- Delegated mode displays _acme-challenge.<source> CNAME <generated target>. Target is stable across renewals and bound to tenant/domain.
- Preserve the existing generated legacy delegation target for existing orders. Permit an explicitly configured target pattern under the administrator-owned DCV zone, not an arbitrary DNS destination.
- Tencent/Alibaba direct mode manages TXT in the user's selected authoritative DNS account, without requiring CNAME or moving nameservers.
- Use async persisted stages/backoff for propagation; do not block a Worker in long sleeps. Check TXT values, following supported delegation, before notifying the CA.
- Wildcard and apex authorizations may share a TXT name: preserve all simultaneous values. Cleanup only this order's recorded IDs/values, never an entire RRset.
- Remove the hardcoded original-author DCV domain from cleanup. Avoid deleting unrelated records.
- Save provider failures and propagation-wait states for the order UI, and make recoverable failures retryable.

## Phase 3: Worker-Native Deployment
- Reuse existing EdgeOne and ESA implementations and existing idempotency semantics. Explicit order selection must not silently broaden target access.
- Add generic HTTPS certificate hooks: configured URL, method, masked auth, timeout, certificate/key payload, event/version identifier, optional HMAC signing with timestamp. Never forward credentials through redirects.
- Protect hooks from SSRF using validated destinations/redirect policy, administrator restrictions where necessary, and response size/time limits.
- Add outbound SSH/SFTP using a proven SSH library adapted to Worker sockets. Do not implement SSH cryptography from scratch.
- Verify library loading, key parsing, connection and real Worker bundling/runtime compatibility. Do not add a visible feature whose implementation is a placeholder.
- SSH configuration: reachable host, port, username, password or key/passphrase, mandatory host-key fingerprint verification, paths, output format, permissions, deploy commands and bounded timeouts.
- Support PEM/fullchain/private-key files and the existing PFX generation facilities. Additional formats only when genuinely implemented.
- Nginx preset: stage files, preserve backup, validate configuration, atomic activation and reload; surface and recover failed activation.
- Traefik preset: support PEM plus dynamic TLS file configuration as the safe default. Also implement explicitly requested acme.json handling with resolver selection, merge preservation, encoding, owner-only permissions, lock/concurrency policy and safe replacement; never overwrite unrelated accounts/certificates.
- Deployment state is per order, target and artifact/config version. Record success/failure and attempts independently; retry only failed or changed targets.
- Wire issuance, renewals, scheduled retries, manual push and order status to this module. Legacy globally configured edge targets must retain their existing behavior without unexpectedly deploying new selections everywhere.

## Phase 4: UI And API Integration
- Add an authenticated resources page for DNS accounts and deployment targets. Reuse existing Ant Design, icons, spacing and theme.
- Distinguish account name/provider/zone scopes from secret fields. Blank secrets on edit mean retain existing values; deletion/rotation is explicit.
- Apply UI must actually expose all three validation modes, per-domain DNS account selection, CA capability Popovers and multi-target selection before submission.
- The order page must show manual records, generated CNAME target, DNS automation progress and per-target deployment outcomes with retry controls.
- Existing admin automation page remains usable; add links or reuse it where appropriate rather than duplicating management paths.
- API clients can select validation accounts and target IDs under the same backend ownership/CA restrictions as the browser.
- Ensure disabled buttons still have a focusable wrapper for explanatory Popovers, and support keyboard/touch access.
- Keep text readable on mobile. No decorative redesign, new landing page or marketing copy.

## Phase 5: Acceptance And Release Gates
- Reuse tests/certificate-workflow.test.ts and add focused tests rather than many fragmented test files.
- Required tests: CA missing/configured/disabled and product incompatibility; ownership/scope; encrypted storage roundtrip/tamper; direct/delegated/manual selection; TXT coexistence and precise cleanup; provider payload/signature handling; failed target retry/idempotency; hook validation; Traefik merge preservation; SSH host verification/failure handling.
- Mock remote provider calls for deterministic tests. Do not describe mocked tests as live integration validation.
- Run focused tests immediately after each substantive slice, then frontend build and actual Wrangler dry-run bundle.
- Add a Worker runtime smoke check for SSH module initialization and supported cryptographic paths, not just a Node-only test.
- Start the existing local Worker/frontend environment on an unused port using a VS Code task; verify actual UI desktop/mobile in Playwright and inspect screenshots. No production credentials in browser mock fixtures.
- Check final diff, preserve unrelated modifications and document actual limitations.
- Only deploy after all relevant gates pass. Do not register paid CA products or change DNS/SSH targets without supplied authorization/credentials.
- Missing real DNS/SSH target credentials block live tests, not implementation. Report precisely which tests are offline and which are live.

## Authoritative References Already Checked
- JS/TS full system Certd has DNS/deployment plugins and recent releases, but is not a Worker drop-in and its licensing must not be ignored.
- acme-client exposes challenge handling; the installed 5.4.0 protocol library does not include a lego-style provider catalog.
- Workers supports outbound TCP and WebAssembly. Go compilation support alone does not make lego's runtime dependencies portable.
- Google Public CA: https://cloud.google.com/certificate-manager/docs/public-ca-tutorial
- ZeroSSL: https://zerossl.com/documentation/acme
- SSL.com free DV: https://www.ssl.com/products/website-security/tls-ssl/single-domain/free-dv/
- Workers TCP: https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/

## Stop Conditions
- Release remains blocked on real DNS/CA/owned-target acceptance and production quota evaluation. Do not infer deployment authorization from successful local tests.
- Local frontend remains at http://127.0.0.1:5194/ and main Worker at http://127.0.0.1:8794/. The local database is ready, but the app is uninitialized; no admin account was created. Synthetic browser fixtures were ephemeral, not application backends.
- Do not silently weaken host verification, encryption, tenancy or Worker-only requirements to make a build pass.
- If a hard runtime blocker remains after a minimal tested integration probe, report the exact evidence and retain completed working slices. Never claim the entire feature is complete when it is not.

## DNS Provider Ecosystem Expansion
- User explicitly requires lego/acme-go-scale DNS account coverage or similar richness, plus a convenient upstream update path; three hand-written providers are not sufficient.
- Official lego v5.5.2 source tree has 223 DNS provider implementation packages. Its module requires Go 1.26; local Windows Go is 1.25.3. Official docs describe 200+ providers.
- Local Go v4.35.2 full provider registry compiles to a 125,783,961-byte Go/WASM file, which exceeds Cloudflare Worker's 64 MiB script bundle limit. A representative 7-provider set compiles to about 31 MiB.
- A local workerd runtime probe verified Go WASM, syscall/js, `os.Setenv`, a lego Cloudflare provider constructor, and Go net/http (HTTP 200). The same probe showed the unchanged lego `Present` path fails `dns01.FindZoneByFqdn` because it sends raw UDP and gets `Connection reset by peer`; Workers cannot use arbitrary UDP.
- Cloudflare service bindings are internal Worker-to-Worker calls with no public backend. Evaluate generated size-bounded provider shards, all hosted as Worker scripts and only reachable through bindings from the main Worker.
- Required lifecycle: do not split a lego provider's stateful `Present` and `CleanUp` across stateless calls. Implement the full ACME issuance operation inside one shard call or a durable, explicitly tested lifecycle that guarantees provider state survives challenge propagation/validation/cleanup.
- Required compatibility patch: replace lego zone-discovery/raw UDP dependency with bounded DoH through Worker Fetch. Keep propagation verification via DoH. Source patch must be pinned, deterministic, tested against lego updates, and fail loudly when upstream source context changes.
- Required update workflow: pin upstream lego tag; Windows-runnable command refreshes the supported-provider catalog, per-provider credential/config metadata from upstream, generated Go imports/shard grouping, and a human-readable additions/removals report. Generated catalog may only mark an adapter “supported” if it is included in a built shard and passes adapter/runtime tests.
- All provider groups must remain below 64 MiB uncompressed per deployed Worker with a safety margin; document total Worker count and service bindings. Providers that require unsupported UDP, filesystem, exec, instance identity, or runtime syscalls must be reported as incompatible/disabled, never exposed as ready.
- Required tests: deterministic sync/generation; provider credential schema parsing; selected-provider instantiate and Present/DoH/CleanUp lifecycle using mock API and DoH; credential non-logging; all shard bundle size gates; workerd execution with no Go `os/user` panic; service binding route selection and failure handling; regressions for the existing native Cloudflare/DNSPod/Alibaba adapters.
- Exploratory source only: `tests/lego-wasm-probe/` currently proves full registry 125,783,961 bytes and selected 7-provider 31,460,929 bytes in workerd. A test-only Go shim fills missing `process.getuid`; `Present` currently fails only at UDP SOA discovery. Remove generated `.wasm` files and `.wrangler` probe state before finalizing; do not add binary artifacts to git.