# Task 3 runtime adapter handoff

Status: implemented and locally verified; no live provider, database or candidate calls.

## Changes

- Added lib/readiness/runtime-adapters.ts and 33 injected-boundary adapter tests.
- Runtime orchestration/report accept optional configuredTeam() / configuredTeamId, preserving existing foundation APIs. Production adapter always exposes configuredTeam; observed.teamId remains null. Missing/malformed/mismatched configured team or missing runtime system fields suppresses I/O. Reports label configured team separately and require runner control-plane verification.
- Runtime Vercel identity reads VERCEL_PROJECT_ID, VERCEL_DEPLOYMENT_ID, VERCEL_GIT_COMMIT_SHA, VERCEL_ENV and immutable VERCEL_URL (with VERCEL=1). No request expectation is manufactured into observation.
- Database uses DATABASE_URL only, injected/lazy Neon constructor, tagged SQL, two readOnly:true HTTP transactions, local statement_timeout='5s', shared cancellation signal and no customer table SELECT. First identity proof uses checkBinding and forbidden precedence. Second transaction rechecks identity before accepting results; fixed metadata SQL independently materializes binding/role checks and CASE-gates has_table_privilege on both binding and existing relation OID. Each declared privilege is evaluated independently.
- Requires the documented aeo_app BYPASSRLS posture, rejecting owner, superuser, createdb, createrole, replication and elevated inherited roles. Spec/plan narrowly reconciled with CLAUDE.md/migration 037. No grants, schema or role mutation.
- Auth uses HTTPS public-url fetcher with zero redirects, 64KiB response cap, 5-second shared auth signal. Validates /DATABASE/auth issuer shape and nonempty JWKS keys object array; candidate /api/auth/get-session requires HTTP200 JSON null. Anonymous requests omit credentials. Only candidate receives optional x-vercel-protection-bypass; issuer never gets it, readiness bearer or cookies. Body cancellation is explicit and observable. Exceptions produce fixed codes, including SQLSTATE57014 => timeout.

## Interface for Task 4

createRuntimePorts({
  env: Readonly<Record<string, string | undefined>>,
  now?: () => number,
  neonFactory?: typeof neon,
  publicFetcher?: PublicUrlFetch,
}): ProbePorts

Construct after readiness authentication and request validation; caller explicitly supplies env snapshot (no env loading in adapter). now defaults Date.now. Neon and safe public fetch defaults are selected inside probe invocation; no client construction at import. Tests supply every external boundary.

Dedicated nonsecret env READINESS_EXPECTED_TEAM_ID must equal request.expected.teamId. Optional VERCEL_AUTOMATION_BYPASS_SECRET is the deployment-protection credential; there is no generic incoming-header forwarding argument. Route must own its total body-read-plus-probe 15-second budget and pass shared abort to runRuntimeProbe. Adapter caps each I/O port at five seconds, both sequential auth calls share that cap.

## Interface for Task 5

RuntimeReport optionally includes configuredTeamId for foundation compatibility. Reports from the production adapter include it, while observed.teamId is null. Runner MUST require configuredTeamId to equal independently verified Vercel control-plane team/owner, plus verify observed project/deployment/SHA/environment, nonce/policy hash and candidate READY before accepting any success. It must not treat configured team as observed team or accept a missing field on the production runtime path.

## Verification

- RED: 19 executable adapter tests failed against unimplemented API stub.
- Initial GREEN: all124 readiness tests passed.
- Targeted RED: SQL57014 timeout mapping and absent DBidentity precedence reproduced two failing assertions.
- Final GREEN: node node_modules/vitest/vitest.mjs run __tests__/readiness — 6 files,138 tests passed (33 adapter tests).
- node node_modules/eslint/bin/eslint.js lib/readiness/runtime-adapters.ts lib/readiness/runtime.ts lib/readiness/runtime-report.ts __tests__/readiness/runtime-adapters.test.ts — exit0, no diagnostics.
- node node_modules/typescript/bin/tsc --noEmit --incremental false — exit0, no diagnostics.
- Tests cover team/system-field suppression, read-only flags/local timeout/parameterized metadata, first/second binding drift, forbidden precedence, role posture, individual missing grants/relations, JWKS failures, candidate401/redirect/session, private DNS rejection, body cancellation/oversize, SDK abort/timeout and fixed-error redaction.

## Remaining gates

No live Neon execution, DNS lookup, issuer request, candidate request, deployment creation/promotion or credential access occurred. Real Vercel system-field availability and immutable URL, actual Neon in-band GUC/role metadata visibility, control-plane ownership and protected candidate access remain live platform acceptance gates. SQL guard behavior is checked via fixed query structure and mocked driver results; it has not been executed against a live PostgreSQL instance. Reports remain enforced:false and productionReady:false. CLI and route are later tasks.

## Review fix: managed Neon JWKS path

- Reproduced the review finding first: after updating the expected URL and fixture matching, the focused adapter suite failed because the implementation still requested `/jwks` (1 URL assertion plus 2 response-cancellation fixture assertions).
- Changed only the JWKS construction to append `/.well-known/jwks.json` to the validated `NEON_AUTH_BASE_URL` issuer. The anonymous-session URL, cancellation, read-only database behavior and team/runtime I/O gating are unchanged.
- Fixture matching and the exact URL regression now assert `https://issuer.example/neondb/auth/.well-known/jwks.json`.
- Evidence: Neon’s managed-auth JWT docs specify the public JWKS endpoint shape in [jwt.md](https://raw.githubusercontent.com/neondatabase/website/main/content/docs/auth/guides/plugins/jwt.md) and [manage-auth-api.md](https://raw.githubusercontent.com/neondatabase/website/main/content/docs/auth/guides/manage-auth-api.md).
- Final focused test: `npx.cmd vitest run __tests__/readiness/runtime-adapters.test.ts --reporter=verbose` — 1 file, 33 tests passed.
- Final readiness suites: `npx.cmd vitest run __tests__/readiness` — 6 files, 138 tests passed.
- Scoped lint: `npx.cmd eslint lib/readiness/runtime-adapters.ts __tests__/readiness/runtime-adapters.test.ts` — exit 0.
- No live provider calls, SDK JWT method calls, database execution, or credential access occurred.