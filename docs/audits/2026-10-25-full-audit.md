# AISO repository audit — 25 October 2026

Repository: `YNWAforever/aiso` (private). Baseline `096fa0411ea6f1000da48b08eabb8d463d29e03e`, branch `codex/full-audit-p0-cleanup`. Date uses America/New_York; execution logs use UTC (26 October). This report audits the checkout, not a certified production deployment. No production writes, scans, charges, emails, migrations, secret rotations or deployments were performed.

## Prioritized findings

P0 means an immediate security boundary requiring containment; P1 is significant auth/data/billing/privacy or core-workflow failure; P2 is bounded maintenance/reliability work. P0 A01 is a deployable-artifact risk: deployed configuration and legacy schema remain unknown. No current production compromise is claimed.

| ID | Priority | Finding | File paths | Disposition |
|---|---|---|---|---|
| A01 | P0 | Unauthenticated legacy n8n SQL and paid-provider boundary | `n8n/aiso-scan-webhook.json:11,80,159` · `app/api/scan/route.ts:465` · `n8n/configure-credentials.sh` | Code fix verified locally; live cutover outstanding |
| A02 | P1 | Database credentials can survive redaction in logged error causes | `lib/db.ts:64` · `app/api/fix/route.ts:37` · `app/api/stripe/webhook/route.ts:223` | Verified synthetic reproduction; open |
| A03 | P1 | Repeated checkout can create duplicate subscriptions | `app/api/stripe/checkout/route.ts:35` · `supabase/migrations/024_stripe_lifecycle_integrity.sql:222` | Code-only; open |
| A04 | P1 | Concurrent reciprocal removals can empty an account | `lib/members/store.ts:329` | Code-only concurrency analysis; open |
| A05 | P1 | Invitation join trusts email without verifying mailbox ownership | `app/api/webhooks/neon/route.ts:185` · `lib/auth.ts:17` | Configuration-dependent; exploit not verified |
| A06 | P1 | Rejected authenticated scans can spend quota without a result | `app/api/scan/route.ts:189,213,231` | Code-only; open |
| A07 | P1 | External webhook HTTP failures leave pending work without recovery | `app/api/scan/route.ts:426,475` · `lib/agents/generate.ts:72` | Code-only; open |
| A08 | P1 | n8n summary writer has no matching migration contract | `n8n/aiso-scan-webhook.json:159` · `supabase/migrations/001_phase1.sql:1` | Code-only schema mismatch; open |
| A09 | P1 | Default worker deployment targets legacy schedules | `cloudflare/cron-worker/package.json:6` · `cloudflare/cron-worker/wrangler.jsonc` · `cloudflare/aiso-worker/wrangler.jsonc` | Code-only; open |
| A10 | P1 | Provider error bodies can expose prompt/customer data in logs | `lib/openrouter.ts:121` | Code-only; open |
| A11 | P1 | Rewrite tool reports original input as successful output on malformed model JSON | `app/api/fix/rewrite-chunks/route.ts:53` | Code-only; open |
| A12 | P2 | Public funnel body limit is checked after buffering | `app/api/funnel-events/route.ts:19` | Code-only; open |
| A13 | P2 | Native Node seed command cannot resolve its imports | `scripts/seed-packs.ts:1` | Verified import-resolution failure; open |
| A14 | P2 | Unused direct production dependencies | `package.json:37` | Verified local import analysis; open |
| A15 | P2 | Seven retained components are unreachable | `__tests__/components/orphaned-components.test.ts:23` · `components/pulse/` · `components/dashboard/PulseTabs.tsx` | Verified inventory; retained |
| A16 | P2 | Malformed request bodies escape normal tool and checkout errors | `app/api/stripe/checkout/route.ts:17` · `app/api/fix/rewrite-chunks/route.ts:25` | Code-only; open |

## What the PR fixes

A01: dedicated n8n Header Auth and `N8N_SCAN_WEBHOOK_SECRET` (minimum 32 characters), authenticated sender, redirect refusal, PostgreSQL bound parameter arrays for caller IDs and model text, matching client constraint on scan updates, and no raw webhook exception logging. The configurator installs the reviewed local graph and validates every response before activation; private temporary files hold credentials and headers. The old export lookup's unused `clients.email` selection is removed. Scripts are exercised with fake curl, not live n8n.

This is a local code repair. Existing deployed n8n workflows remain unchanged until an operator performs a controlled cutover. Keep the optional webhook off until its summary storage contract (A08) is resolved or verified on the intended legacy database. Do not restore the unauthenticated export as rollback.

Other findings remain open because this PR is limited to safe P0 remediation. No dependency deletion, feature retirement, auth policy change, billing migration or schema extension is included.

## Decisions versus engineering backlog

