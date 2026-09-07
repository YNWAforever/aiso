# Manual Candidate Runtime Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a manually invoked, protected candidate probe with redacted configuration/database/auth evidence and no promotion authority.

**Architecture:** Validate requests and reports in pure modules; orchestrate injected read-only ports under one deadline; expose a thin independently authenticated Next16 handler. A manual runner resolves immutable deployment identity before transmitting credentials and verifies it again after the probe.

**Tech Stack:** Node24, TypeScript5.9, Next16.2.4, installed Neon HTTP driver, existing safe public-URL fetcher and Vitest4. No new dependencies.

## Global Constraints

Approved spec: docs/superpowers/specs/2026-09-08-runtime-readiness-probes-design.md at f6ba793.

- Work locally on codex/release-readiness-design; preserve existing foundation APIs and unrelated work.
- Implementation/tests perform no live provider operations, credentials retrieval/provisioning, scans, migrations, deployments or promotion.
- Reports always enforced:false and productionReady:false. HTTP/CLI success is selected probe success, not release approval.
- Read AGENTS.md/CLAUDE.md and installed Next guides before framework edits. Keep proxy.ts, never create middleware.ts; no Supabase imports.
- Authenticate before body parsing/resource construction. Dedicated readiness secret, no normal login dependency.
- Exactly16KiB maximum request body,15-second shared handler budget,5-second maximum per I/O probe,20-second runner HTTP deadline, no automatic retry.
- Never emit credentials, hashes of secrets, raw SDK errors, cookies, response headers, environment dumps or customer data.
- Candidate target and expected full SHA are explicit. No mutable alias, automatic production default or promotion function.
- Read-only database transactions and fixed metadata queries only. Separate credentials for deployment protection never reach issuer requests.

## Verified implementation inputs

Installed node_modules/@neondatabase/serverless/index.d.ts exposes transaction readOnly and fetchOptions; pass AbortSignal through fetchOptions. Read transaction declarations before adapter work. lib/security/public-url.ts exposes createPublicUrlFetcher with allowedProtocols, maxRedirects, maxResponseBytes and timeoutMs; use HTTPS only and maxRedirects0.

Existing foundation: lib/readiness/config.ts, lib/readiness/report.ts. Existing binding policy: lib/security/db-binding.ts. Do not call getProfile for readiness authorization or normal application db() just to determine readiness; neither is the readiness credential boundary. Reuse pure checkBinding semantics in a dedicated metadata adapter.

## Files and ownership

- lib/readiness/runtime-contract.ts: strict request/policy/result validation, canonical policy hashing and safe identifier rules.
- lib/readiness/runtime-report.ts: canonical versioned runtime report and safe Markdown; reuse configuration validation without changing its API.
- lib/readiness/runtime.ts: dependency-aware orchestration, deadline and fixed failure translation.
- lib/readiness/runtime-adapters.ts: deployed configuration/identity, read-only SQL and bounded JWKS/session probes.
- lib/readiness/runtime-auth.ts: dedicated credential comparison and bounded request-body reader.
- app/api/internal/readiness/route.ts: thin POST handler, authorization first, no caching.
- scripts/readiness/check-candidate.mjs: manual runner entry; exported orchestration for tests, guarded main execution.
- scripts/readiness/candidate-contract.mjs: CLI/API response validation and redacted artifact serialization; no environment side effects at import.
- __tests__/readiness/runtime-contract.test.ts, runtime-report.test.ts, runtime.test.ts, runtime-adapters.test.ts, runtime-auth.test.ts.
- __tests__/api/readiness.test.ts and __tests__/scripts/check-candidate.test.mjs.
- docs/superpowers/plans/2026-09-08-runtime-readiness-handoff.md plus narrow README/.env.example documentation.

The .mjs runner consumes wire JSON, not the application's TypeScript dependency graph. Avoid runtime imports that Node cannot resolve through @/ aliases or extensionless TS imports. Its fixed wire-shape validator must be checked against shared JSON fixtures emitted by the runtime-contract tests; do not build a second competing readiness evaluator.

## Task1: Request, policy and report contracts

**Interfaces:**

```ts
export type ProbeStatus = 'pass' | 'fail' | 'unknown'
export type CandidateIdentity = { teamId: string; projectId: string; deploymentId: string; commitSha: string; environment: 'preview' | 'production' }
export type MetadataRequirement = { schema: 'public'; relation: string; privileges: ('SELECT' | 'INSERT' | 'UPDATE' | 'DELETE')[] }
export type ProbeRequest = { schemaVersion: 1; nonce: string; expected: CandidateIdentity; policyHash: string; policy: RuntimePolicy }
export type RuntimePolicy = { version: 1; expectedDatabase: { project: string; branch: string; role: 'aeo_app'; database: string }; capabilities: Record<'claims'|'ai'|'billing'|'email'|'scheduler','required'|'unknown'|'verified-disabled'>; relations: MetadataRequirement[] }
export type RuntimeCheck = { id: string; status: ProbeStatus; code: string }
```

