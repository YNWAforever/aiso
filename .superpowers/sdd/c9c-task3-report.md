# C9c Task 3 implementation report

## Result

Implemented the additive private evidence-work-item schema and pure strict input contracts at base `2e221851917d8a59e2d5de2926887cd6ae96e74c`. No opportunity/work-item endpoint, read, save, service, store or UI behavior was added. Migration 041 was authored only and was not applied.

## Contracts

- `parseCreateDraft` accepts only `source`, `ruleVersion`, `fingerprint` and `locale`; source UUIDs normalize to lowercase. It rejects unknown/nested fields, invalid UUIDs, non-lowercase/non-64-byte SHA-256 text, unsupported locales, invalid source/rule pairings, and check keys outside the canonical 20-key scan-evidence allowlist. `checkKey` is required only for `scan-check`.
- `parseDraftEdit` strictly accepts title/action/notes/expectedRevision, trims and NFC-normalizes text, counts Unicode code points, rejects whitespace-only required fields, rejects immutable-field injection, enforces the 160/4000/8000 character bounds and the 32 KiB serialized UTF-8 bound, and accepts only positive safe-integer revisions. Positive future revisions remain syntactically valid so Task 4 can classify them as conflicts.
- Work-item list input defaults to 50, caps at 100, rejects repeated/unknown parameters, and uses a canonical base64url cursor with lossless PostgreSQL timestamp text plus UUID.
- Exported request/snapshot limits are 4 KiB, 32 KiB and 64 KiB. Task 4 services must still stream/cap raw request bytes before JSON parsing and preflight the final JSONB serialization before conditional insert; these service behaviors are outside Task 3.
- `WorkItem` exposes exactly id, clientId, draft status, editable text, locale, revision, timestamps, and evidenceSnapshot. It does not expose account or actor IDs.

## Migration

`041_evidence_work_items.sql` creates a tenant-owned table with the `(client_id,account_id)` client FK, nullable `(actor,account_id)` FKs that use column-specific `ON DELETE SET NULL`, draft-only status, source/rule/check-key allowlists, locale/fingerprint/text/revision/JSON object and 64 KiB JSONB checks, unique opportunity identity, and descending account/client/created_at/id list index. It deliberately has no source-row FK so snapshots survive source replacement. Public and inherited `aeo_app` grants are revoked before granting only SELECT/INSERT/UPDATE.

## TDD and verification

- Initial RED: `node node_modules/vitest/vitest.mjs run __tests__/work-items/schema.test.ts __tests__/work-items/migration.test.ts` — 2 files failed. The schema suite could not load the absent module; all 4 migration tests failed because 041 was absent.
- Self-review RED: the migration suite ran 4 tests with 1 expected failure for the missing database check-key allowlist; the migration was then tightened.
- Final GREEN: `node node_modules/vitest/vitest.mjs run __tests__/work-items/schema.test.ts __tests__/work-items/migration.test.ts` — 2 files passed, 35/35 tests passed (31 schema/list, 4 migration).
- Full sanitized TypeScript: `node .superpowers/sdd/local-run.cjs node_modules/typescript/bin/tsc --noEmit` — exit 0, no diagnostics, no `.env` loaded.
- `git diff --check` — exit 0.

## Authored integration evidence (explicitly unrun)

`__tests__/integration/evidence-work-items.test.ts` was authored for these cases: wrong-account composite FK rejection; actor deletion nulling both actor columns while retaining the work item; pulse source deletion retaining the evidence snapshot; concurrent unique insert; and `aeo_app` SELECT/INSERT/UPDATE with DELETE/TRUNCATE denied.

The suite is skipped unless `C9C_WORK_ITEMS_DISPOSABLE_BRANCH_ID` is present. Before fixtures it also requires `TEST_DATABASE_URL`, `C9C_WORK_ITEMS_PROJECT_ID`, and `C9C_WORK_ITEMS_OWNER_ROLE`; rejects the known/provided protected branch IDs and malformed branch IDs; and verifies the live Neon project ID, branch ID, current role, and evidence-work-items table ownership against the exact approved values. It was not run. No database was created, deleted, queried, or mutated, and no migration command ran.

## Self-review and remaining boundaries

Historical migrations 001-040 remain unchanged. No Supabase client import, provider call, secret, environment edit, customer mutation, push, merge, deployment or paid scan was introduced. The reserved `agent-recommendation` source/rule schema values remain inert: recommendation reads, eligibility, saves and UI are deferred pending the user's paid-read/saved-evidence-after-downgrade policy decision. Task 4 must implement raw streamed body caps and final JSONB byte preflight/constraint classification; this task provides the shared limits and database backstop only.

## Review fixes after d1e4a8e

Independent review found two material guard issues and one inaccurate test scope; all are fixed in this follow-up.

- Browser-safe validation: replaced `Buffer.byteLength` in the UI-shared create/edit parser with `TextEncoder().encode(...).byteLength`. A regression temporarily removes global `Buffer`, proves both parsers still execute, and retains the oversized UTF-8 rejection. Node-specific base64url cursor handling moved to `lib/work-items/query.ts`, keeping the UI-shared schema module free of Node globals/imports.
- Integration isolation: `vitest.integration.config.ts` now excludes `__tests__/integration/evidence-work-items.test.ts`, so its global setup cannot provision a branch, overwrite `TEST_DATABASE_URL`, reset a schema or run migrations before the suite's own target guard. `vitest.work-items-integration.config.ts` includes only that suite and has no `globalSetup` or `setupFiles`. The static config regression pins both properties.
- Historical migration check: the migration contract now inspects every numbered migration 001 through 040 changed since base `2e22185`, rather than only glob-like path arguments for 001 and 040.

Review-fix RED: `node node_modules/vitest/vitest.mjs run __tests__/work-items/schema.test.ts __tests__/work-items/migration.test.ts __tests__/config/work-item-integration.test.ts` ran 3 files / 38 tests: 35 passed and 3 failed as intended (browser parser used unavailable Buffer; general config did not exclude the suite; dedicated config was absent).

Review-fix GREEN: the same command passed 3 files / 38 tests. `node .superpowers/sdd/local-run.cjs node_modules/typescript/bin/tsc --noEmit` exited 0 with no diagnostics. `git diff --check` exited 0.

The integration suite was not executed. After separate authorization, manual provisioning, exact migration target review and application of 041, its future invocation is:

`node node_modules/vitest/vitest.mjs run --config vitest.work-items-integration.config.ts`

That command is documented only; it was not run. No database, migration, provider, environment, network, push, merge, deployment or customer action occurred. Recommendation reads/saves/UI remain deferred pending the paid-read and saved-evidence-after-downgrade policy decision.
