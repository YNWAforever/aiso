# C9 disposable PostgreSQL proof

Date: 2026-09-07. Starting source: 511edbd on codex/c10-readiness-audit. Application source remains a7cae4fd; this run changes only five SQLSTATE test expectations. User confirmed the AISO parent has held only synthetic test data and explicitly approved branch creation, migrations 040-043 and the three dedicated suites.

## Exact executed target

- Project: weathered-wave-50814522 (AISO), PostgreSQL 18.
- Parent: br-square-mountain-az6f82vi, production; never used for fixture writes.
- Created child: br-hidden-hill-az61ux9z, test-c9-proof-20260907, nondefault/nonprimary.
- Created at: 2026-09-07T04:48:30Z.
- Database: neondb. Owner: neondb_owner. Separate application login: aeo_app.
- Compute request: 0.25 CU minimum/maximum. Optional 300-second suspend setting was rejected with HTTP412; branch absence was confirmed before retrying without that setting. No expiry/deletion was configured.

Both suites requiring application login verified owner/application project and branch identities before writing fixtures. The migration connection independently verified project, child branch, database and current_user on the same session used for DDL. Connection strings were fetched only for this child and passed through no-echo stdin into a token-free local helper; never saved in files, command arguments or git. The helper supplied dedicated test variables only, without loading application environment files. It exited after tests and session credential references were cleared.

## Migrations

Applied 040_client_entities.sql, 041_evidence_work_items.sql, 042_change_set_approvals.sql and 043_delivery_attestations.sql sequentially, each with its ledger insert in one transaction. Byte hashes matched the approved package in 2026-09-07-c9-acceptance-reconciliation.md. Fresh child-ledger readback confirmed all four filenames/checksums. No existing migration was edited or reapplied.

Post-run parent metadata readback confirmed branch br-square-mountain-az6f82vi still has zero ledger entries at/after040, no work_item_versions and no work_item_delivery_events. This verifies the C9 schema changes stayed on the child; no broad assertion about unrelated concurrent activity is made.

## Executed SQL suites

| Configuration | UTC start | UTC end | Exit | Result |
| --- | --- | --- | --- | --- |
| vitest.change-sets-integration.config.ts | 04:52:23.186 | 04:52:27.759 | 0 | 21 passed |
| vitest.change-set-stores-integration.config.ts | 04:50:31.546 | 04:50:45.910 | 0 | 15 passed |
| vitest.delivery-integration.config.ts | 04:52:27.761 | 04:53:20.062 | 0 | 67 passed |

Total: 103 actual PostgreSQL tests passed, no skipped cases. Exact command for each row: `node node_modules/vitest/vitest.mjs run --config <configuration>`, launched sequentially with the approved child-only C9D/C9E bindings. These cover immutable histories, tenant/hash constraints, application grants, audit/state atomicity, actual overlapping store requests, delivery replay/correction, time bounds and pagination. Serialization/deadlock retry cases inject 40001/40P01 at orchestration boundaries; they do not claim database-generated deadlocks.

## Reproduced failures and repair

Initial approvals run: 20 passed/1 failed. Initial delivery run: 66 passed/1 failed. Both expected23503 when deleting a referenced parent; PostgreSQL18 returned23001, correctly refusing ON DELETE RESTRICT. Changed only five DELETE expectations to23001. INSERT foreign-key mismatch expectations remain23503. No application or schema behavior was changed. The full affected suites passed after the correction.

PostgreSQL distinguishes restrict_violation23001 from foreign_key_violation23503: [official error-code reference](https://www.postgresql.org/docs/16/errcodes-appendix.html). The actual PostgreSQL18 result and ON DELETE RESTRICT migration clauses are the primary evidence for these exact assertions.

Scoped ESLint on the two edited suites passed. Full `tsc --noEmit` through the dummy-local runner passed. git diff --check passed. No browser/build rerun was needed for test-only changes. The earlier 676 focused unit tests are evidence from the immediately preceding reconciliation turn, not rerun here.

Sanitized local raw logs and UTC command metadata: `.superpowers/sdd/c9-proof-vitest.{change-sets,change-set-stores,delivery}-integration.{log,json}`. Initial failures retained separately as `c9-proof-approvals-red.{log,json}` and `c9-proof-delivery-red.{log,json}`. These ignored files are local evidence; this committed summary is the portable record.

## Scope and retention

The three previously unrun C9d/C9e SQL suites now have passing isolated PostgreSQL evidence. This does not prove Vercel environment bindings, application production migration/release, C1 full schema equivalence, the generic C9a/C9c integration harness, live browser/database end-to-end behavior, provider health or new comparison-capable evidence collection. C9f remains read-only stored-outcomes.v1 with its existing comparability limits.

The child branch and synthetic test history are retained for review. No deletion is authorized by this run. Proposed cleanup after evidence retention: verify exact project, child ID/name and nondefault status, then delete only br-hidden-hill-az61ux9z. Do not delete/reset the parent or drop immutable history tables on the application target.

No real email, paid scan, Worker activation, Vercel deployment, parent migration, production cutover, push or merge occurred.

## Independent review

A read-only reviewer approved the bounded five-assertion diff and independently inspected both initial failure logs, all final passing logs and exact-target metadata. No actionable findings. The reviewer confirmed that the result is specific to this PostgreSQL target, not a cross-version or production acceptance claim.
