# AISO readiness configuration foundation handoff

Date: 2026-09-08
Status: local report-only foundation implemented and checked; Task 2 independently approved; whole-slice final review pending; not production readiness

## Source identity

Current branch: codex/release-readiness-design

Current implementation HEAD: e313499 (fix(readiness): derive rendered configuration status)

Foundation commits:

- 4490a9c - pure configuration and capability validation
- b1e6183 - redacted report-only configuration results
- e313499 - finite validation of rendered top-level report metadata

The documentation commit is the next commit after e313499.

## Changed behavior

The foundation adds pure TypeScript contracts that validate an explicitly supplied environment and release policy. It checks core configuration, expected Neon project/branch/role/database bindings, forbidden targets, and declared capability requirements. It does not load process.env, query a database, contact a provider, or mutate runtime behavior.

The report builder accepts validated finite check vocabulary and emits configuration-only results. Every report remains enforced: false and productionReady: false; rendered output states REPORT ONLY / NOT ENFORCED. Configuration pass/fail/unknown describes only the supplied values and policy. The renderer validates top-level report metadata before interpolation. The report cannot establish live reachability, disabled-feature enforcement, candidate identity, or production acceptance.

README.md and .env.example now correct the stale claim that a missing Neon Auth cookie secret necessarily breaks next build. Auth and database clients initialize lazily, so build success does not verify runtime configuration. The readiness release policy is deliberately stricter than current runtime-path requirements.

## Checks run on current source

| Command | Exact observed result |
| --- | --- |
| node node_modules/vitest/vitest.mjs run __tests__/readiness/report.test.ts --maxWorkers=2 | RED after adding renderer-boundary regressions: exit 1; 5 expected failures |
| node node_modules/vitest/vitest.mjs run __tests__/readiness/report.test.ts --maxWorkers=2 | GREEN on e313499: exit 0; 17 report tests passed |
| node node_modules/vitest/vitest.mjs run __tests__/readiness --maxWorkers=2 | Exit 0 on e313499; 2 test files passed; 40 tests passed |
| node node_modules/eslint/bin/eslint.js lib/readiness __tests__/readiness | Exit 0 on e313499; no output |
| node node_modules/typescript/bin/tsc --noEmit | Exit 0 on e313499; no output (controller session 24484) |
| git diff --check | Exit 0 on e313499 plus the documentation diff; no output (controller session 24484) |

No live integration suite or schema:equivalence command was run. No provider, credential, deployment, database, scan, email, migration, scheduler, branch, or production operation was performed.

The controller's documentation diff review found no concerns. The controller-found top-level renderer trust gap was reproduced by five failing tests and fixed in e313499; 17 report tests and all 40 readiness tests then passed. Independent Task 2 re-review approved spec compliance and quality with no outstanding findings. Final whole-slice review remains pending, so this handoff does not claim final review approval.

## Evidence reconciliation

The C10 provider matrix and C11 release-readiness dossier are dated 2026-09-07 and predate the production configuration repairs. They remain historical evidence and were not refreshed by this local foundation.

The approved 2026-09-08 design records subsequent conversation evidence that production auth, database, rate-limit, and database-identity settings were repaired with explicit approvals. It also records one later www.fimmick.com scan returning HTTP 200 and saving result 08355c71-fbe2-415d-91fb-822b95c42218, score 73, grade B, whose public page returned HTTP 200. Those observations were not repeated in this task. They establish only that single observed scan flow, not provider acceptance, complete customer journeys, schema acceptance, or controlled promotion.

## Remaining release boundaries

The following approved-design slices remain unimplemented and unexecuted:

- B: an exact candidate-deployment identity contract, protected read-only runtime probes, dedicated operator credential/access method, database grants and identity metadata checks, and auth issuer/session reachability.
- C: explicit sterile-parent enforcement plus an approved disposable live schema-equivalence rehearsal with manifest hashes, cleanup readback, and evidence freshness.
- D: a controlled, serialized promotion path tied to immutable source and deployment identity, 30-minute runtime and 30-day schema evidence freshness, trusted artifact provenance, real Vercel bypass controls, rollback ownership, and failure drills.

Runtime-probe credential provisioning, live schema rehearsal, provider acceptance, CI/promotion enforcement, and production activation remain unexecuted. A successful build, passing configuration report, or successful scan does not close these gates.

## Unresolved policy decisions

A trusted policy adapter must define capability reachability and prove any verified-disabled state; the pure validator cannot do so. The protected runtime-probe credential source and deployment-protection access method are unresolved. Exact provider test modes, synthetic identities/sinks, budgets, schema rehearsal parent, promotion actors, bypass ownership, write fences, and rollback operator remain separate decisions and approvals.