# C9 acceptance reconciliation and database proof preparation

Date: 2026-09-07. Source checkout: codex/c10-readiness-audit, 39c1226. C9 application directories and migrations are unchanged from tested application a7cae4fd9005e56991b5a067b38dc980d622d4f9 (verified with git diff).

## Completed local scope

C9a entities, C9b retained observations, C9c evidence-linked opportunities/drafts, C9d immutable reviews/decisions, C9e manual delivery/export and C9f stored outcomes remain implemented. C9f deliberately does not manufacture comparable deltas from legacy evidence; new comparison-capable collection is a separately designed expansion, not an omitted approved task.

Fresh focused run: 37 files / 676 tests passed, exit 0, 17.53 seconds. No integration suites or live provider requests were included:

```text
node .superpowers/sdd/local-run.cjs node_modules/vitest/vitest.mjs run __tests__/lib/entities __tests__/migrations/client-entities.test.ts __tests__/observations __tests__/opportunities __tests__/work-items __tests__/change-sets __tests__/delivery __tests__/outcomes __tests__/api/observations.test.ts __tests__/api/opportunities.test.ts __tests__/api/work-items.test.ts __tests__/api/delivery.test.ts --maxWorkers=2
```

This is focused regression evidence, not a fresh full browser/build result. No application change or independent source review was performed this turn; previous whole-diff reviews remain at their recorded commits.

## Fresh read-only database evidence

Control-plane describe_project and list_branches confirmed AISO project weathered-wave-50814522, organization org-soft-sunset-25251479, PostgreSQL 18, aws-ap-southeast-1. Only branch returned: br-square-mountain-az6f82vi, named production, primary/default, ready. Initial project search lacked required org_id; direct lookup by the recorded project ID succeeded.

Explicit metadata SELECT on neondb returned server project weathered-wave-50814522 and branch br-square-mountain-az6f82vi, current_user neondb_owner; role aeo_app exists. This proves connector owner identity, not the application's live login or grants.

The schema_migrations ledger has the squashed 000 baseline plus historical entries through 039_cron_runs.sql. No 040, 041, 042 or 043 entry exists. Version, decision and delivery-event relations resolve to NULL. The targeted public table inventory also returned no client_entities, client_entity_aliases, evidence_work_items, account_approver_events/state, work_item_versions/decisions or work_item_delivery_events.

This narrows the earlier user-reported 043-applied status: it is not verified on this exact AISO database, and the required schema is absent here. It could refer to another target. No migration was reapplied. No customer records or credentials were read. No database/provider mutation occurred.

## Prepared SQL change set, not executed

Apply only to a separately authorized disposable test target after baseline/schema checks; never substitute the default branch. Local file SHA256:

| Migration | SHA256 |
| --- | --- |
| 040_client_entities.sql | 0898A85907FB86B78F7EA48B63A8840D3EFB73ED4D10D7F2FB267B3949BE321D |
| 041_evidence_work_items.sql | 32639CF4B69FEEF8B5B35003F8E44D6837200104CAACB66C5D7DA2574912879E |
| 042_change_set_approvals.sql | 73B6C01D83693B7B21C04632CFA7CD960480543FB9AD82214AAAA352F279D75A |
| 043_delivery_attestations.sql | A58B40295566E04F1A05236DB5F0401A8D9756926E2E4E792E03955412B11389 |

Suggested disposable branch name: test-c9-proof-20260907. Parent selection is pending: docs/topology-aiso.md permits cloning br-square-mountain-az6f82vi only while it has never held customer data. Current row counts cannot prove that historical condition. Confirm synthetic-only history or select a sterile parent before requesting branch creation. No generic integration setup may run incidentally: it provisions branches and resets schemas.

After the exact disposable branch is approved/created, retain its returned ID and verify project, branch, database and role in-band before any writes. Securely bind C9D_DISPOSABLE_PROJECT_ID/C9D_DISPOSABLE_BRANCH_ID and C9E equivalents to that branch; bind C9D_TEST_DATABASE_URL/C9E_TEST_DATABASE_URL to its owner and C9D_TEST_APP_DATABASE_URL/C9E_TEST_APP_DATABASE_URL to its separate aeo_app role. Never load the application's .env as test authorization. Apply the reviewed missing migration range transactionally and record the exact executed hashes.

Run the existing dedicated suites sequentially:

```text
node node_modules/vitest/vitest.mjs run --config vitest.change-sets-integration.config.ts
node node_modules/vitest/vitest.mjs run --config vitest.change-set-stores-integration.config.ts
node node_modules/vitest/vitest.mjs run --config vitest.delivery-integration.config.ts
```

Require actual executed cases, no skipped suites, and evidence for constraints, account isolation, immutable history, privileges and concurrent store operations. Capture failures without connection strings and repair reproducible code defects locally. Injected serialization/deadlock errors are retry-unit evidence, not actual database-generated deadlocks.

Abort on non-disposable/default/parent identity, unexpected schema/ledger, missing application grants, connection mismatch or unexpected data provenance. Preserve immutable test evidence on failure. Cleanup must target only the created disposable branch after retention review; never drop application tables or delete the parent. No application migration, deployment, scheduler activation or production cutover follows from passing these tests.

## Blocking input

Has br-square-mountain-az6f82vi ever held real customer data, or has it held only synthetic/internal test data? This determines whether the existing topology exception still permits using it as a test parent. Once settled, the exact provisioning/migration/test/disposal action package can be approved as the final external step. C9 local implementation is complete; database acceptance and release remain open.
