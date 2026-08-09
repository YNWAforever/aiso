# Task 4 report — secure inline account unlock

## Status

Implemented the Task 4 result-access boundary and single account-unlock journey on `codex/scan-to-signup-impl`.

- The result page now fetches the scan and Neon profile in parallel and grants full access only when `scan.account_id === profile.account_id`.
- Unauthenticated and non-owning viewers receive only `PublicResultSummary`; `scan.results` is passed to the Client Component only for an owning account.
- The public summary contains score/count/issue-key and computed teaser fields, but no `results`, raw evidence, or private remediation details.
- `EmailCaptureGate` and `TrialCta` are no longer imported or used by the result journey.
- `AccountUnlockCard` provides Google and magic-link signup with a visible email label, polite status messaging, rate-limit copy, and a callback to localized onboarding that retains the scan ID.
- Auth completion accepts only a same-locale relative `next` path.
- No Task 5 scan claiming, schema, RLS, grant, or service-key change was made.

## Verification

- TDD RED: `npm.cmd test -- --run __tests__/lib/result-access.test.ts` failed because `@/lib/result-access` did not exist.
- Focused access/impact: `npm.cmd test -- --run __tests__/lib/result-access.test.ts __tests__/lib/impact.test.ts` — 2 files, 23 tests passed.
- TypeScript: `npm.cmd exec tsc -- --noEmit` — passed.
- Focused lint: Task 4 source and test files — passed with no findings.
- Repository lint: exit 0; existing unrelated warnings remain in baseline files/worktree copies.
- Production build: `npm.cmd run build` with process-local non-production `NEON_AUTH_COOKIE_SECRET` — passed on Next.js 16.2.4.
- Result/auth E2E on a dedicated same-origin dev server: 14 passed, 10 failed, 0 skipped. This run is environment-blocked rather than a Task 4 product result: `NEON_AUTH_BASE_URL` is absent, so `getProfile()` fails inside `auth().getSession()` (`undefined.endsWith`) and result/dashboard routes return 500. Global setup also reports missing Supabase URL/service-role fixture credentials and cannot seed `TEST_SCAN_ID`. No auth/data bypass or secret retrieval was added.

## Self-review

- Authorization is an explicit server-side account ownership predicate, not a role check.
- The locked RSC payload receives `summary` plus `fullScan={undefined}`; the full scan is supplied only after ownership matches.
- Auth methods share one callback URL and preserve both locale and scan ID.
- Client props are limited to the sanitized summary, optional owner-only scan, language, and scan ID.
- `.codebase-memory/` was preserved and generated `playwright-results.json` was restored.

## Commit

Commit message: `feat: unlock scan reports with one free account gate`

---

## Task 4: PR gate traceability contracts

- Added the required merge-gate manifest, a standalone validator, and Vitest contracts for manifest structure and checked-in migration SQL.
- Added evidence-only role mappings and documented analyst/viewer report roles as follow-up gaps; no live database, browser, provider, workflow, or branch-protection mutation was performed.
- Extended tier/quota, alert gate, citation normalization, canonical URL deduplication, authority aggregation, and malformed provider-output coverage using fixed fixtures and existing adapters.

### Verification

- `npm.cmd test -- __tests__/ci/test-manifest.test.ts __tests__/supabase/migration-contract.test.ts --run` — 2 files, 8 tests passed.
- `node scripts/ci/validate-test-manifest.mjs` — passed.
- Targeted modified suite — 9 files, 84 tests passed.
- `npm.cmd run typecheck` — passed.
- `git diff --check` — passed.

### Residual environment blockers

- Live database, authenticated browser, provider-canary, staging WCAG, and external CI evidence remain intentionally out of scope and were not attempted.

---

## Task 4: Manifest and SQL parser hardening

- Changed manifest path validation to use `lstat`, reject symbolic links, and retain repository-relative regular-file checks beneath `__tests__/` or `tests/`; the regression uses a real temporary link when Windows permits it and metadata injection otherwise.
- Updated the migration contract parser to inspect every `GRANT ... ON FUNCTION` list for the alert snapshot RPC, including comma-separated targets, and require `EXECUTE` for exactly `service_role` while rejecting `ALL`/`ALL PRIVILEGES` and unauthorized grantees.

