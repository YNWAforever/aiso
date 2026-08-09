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

## Task 4: Strict manifest property-schema fix

- Rejected unknown root manifest properties and unknown properties on every manifest entry, while retaining the existing field, path, layer, role, and required-entry contracts.
- Added fail-closed regressions for malformed root and entry keys; no runtime production files changed.

### Verification

- Focused manifest, migration, and citation suites passed: 3 files, 38 tests.
- Standalone validator, typecheck, whitespace diff, and the `c8669d9` runtime-base comparison for citation density and pulse route passed.

### Residual blocker

- Live database, authenticated browser, provider-canary, staging WCAG, and external CI evidence remain intentionally out of scope.

---

## Task 4: Broad alert-function grant contract fix

- Extended the alert snapshot grant matcher to recognize `GRANT ... ON ALL FUNCTIONS IN SCHEMA public`, including the SQL-quoted schema form, and route matching grants through the existing exact `service_role` and `EXECUTE` checks.
- Added negative regressions for `authenticated` broad grants in both schema forms. No production runtime files changed.

### Verification

- TDD RED: both unauthorized broad grants were previously missed by the function-only matcher.
- Focused manifest, migration, and citation suites passed: 3 files, 43 tests.
- Standalone manifest validator, typecheck, whitespace diff, and the `c8669d9` runtime-base comparison for citation density and pulse route passed.

### Residual blocker

- Live database, authenticated browser, provider-canary, staging WCAG, and external CI evidence remain intentionally out of scope.

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

## Task 4: Canonical citation-variant regression fix

- Replaced the byte-identical duplicate fixture with `https://NIH.gov:443/study` and `https://nih.gov/study`, proving URL normalization, duplicate link-occurrence counting, and one authority lookup for canonical `nih.gov` without runtime changes.

### Verification

- Focused citation, manifest, and migration suites passed: 3 files, 36 tests.
- `node scripts/ci/validate-test-manifest.mjs`, `npm.cmd run typecheck`, and `git diff --check` passed.
- `lib/checks/citationDensity.ts` has no diff from Task 4 production base `84df3b0e33571d531e5cefbba496ea22e191b75d`.

### Residual blocker

- Live database, authenticated browser, provider-canary, staging WCAG, and external CI evidence remain intentionally out of scope.

---

## Task 4: Bound alert RPC matcher

- Tokenized comma-separated `GRANT ... ON FUNCTION` target lists and anchored the alert snapshot target matcher, so only an exact `get_alert_weekly_snapshot(uuid[])` function target is recognized with optional schema qualification and SQL quoting.
- Added a focused regression proving `public.other_get_alert_weekly_snapshot(uuid[])` is not treated as the alert snapshot RPC. No production runtime files changed.

### Verification

- TDD RED: the near-name target was incorrectly detected by the prior unanchored matcher.
- `npm.cmd test -- --run __tests__/ci/test-manifest.test.ts __tests__/supabase/migration-contract.test.ts __tests__/checks/citationDensity.test.ts` passed: 3 files, 41 tests.
- `node scripts/ci/validate-test-manifest.mjs`, `npm.cmd run typecheck`, `git diff --check`, and the `c8669d9` runtime-base comparison for citation density and pulse route passed.

### Residual blocker

- Live database, authenticated browser, provider-canary, staging WCAG, and external CI evidence remain intentionally out of scope.

---

## Task 4: Final traceability corrective fix

- Restored `lib/checks/citationDensity.ts` exactly to Task 4 base `c8669d9`; no runtime URL canonicalization, duplicate filtering, or provider-shape filtering remains in this task.
- Added boundary coverage for URL-parser normalization with fragment preservation, duplicate citation counting with per-domain authority aggregation, tier aggregation, and malformed provider values. The malformed-value assertion records the existing `Promise.allSettled` boundary; validating/filtering provider object shapes requires a runtime-contract change and is intentionally out of scope.
- Required manifest references to be test files under `__tests__/` or `tests/` with `.test.*` or `.spec.*` names, including a fixture/helper rejection regression.
- Made alert snapshot grant detection recognize qualified, unqualified, and SQL-quoted identifiers in comma-separated function lists, and added unauthorized unqualified/quoted grant regressions.

### Verification

- Focused citation, manifest, and migration suites; standalone manifest validator; typecheck; and whitespace diff checks were run after the fix.
- `git diff --exit-code c8669d9d75ece574aed42e3c87867cb9bc07829f -- lib/checks/citationDensity.ts` passed.

### Residual blocker

- No source blocker. Live database, authenticated browser, provider-canary, staging WCAG, and external CI evidence remain intentionally out of scope.

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

---

## Task 4: Strict manifest schema fix

- Required layers now form the exact duplicate-free recognized set, and entry IDs require uppercase alphanumeric hyphen-separated segments.
- Added malformed-manifest coverage for whitespace-only IDs, duplicate layers, and unknown layers.

### Verification

- `npm.cmd test -- __tests__/ci/test-manifest.test.ts __tests__/supabase/migration-contract.test.ts --run` passed: 2 files, 22 tests.
- `node scripts/ci/validate-test-manifest.mjs`, `npm.cmd run typecheck`, and `git diff --check` passed.

### Residual environment blockers

- Live database, authenticated browser, provider-canary, staging WCAG, and external CI evidence remain intentionally out of scope and were not attempted.

---

## Task 4: Final traceability fixes

- Hardened manifest file containment by checking the repository root and every ancestor with `lstat`, rejecting symbolic-link/reparse-like traversal before the target file is read; retained `realpath` containment as a defense-in-depth check.
- Replaced citation-fragment preservation coverage with canonical URL normalization and deduplication assertions, and added malformed authority-provider output coverage that rejects invalid detail records.
- Removed unrelated account-unlock history so this report contains Task 4 evidence only.

### Verification

- TDD RED: ancestor-link, duplicate canonical URL, and malformed provider-output regressions failed against the prior implementations.
- Focused manifest/citation regressions passed: 2 files, 24 tests.
- `npm.cmd test -- --run __tests__/ci/test-manifest.test.ts __tests__/supabase/migration-contract.test.ts __tests__/checks/citationDensity.test.ts` passed: 3 files, 31 tests.
- `node scripts/ci/validate-test-manifest.mjs` and `npm.cmd run typecheck` passed; `git diff --check` is recorded after the final report update.

### Residual environment blockers

- Live database, authenticated browser, provider-canary, staging WCAG, and external CI evidence remain intentionally out of scope and were not attempted.

---

## Task 4: Invalid manifest-root robustness fix

- Rejected null, array, and other non-plain-object JSON manifest roots before property access, returning a validation error array instead of throwing.
- Added focused null-root and array-root manifest regressions; existing strict key allowlists and entry checks remain unchanged.

### Verification

- TDD RED: null root threw on `schemaVersion`; array root returned unrelated field errors.
- Focused manifest, migration, and citation suites passed: 3 files, 40 tests.
- Standalone validator, typecheck, whitespace diff, and the `c8669d9` runtime-base comparison for citation density and pulse route passed.

### Residual blocker

- Live database, authenticated browser, provider-canary, staging WCAG, and external CI evidence remain intentionally out of scope.