All runtime-check IDs/codes are finite exported vocabularies; never derive them from external exception text or arbitrary relation names. Relation results carry a validated policy index, not an interpolated diagnostic string. RuntimePolicy is converted to the existing ReleasePolicy internally; verified-disabled is normalized to unknown until a trusted source-gate adapter exists.

- [ ] Write failing tests for unknown/extra fields, malformed SHA/identifiers, invalid capability/privilege, duplicates, oversized policy, unrecognized check codes, policy hash mismatch and forged report metadata. Example:

```ts
expect(() => parseProbeRequest({ ...validRequest, sql: 'select 1' })).toThrow('Invalid readiness request')
expect(() => parseProbeRequest({ ...validRequest, policyHash: '0'.repeat(64) })).toThrow('Invalid readiness request')
expect(buildRuntimeReport(validEvidence).productionReady).toBe(false)
```

- [ ] Run `node node_modules/vitest/vitest.mjs run __tests__/readiness/runtime-contract.test.ts __tests__/readiness/runtime-report.test.ts --maxWorkers=2`; establish RED for absent behavior.
- [ ] Implement parseProbeRequest(input:unknown):ProbeRequest, hashPolicy(policy:RuntimePolicy):string and canonical report builders/renderers. SHA is40 lowercase hex; policy hash64 lowercase hex; nonce32 lowercase hex. Bound relation count32, privileges4, identifier strings128 characters and SQL names to lowercase identifier grammar. Require nonempty explicit team/project/deployment/database identities. Canonical hash sorts object keys recursively; array order is meaningful and preserved. Hash only the validated nonsecret policy.
- [ ] Report identity fields are validated and allowlisted; aggregate statuses are rebuilt from checks. Set schemaVersion1, kind runtime-readiness, enforced false and productionReady false. Include nonce, policyHash, startedAt/completedAt, expected/observed candidate identity, safe observed DB identity and nested canonical configuration report. Empty required evidence is unknown, not pass. Fixed renderer text: REPORT ONLY / NOT ENFORCED.
- [ ] Add sentinel tests through every rendered string-bearing field, malformed timestamps, forged aggregate pass and unknown keys. Reuse all40 foundation tests unchanged. Run focused tests/scoped lint; commit explicit files as `feat(readiness): define runtime probe contracts`.

## Task2: Pure bounded orchestration

**Interfaces:**

```ts
export type ProbePorts = {
  now(): number
  identity(): unknown
  configuration(policy: RuntimePolicy): unknown
  database(policy: RuntimePolicy, signal: AbortSignal): Promise<unknown>
  auth(policy: RuntimePolicy, signal: AbortSignal): Promise<unknown>
}
export async function runRuntimeProbe(request: ProbeRequest, ports: ProbePorts, signal: AbortSignal): Promise<RuntimeReport>
```

RuntimeReport is the exact return type produced in Task1. Parse all unknown port results through Task1 validators; fixed errors replace raw exceptions. Do not let raw objects escape into the final report.

- [ ] Add RED tests proving no database/auth call on candidate mismatch; invalid DB configuration suppresses DB only; DB failure does not suppress independent auth; unknown results remain unknown; thrown sentinel is absent from report; deadlines are passed to adapters; exactly one call per port.
- [ ] Implement sequential identity/config checks followed by bounded independent DB/auth probes using Promise.allSettled. Create the shared deadline at15seconds and combine it with the caller signal. Per-probe signals combine that deadline with5seconds. Reject already aborted work before any port access. Record fixed timeout/dependency/identity/configuration/network codes; no retries, sleeps or background work.
- [ ] Example behavioral assertion:

```ts
const result = await runRuntimeProbe(request, mismatchedIdentityPorts, new AbortController().signal)
expect(database).not.toHaveBeenCalled()
expect(auth).not.toHaveBeenCalled()
expect(result.productionReady).toBe(false)
```

- [ ] Test cancellation with fake timers and abort-aware deferred ports, not real sleeping or network. Ensure no unhandled rejection after timeout. Run runtime tests plus foundation tests; scoped lint. Commit `feat(readiness): orchestrate bounded read-only probes`.

## Task3: Candidate read-only adapters

**Interfaces:** createRuntimePorts(dependencies):ProbePorts, with injectable env snapshot, clock, Neon constructor and public fetcher. No client constructed at module evaluation. Dependencies have production defaults only inside the authenticated route invocation; unit tests inject all external boundaries.