Product/release decisions: existing-subscriber checkout/upgrade policy (A03); verified-identity invitation lifecycle (A05); webhook retry/idempotency and failed-generation allowance policy (A07/A11); whether unused n8n enrichment should survive and where it is stored (A08); retirement/reuse of legacy UI (A15); explicit approval of any additional worker schedule (A09).

Engineering work that does not require new product scope: sanitize database/provider diagnostics (A02/A10), serialize membership mutations (A04), refund refused scans (A06), correct worker config selection (A09), bounded public body reads (A12), seed command imports (A13), unused dependency removal (A14), and request validation (A16). These are deferred, not blocked on product decisions.

Operational follow-up: CLAUDE.md documents a historical n8n bearer token in Git history with no expiry and rotation still owed. The token was not printed or tested, and present validity was not established. Confirm revocation/rotation in the owning service; changing HEAD cannot revoke a token. Persistent migration and deployment state in architecture documents is dated evidence and was not treated as current truth.

## Coverage and limits

The tracked app contains 95 route handlers, 171 app files, and 46 script files; route inventory and guards were mapped across public scan/claim/results, auth/membership/admin, billing, reports, client feature services, Pulse, jobs, sources/work items/review/delivery/outcomes, external requests and deployment tooling. This is risk-directed source review, not a claim that every handler or UI action was executed.

Inspected safeguards include tagged parameterized Neon queries, application account predicates, upstream session revalidation and deactivated-member rejection, admin gates, signed/revocable public reports, single-use scan claims, DNS-pinned SSRF controls with redirect checks, fail-closed cron secrets, and Stripe signature/canonical-subscription/lease handling. BYPASSRLS and account-blind cron selection are documented design choices, not automatic findings. Supabase-era migration directory names and the empty auth shim are deliberate harness dependencies.

Read-only live retrieval returned HTTP 200 for the public English homepage and login page. Login offers Google and a one-time magic link. No sign-in occurred; public page retrieval does not verify auth settings, UI interactions, scan persistence, billing, n8n, database binding or equivalence with this commit. Live deployment SHA is unknown. No performance percentile or browser-accessibility result is asserted.

## Verification

- Baseline: lint and typecheck passed. Unit suite: 461/474 files passed, 6,473/6,499 tests passed, 26 failures in 13 files plus one unhandled error. Failures involve blocked child processes/local TCP/UDP ports; some downstream assertions see empty subprocess output.
- Post-change full unit run: 463/476 files passed, 6,493/6,519 tests passed; the same 26 baseline failures and one unhandled error remain. This is not a full green suite.
- P0 RED/GREEN: initial sender/export tests failed on missing authorization, missing receiver auth, SQL interpolation and missing-secret dispatch; repaired versions passed. Script tests first failed against unsafe activation/response behavior and then passed with fake-curl provisioning.
- Worker suite: 11/11 passed. Text audit passed. Final targeted security/scan/deployment selection: 81/81 tests across five files passed. Lint, typecheck, text audit and diff checks passed. Independent review found no Critical/Important regression; its three-file security selection passed 45/45 tests.
- Build: attempted Turbopack twice and webpack once. Turbopack cannot bind its transform worker port (EPERM); webpack cannot read child TypeScript --showConfig output. No successful build is claimed.
- Neon integration and authenticated browser journeys were not run: no approved disposable target/session was established. No persistent database credential was probed or changed.
- npm advisory lookup was rejected by automatic approval review because it sends this private repository's dependency metadata to an external registry without established authorization. Local import analysis is complete; vulnerability status is unverified. No alternative route was used to send that metadata.

The 13 baseline failing files: `api/auth-response-transport.test.ts`, `ci/disposable-role-authorization.test.ts`, `config/playwright-projects.test.ts`, `config/vitest-discovery.test.ts`, `db/client-report-migration.test.ts`, `lib/public-url.test.ts`, `readiness/dns.test.ts`, `scripts/check-candidate.test.mjs`, `scripts/neon-wrapper.test.ts`, `scripts/schema-cli.test.mjs`, `scripts/text-audit.test.ts`, `scripts/verify-db-connection.test.ts`, and `work-items/migration.test.ts`, all under `__tests__/`.

## Remediation tasks and acceptance

All tasks inherit the corresponding finding ID. A01 is the first containment task; it has no product-feature dependency. A08 must be resolved or its actual legacy schema verified before optional enrichment activation. A03/A05/A07/A11/A15 require the stated decisions before their implementation. Other engineering tasks are independent; none depends on a product-policy decision merely to investigate.

### A01 — Unauthenticated legacy n8n SQL and paid-provider boundary

Evidence: The retained export accepted unauthenticated POSTs, interpolated caller clientId/scanId into SQL, and could start a paid model call. Against the export-assumed schema, an injected UUID plus OR TRUE widened reads/writes to two synthetic records. Current migration schema lacks summary columns, so actual database exploitation and live deployment are unverified.

