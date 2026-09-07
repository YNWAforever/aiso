# Runtime Task 1 Report

## Outcome

Implemented the request, policy, runtime check, observed identity, database identity, canonical hashing, runtime report builder, and Markdown renderer contracts for Slice B. Existing configuration-only APIs are unchanged.

Runtime reports are permanently advisory: `enforced: false` and `productionReady: false`. Aggregate configuration and runtime statuses are rebuilt from validated checks. Missing fixed runtime evidence produces `unknown`, and failures take precedence.

Observed candidate identity is partial and explicit. `teamId` may be `null`; the configured expected team ID is never copied into observed evidence. The later adapter/runner must compare configured team scope and independently verify it without manufacturing runtime observation.

`verified-disabled` capability claims are normalized to `unknown` by `toReleasePolicy` until a trusted source-gate adapter exists. Relation evidence uses a bounded `policyIndex` plus a finite privilege vocabulary, so diagnostics never interpolate arbitrary relation names.

## TDD evidence

RED:

- Command: `node node_modules/vitest/vitest.mjs run __tests__/readiness/runtime-contract.test.ts __tests__/readiness/runtime-report.test.ts --maxWorkers=2`
- Result: 2 suites failed because `lib/readiness/runtime-contract.ts` and `lib/readiness/runtime-report.ts` did not exist.

GREEN and regression:

- Same focused command: 2 files passed, 24 tests passed.
- Foundation plus runtime: `node node_modules/vitest/vitest.mjs run __tests__/readiness/config.test.ts __tests__/readiness/report.test.ts __tests__/readiness/runtime-contract.test.ts __tests__/readiness/runtime-report.test.ts --maxWorkers=2`: 4 files passed, 64 tests passed. This includes all 40 unchanged foundation tests.
- Scoped ESLint on the two modules and two test files: passed with no output.
- `npm.cmd run typecheck`: passed; Next route type generation and `tsc --noEmit` completed successfully.
- `git diff --check`: passed.

All tests are synthetic and pure. No external API, credential, database, provider, migration, deployment, or live probe operation ran.

## Files

- `lib/readiness/runtime-contract.ts`
- `lib/readiness/runtime-report.ts`
- `__tests__/readiness/runtime-contract.test.ts`
- `__tests__/readiness/runtime-report.test.ts`

## Self-review and concerns

The contracts reject unknown keys, malformed hashes/nonces/SHAs, invalid capability and privilege values, duplicate relations/privileges/checks, relation overflows, invalid timestamps, forged aggregates, and arbitrary rendered strings. Policy hashing recursively sorts object keys and preserves array order.

The runtime team ID cannot currently be independently observed from a documented runtime system variable. This contract records it as unavailable rather than falling back to the request expectation. Team verification remains a runner/platform metadata responsibility. BYPASSRLS adapter policy remains outside Task 1 and pending user direction.
## Review repair (2026-09-08)

The review findings are fixed with an independently supplied and validated RuntimePolicy argument required by both buildRuntimeReport and renderRuntimeReport. The policy is validated through hashPolicy, and its canonical hash must match the evidence policyHash.

Candidate and database identity checks are rebuilt from expected versus observed values. A non-null mismatch becomes fail; a missing/null observation becomes unknown; explicit failures retain failure precedence. The expected team ID is never copied into a null observed teamId.

Relation checks are validated against the actual policy relation and privilege at policyIndex. Out-of-policy indices and privileges are rejected, duplicates remain rejected, and any missing required relation/privilege pair makes the aggregate runtime status unknown. The existing 16 KiB canonical policy check remains in place; oversized policy coverage uses the relation and identifier limits.

Renderer sentinel coverage now includes nonce, policy hash, both timestamps, expected and observed identity fields, observed database identity, nested configuration check id/status/code, runtime check id/status/code, forged aggregate status, and unknown top-level fields.

RED evidence:
- Initial focused run: runtime report suite failed during import because the new policy fixture was not yet wired; runtime contract passed 16 tests.
- Behavioral focused run after fixture wiring: 2 tests failed and 48 passed. Forged identity pass remained pass, and missing required relation evidence remained pass.

GREEN evidence:
- node node_modules/vitest/vitest.mjs run __tests__/readiness/config.test.ts __tests__/readiness/report.test.ts __tests__/readiness/runtime-contract.test.ts __tests__/readiness/runtime-report.test.ts --maxWorkers=2
- Result: 4 files passed, 80 tests passed. The 40 foundation tests are unchanged and pass.
- node node_modules/eslint/bin/eslint.js lib/readiness/runtime-contract.ts lib/readiness/runtime-report.ts __tests__/readiness/runtime-contract.test.ts __tests__/readiness/runtime-report.test.ts
- Result: passed with no output.
- git diff --check
- Result: passed.

No live I/O, provider operation, credential access, database access, migration, deployment, or adapter work was performed.