- [ ] First read installed Neon transaction and fetchOptions declarations and current public-url interfaces. Write RED adapter tests that inspect transaction readOnly:true, abort-signal propagation, safe metadata parameters and no customer-table SELECT. Assert identity mismatch prevents later grant probes.
- [ ] Resolve runtime deployment fields from Vercel system variables only. Map deployment/project/SHA/environment explicitly; if unavailable, return unknown. Do not accept the request expectation as observed identity. Team identity is proven by runner control-plane metadata and the handler's configured expectation; distinguish configured from independently observed fields in report tests.
- [ ] Construct Neon with DATABASE_URL in memory. Execute a read-only transaction with fixed local5-second statement timeout plus identity query, verifying transaction_read_only equals on. Query current_setting for Neon project/branch, current_user and current_database; inspect pg_roles for superuser/bypassrls and reject elevated or owner role. Use tagged templates only. Transaction-local timeout setup is an explicitly allowlisted session setting, never a persisted database change.

```ts
await sql.transaction(tx => [
  tx`set local statement_timeout = '5s'`,
  tx`select current_setting('transaction_read_only') as read_only,
     current_setting('neon.project_id', true) as project_id,
     current_setting('neon.branch_id', true) as branch_id,
     current_user as role, current_database() as database`,
], { readOnly: true, fetchOptions: { signal } })
```

- [ ] After successful binding proof, check declared public relations and each requested privilege independently through fixed parameterized metadata queries in another read-only transaction. Recheck identity inside that transaction and guard metadata results on matching identity to catch target drift. Missing relations fail; do not invoke privileges on an absent relation or collapse errors to pass. No owner connection, grants repair or schema mutation.
- [ ] For auth, createPublicUrlFetcher({allowedProtocols:['https:'],maxRedirects:0,maxResponseBytes:65536,timeoutMs:5000}). Validate issuer endpoint shape and JWKS object with a nonempty keys array; save no keys. Check candidate /api/auth/get-session using the verified runtime immutable URL and empty user credentials. Require HTTP200 and JSON null. Never forward readiness bearer/cookies to either request. Allow the separately provided protection header only to the exact verified candidate origin; abort on redirect.
- [ ] Ensure body cancellation/transport abort and transaction timeout behavior are observable in mocks. Raw driver/fetch exceptions become fixed codes. Test bad JWKS, private destination, protected-candidate401, unexpected session, wrong DB identity, missing grant and SDK timeout. Verify no SQL outside the allowlist; no real database execution. Commit `feat(readiness): add bounded runtime verification adapters`.

## Task4: Protected Next16 route

**Files:** runtime-auth.ts, app/api/internal/readiness/route.ts and corresponding tests. Read installed route.md and route-segment config guides before implementation.

- [ ] RED tests: absent server secret503; bad/missing Bearer401; no body parsing/client construction on either; oversized chunked body413; invalid JSON/request400; unsupported method no probes; successful authenticated fixture request has no-store and false readiness/enforcement.
- [ ] Implement authorizeProbe(request,secret):boolean with a bounded exact Bearer format and constant-time equal-length buffer comparison. READINESS_PROBE_SECRET must be at least32 characters; invalid server configuration uses fixed generic response. Reject cookies or arbitrary forwarded headers as auth substitutes.
- [ ] Implement readBoundedJson(request,maxBytes=16384) with stream byte counting and cancellation, not request.json() after trusting Content-Length. Reject unknown body fields through Task1 parser.
- [ ] Handler POST uses Node runtime, dynamic force-dynamic and Cache-Control:no-store. Authorization precedes body parsing. Build ports only after authorized valid input. Read readiness/deployment-protection secrets solely inside the handler and never place them in the configuration report. No CORS opt-in, no logged raw exceptions. GET/HEAD do not execute probes. Return200 for completed pass/fail evidence and generic503 for infrastructure inability to form a valid report; CLI interprets required check failures independently of HTTP200.
- [ ] Run route/auth tests with injected fixtures and no production env; run existing auth-route and readiness tests. Scope lint and `npm.cmd run typecheck`. Commit `feat(readiness): expose authenticated internal probe`.

## Task5: Manual verified-candidate runner

**Entry:** node scripts/readiness/check-candidate.mjs --team TEAM --project PROJECT --deployment DEPLOYMENT --sha SHA --environment preview --policy PATH --output-dir PATH.