Action: Require dedicated Header Auth; bind IDs and summary as PostgreSQL parameters; constrain update to matching scan/client; refuse unauthenticated app dispatch and redirects; make scripts fail closed.

Decision: No product decision. Operator must update/deactivate old deployed copies, configure matching secret, and verify target schema.

Acceptance: New export-expression/PGlite, sender, and fake-curl script tests; anonymous/wrong-key n8n acceptance still requires deployed validation.

### A02 — Database credentials can survive redaction in logged error causes

Evidence: verifyBinding redacts the wrapper message but retains the original error cause. Node formatting recursively prints that cause; driver failures can contain the connection URI/password. Other routes also log raw database errors. Synthetic driver failure exposed password in util.format(error), although error.message was redacted.

Action: Replace unsafe causes/logging with allowlisted diagnostic fields; inspect formatted errors across binding and post-binding failures.

Decision: Engineering fix; separately decide log retention/access and rotate any credentials actually found in retained logs.

Acceptance: Assert formatted/serialized errors and route logs exclude synthetic URI passwords, causes and driver sourceError.

### A03 — Repeated checkout can create duplicate subscriptions

Evidence: Checkout always creates a new subscription using customer_email without existing-subscription policy, per-account serialization or idempotency. Later checkout events overwrite the account sole subscription/customer pointer; an earlier paid subscription can continue billing outside the reachable portal relationship.

Action: Define existing-subscriber behavior, then serialize/idempotently create checkout sessions and reconcile existing duplicates.

Decision: Product/billing: existing customers upgrade through portal or may purchase another subscription?

Acceptance: Concurrent/replayed checkout and lifecycle event tests must establish one intended active billing relationship without orphaning a previous one.

### A04 — Concurrent reciprocal removals can empty an account

Evidence: Two active members can each read an active actor and update the other profile in concurrent statements. Distinct target row locks do not serialize account membership, defeating the documented guarantee that self-removal prevention keeps a member active. Existing tests cover serial calls.

Action: Lock the account before re-reading actor authorization and applying membership changes in the same transaction.

Decision: Engineering fix; no product expansion.

Acceptance: Two independent concurrent sessions removing each other must leave at least one active member, and deactivate-vs-restore must be deterministic.

### A05 — Invitation join trusts email without verifying mailbox ownership

Evidence: Webhook verification looks up Neon user id/email, then provisioning consumes an invitation for that address. No emailVerified check is present. If hosted Auth permits an unverified password registration/session, the invited address could be registered without mailbox proof. Hosted signup configuration was not inspected.

Action: Inspect hosted signup/session policy; provision invited membership only after verified identity through an appropriate verified event/session path.

Decision: Auth policy and lifecycle: defer invitation consumption without stranding legitimate user.created signups.

Acceptance: Unverified signup must not consume invitation or gain account access; verified magic-link/Google signup and delayed verification must still provision exactly once.

### A06 — Rejected authenticated scans can spend quota without a result

Evidence: PublicUrlError returns directly after quota consumption, bypassing the existing refuse() refund helper. Private-address rejection, redirect limit and response-size rejection can exhaust Basic monthly scans despite no persisted scan.

Action: Route post-quota network refusal through the refund helper and review failed insert refunds.

Decision: Engineering fix.

Acceptance: Blocked DNS, excessive redirects and oversized response preserve usage; saved successful scan consumes one unit.

### A07 — External webhook HTTP failures leave pending work without recovery

Evidence: Both client and global n8n dispatch await fetch but ignore Response.ok. A 401/500 is treated as a completed dispatch; client Improve can remain pending and native recovery refuses configured-webhook clients.

Action: Record dispatch failure on non-2xx with a user/operator-visible recovery path.

Decision: Retry/idempotency policy: a retry must not duplicate downstream paid work.

Acceptance: 401/429/500/network failures produce observable durable states; explicit retry is bounded and duplicate-safe.

### A08 — n8n summary writer has no matching migration contract

Evidence: The export updates scans.ai_summary and scans.updated_at, neither of which is created by the tracked migrations; no app/lib reader uses ai_summary. continueOnFail can obscure failure after a paid provider call. The original lookup also selected nonexistent clients.email; this unused selection is removed in the P0 fix.

Action: Choose whether to retire this unused enrichment or define its persisted contract and reader; validate against a migration-built database before activation.

Decision: Product/integration decision. No new summary fields or migrations are invented in this PR.

Acceptance: Migration-built schema supports the approved writer/reader, or retired integration is removed consistently. Legacy-schema security fixture is not schema-equivalence evidence.

### A09 — Default worker deployment targets legacy schedules

Evidence: npm deploy and tail omit --config, selecting the nearby legacy worker and its three cron triggers. The documented intended config is in aiso-worker with only two approved triggers; the extra trigger includes real trial email delivery and Search Console. This is a deployment trap, not evidence those schedules are live.