### Verification

- `npm.cmd test -- __tests__/ci/test-manifest.test.ts __tests__/supabase/migration-contract.test.ts --run` passed: 2 files, 19 tests.
- `node scripts/ci/validate-test-manifest.mjs`, `npm.cmd run typecheck`, and `git diff --check` passed.

### Residual environment blockers

- Live database, authenticated browser, provider-canary, staging WCAG, and external CI evidence remain intentionally out of scope and were not attempted.

---

## Task 4: Review gate-scope and privilege fix

- Broadened the alert snapshot SQL contract to inspect every `GRANT ... ON FUNCTION` form and added a negative `GRANT ALL PRIVILEGES` fixture for an unauthorized grantee; explicit `PUBLIC`, `anon`, and `authenticated` revokes remain required.
- Restricted manifest traceability entries to repository-relative regular files beneath `__tests__/` or `tests/`, with regressions for a root regular file, absolute paths, traversal paths, and directories.
- Restored the pre-Task 4 runtime behavior in the pulse route and citation-density check. Their focused tests now cover that existing behavior; no production behavior is required for the test-boundary changes.

### Verification

- TDD RED: malformed root-file, absolute-path, and traversal-path manifests failed against the previous validator.
- `npm.cmd test -- __tests__/ci/test-manifest.test.ts __tests__/supabase/migration-contract.test.ts --run` passed: 2 files, 16 tests.
- `npm.cmd test -- __tests__/checks/citationDensity.test.ts __tests__/api/pulse-flow.test.ts --run` passed: 2 files, 25 tests.
- `node scripts/ci/validate-test-manifest.mjs`, `npm.cmd run typecheck`, and `git diff --check` passed.

### Residual environment blockers

- Live database, authenticated browser, provider-canary, staging WCAG, and external CI evidence remain intentionally out of scope and were not attempted.

---

## Task 4: Gate contract fail-closed fix

- Hardened the standalone manifest validator and its contract tests: manifest roles are limited to evidenced `anonymous`, `authenticated`, and `admin`; file entries must resolve to regular files; and all six required IDs must carry their contract priorities.
- Added temporary malformed-manifest regressions for unsupported roles, directory paths, missing required entries, and incorrect contract priorities.
- Tightened the checked-in SQL contract so every alert snapshot RPC grant must name exactly `service_role`, while retaining the explicit `PUBLIC`, `anon`, and `authenticated` revokes. No live database dependency was added.

### Verification

- TDD RED: malformed role and directory/missing-entry cases failed against the prior validator.
- `npm.cmd test -- __tests__/ci/test-manifest.test.ts __tests__/supabase/migration-contract.test.ts --run` passed: 2 files, 13 tests.
- `node scripts/ci/validate-test-manifest.mjs`, `npm.cmd run typecheck`, and `git diff --check` passed.

### Residual environment blockers

- Live database, authenticated browser, provider-canary, staging WCAG, and external CI evidence remain intentionally out of scope and were not attempted.

---

## Task 4: Migration grant-contract fix

- Changed migrations 023 and 024 to explicitly revoke `EXECUTE` on the alert snapshot RPC from `PUBLIC`, `anon`, and `authenticated` before granting it to `service_role`.
- Strengthened the SQL contract test to require the `PUBLIC` revoke and reject alert RPC grants to `PUBLIC`, `anon`, or `authenticated`; the RPC and transaction-control contracts remain unchanged.

### Verification

- TDD RED: the new explicit `PUBLIC` revoke expectation failed against the prior `REVOKE ALL` SQL.
- `npm.cmd test -- __tests__/ci/test-manifest.test.ts __tests__/supabase/migration-contract.test.ts --run` passed: 2 files, 8 tests.
- `node scripts/ci/validate-test-manifest.mjs`, `npm.cmd run typecheck`, and `git diff --check` passed.