Required secrets are environment-injected VERCEL_TOKEN and READINESS_PROBE_SECRET; optional VERCEL_AUTOMATION_BYPASS_SECRET. Reject token arguments and arbitrary --url. No .env loading, environment mutation, deployment/promotion API or automatic retries. Import has no CLI side effects; main is guarded by the existing repository's Node-entry pattern.

- [ ] RED tests mock metadata/probe HTTP and fs ports. Assert no readiness credential sent before metadata verifies exact project/team/deployment/SHA/environment/READY; reject alias input, missing URL and redirects. Assert metadata calls carry only Vercel token; probe carries readiness token and, if configured, bypass header; artifacts contain neither.
- [ ] Implement runCandidateCheck(options,ports) with exact metadata GET before and after one POST. Build URL solely from authenticated metadata; require HTTPS hostname and immutable deployment URL/ID agreement. Verify nonce, policy hash, timing, report identity and status vocabulary against Task1 wire fixtures. Never echo raw HTTP response on failure. Enforce20-second HTTP timeout and response byte bound.
- [ ] Persist validated canonical JSON and Markdown only into the explicit output directory, using a nonce-qualified basename and exclusive file creation; refuse overwrite. Reject raw response strings or extra fields. Header values never enter output. Reports older than30minutes, future/inconsistent timings, hash/identity drift or failed metadata reread exit1. Failed/unknown required checks exit1. Only fully passed selected checks exit0, with productionReady false.
- [ ] Add fixture cross-contract tests so runner validation matches endpoint output; replay malformed reports, forged status, stale nonce, metadata drift and injected strings. Assert exactly one probe request and no calls to deployment/promotion endpoints. Run focused script tests/readiness tests/lint; commit `feat(readiness): add manual candidate verification runner`.

## Task6: Local verification and reviewable live proposal

- [ ] Run all new readiness tests plus __tests__/api/readiness.test.ts, __tests__/api/auth-route.test.ts and __tests__/scripts/check-candidate.test.mjs under Vitest with --maxWorkers=2. No live integration or schema:equivalence command.
- [ ] Run scoped ESLint, `npm.cmd run typecheck`, `git diff --check` and a production build with the established explicitly synthetic fixture environment; no environment download. Record exact source SHA and actual output, separating setup/baseline failures from regressions. Do not modify global config to hide failures.
- [ ] Generate one synthetic example report using fixtures only. Label it synthetic prominently and ensure the runner would reject it as production acceptance. Add usage and variable-name/source documentation to README/.env.example, explicitly distinguishing Vercel metadata token, readiness bearer and outer deployment-protection credential. Do not include values.
- [ ] Prepare docs/superpowers/plans/2026-09-08-runtime-readiness-handoff.md with exact local behavior/tests, independent review, unsupported platform gates and limitations. Include a live-action proposal template requiring concrete team/project/deployment/SHA, candidate environment/database policy, credential sources, maximum one read-only invocation, timeout, acceptance and rollback. Unknown identifiers block execution; no guessed candidate creation.
- [ ] Obtain independent whole-slice review, fix findings with regression tests and rerun only affected checks. Commit documentation and stop at the local reviewable handoff. No push/deployment/credential provisioning/live probe/schema rehearsal/promotion is implied.

## Review checkpoints and acceptance limits

Each task ends with a scoped test/lint result and independently reviewable commit; preserve explicit file staging. Task1 wire changes require runner fixture revalidation. Any change to auth-before-I/O, target-origin verification, DB transaction read-only/timeout behavior or redaction is a blocking review concern.

Local completion covers Slice B implementation and fixtures only. Trusted verified-disabled policies, actual Vercel runtime metadata availability and protection access must be proven on a separately approved candidate before live acceptance. Slice C schema-equivalence evidence and Slice D promotion enforcement remain excluded. A successful probe does not establish authenticated customer journeys, paid provider behavior or release readiness.

## Plan self-review

Mapped every approved Slice B section to contracts/reporting(1), orchestration(2), read-only adapters(3), independent endpoint authorization(4), verified manual execution/artifacts(5), and local/live boundary evidence(6). Neon readOnly/fetchOptions and existing public URL controls were verified in the installed code. The runner avoids importing alias-dependent application modules under plain Node. Live source/credential/access decisions remain activation prerequisites, not implementation defaults. No code or production state changed while writing this plan.

Task 3 architecture reconciliation: require/accept aeo_app BYPASSRLS per CLAUDE.md and migration 037; reject owner, superuser and elevated-role metadata. Report READINESS_EXPECTED_TEAM_ID as configuredTeamId, never as observed.teamId. Missing/mismatched configured team suppresses I/O; runner control-plane ownership verification remains mandatory. HTTP-driver batched metadata uses a materialized binding CTE and CASE to gate privilege calls on matching second-transaction identity and an existing relation OID.