Action: Make dev/deploy/tail select the intended config explicitly; test resolved worker name/origin/schedules.

Decision: Engineering target correction; enabling the third schedule remains a separate release decision.

Acceptance: A dry-run manifest and test confirm the selected target and exactly the approved schedule set.

### A10 — Provider error bodies can expose prompt/customer data in logs

Evidence: JSON provider error.message is logged, and the entire upstream error body is thrown. A provider can echo submitted prompts or private customer text. Existing non-JSON echo test does not protect JSON error responses.

Action: Log only approved status/reason metadata and throw a stable sanitized provider error.

Decision: Engineering fix; customer-data retention policy may require separate log review.

Acceptance: JSON and non-JSON errors containing synthetic customer text never appear in logs or externally visible errors.

### A11 — Rewrite tool reports original input as successful output on malformed model JSON

Evidence: After allowance consumption, JSON parse failure is swallowed and the endpoint returns original chunkText with an empty changes list as HTTP 200. The original can be presented as a completed paid rewrite.

Action: Validate the response schema and return an explicit retryable error; decide how unsuccessful generation affects allowance.

Decision: Allowance/refund policy for failed paid generation.

Acceptance: Malformed/truncated/mistyped model responses cannot report a successful rewrite; valid output keeps existing response shape.

### A12 — Public funnel body limit is checked after buffering

Evidence: Without Content-Length the endpoint reads request.text() in full before applying its 2 KiB check. The claimed limit does not bound streaming memory consumption; platform caps only bound the larger maximum.

Action: Use the existing bounded-reader pattern to cancel once the byte ceiling is reached.

Decision: Engineering fix.

Acceptance: Chunked oversized bodies stop reading at the bound and never invoke telemetry/database work.

### A13 — Native Node seed command cannot resolve its imports

Evidence: node scripts/seed-packs.ts fails ERR_MODULE_NOT_FOUND for @/lib/db before any database access; its extensionless relative import is also incompatible with plain Node execution.

Action: Provide a supported runner or extract a plain-Node entrypoint with explicit relative imports; preserve database target guard.

Decision: Engineering fix; do not seed any persistent database as part of repair.

Acceptance: Import/startup validation with synthetic environment reaches argument/target checks without writes.

### A14 — Unused direct production dependencies

Evidence: @stripe/stripe-js and @radix-ui/react-visually-hidden have no source imports. Checkout is server-side. react-is remains a Recharts peer, visually-hidden remains a transitive Tooltip dependency, and @vercel/oidc is used by readiness; transitive dependencies must be retained.

Action: Remove the unused stripe-js declaration and consider removing the redundant direct visually-hidden declaration; update lockfile separately and retain required transitive packages.

Decision: Engineering cleanup; not bundled into the P0 PR. Advisory scan remains blocked.

Acceptance: Clean install/build and unit checks pass after removal; peer dependency graph remains valid.

### A15 — Seven retained components are unreachable

Evidence: Current explicit reachability inventory lists MissedTable, ScanLogSection, CompetitorTab, CompetitorChart, QuestionRow, PlatformBar and dashboard/PulseTabs. These are legacy UI remnants; the architecture prose still says eleven.

Action: Decide retirement versus deliberate reuse, then delete or reconnect the complete subtree and adjust inventory.

Decision: Product/maintenance decision. Deletion is outside safe P0 scope.

Acceptance: Reachability inventory and application routes agree; a cleanup must not remove the only intended future feature implementation silently.

### A16 — Malformed request bodies escape normal tool and checkout errors

Evidence: JSON parsing/destructuring occurs outside the handler try/catch and assumes object/string types. Null, invalid JSON or non-string chunkText can throw instead of returning a stable 400; checkout additionally returns raw Stripe exception messages.

Action: Validate bounded object bodies and required scalar types before provider/allowance work; use stable public failures.

Decision: Engineering fix.

Acceptance: Invalid JSON/null/arrays/wrong scalar types return deterministic 400 and perform no provider calls or quota consumption.

## Source references

n8n PostgreSQL v2 executeQuery supports array queryReplacement values passed separately from SQL: https://github.com/n8n-io/n8n/blob/master/packages/nodes-base/nodes/Postgres/v2/actions/database/executeQuery.operation.ts

n8n Webhook Header Auth credential selection and checks: https://github.com/n8n-io/n8n/blob/master/packages/nodes-base/nodes/Webhook/description.ts and https://github.com/n8n-io/n8n/blob/master/packages/nodes-base/nodes/Webhook/utils.ts

Local export node versions are Webhook 2, PostgreSQL 2.5, HTTP Request 4.2. Current upstream source was consulted for these contracts; installed live n8n version remains unknown.
