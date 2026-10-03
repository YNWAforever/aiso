# AISO remediation candidate release and rollback

This is a concrete review package, not production acceptance or authorization. Audit/main is f49e1bd8951394cf88250b3ea88847d0038db491. Branch is codex/aiso-full-remediation-20261003. The immutable candidate SHA, command exits, discovered/passed/failed/skipped counts, migrations and sanitized artifacts are recorded in `artifacts/aiso/T17/candidate-manifest.json`. Per-task SHAs in the26-row matrix are historical repair commits; exported candidate CSVs bind all21 tasks,26 acceptance groups,19 findings,19 user cases and63 operations to the single final SHA without upgrading their live status.

## What is reviewable

B1–B3 implement all18 code tasks with defect reproduction, regression checks, guarded disposable-DB fixtures and bilingual browser fixtures. Independent review found no remaining Important/Critical code issues after repairing six concurrency/coverage boundaries. These tasks remain待驗收 because hydrated persistence, actual provider/job and human acceptance are incomplete. Isolated app-role execution was authorized and completed for the prior candidate; it does not prove all human operations. T00/T16/T17 remain受阻. Original E01–E20/R01–R07 and archive hash are preserved; old reproduction passes are never repair passes. Original live AUDIT source/draft were not changed.

The review preview is an actual-component fixture gallery using final production CSS and synthetic data. It has no database, authentication cookie, provider call, send/approve action or app-role claim. A remotely authenticated candidate preview still requires an approved isolated binding and matching issuer/session. Branch automatic Vercel deployment is disabled so creating the draft PR cannot inherit an unverified production preview DATABASE_URL.

## Same-SHA candidate checks

Run `npm run lint`, `npm run typecheck`, `REQUIRE_INTEGRATION_TESTS=1 npm test`, `npm run build`, Worker `npm test` and `npm run typecheck`, `node scripts/ci/run-owner-remediation-suites.mjs`, `node scripts/ci/prepare-component-fixtures.mjs`, `npm run e2e -- --list`, and configured ordinary Chromium/mobile/a11y acceptance. Use fixture build variables from `.github/workflows/pr-gate.yml`; never copy production .env.local to the preview. Exact plan commands remain in the acceptance matrix. Default integration excludes the ten exact-target configs; file names in a command do not prove discovery. The owner wrapper executes seven configs with actual positive counts and zero skips. It does not prove aeo_app.

The application-role suites and exact-target wrapper fail closed unless the owner explicitly authorizes synthetic role password setup on the newly registered child. For one approved CI invocation, dispatch this candidate branch with `allow_disposable_role_password=true`; the input defaults false and is honored only for workflow_dispatch. The policy step supplies ALLOW_DISPOSABLE_ROLE_PASSWORD only to integration. An existing explicit AISO_ALLOW_DISPOSABLE_ROLE_PASSWORD=1 repository delegation remains supported, but this run does not create or require a permanent variable. A PR event cannot manufacture the manual approval input. A rejected role hook, skipped tests, excluded files, missing session, missing report or zero discovered tests blocks the all-candidate gate. Owner fixture passes cannot substitute for that gate.

## Exact schema rollout, approval required

Read-only production identity: Neon project weathered-wave-50814522, branch br-square-mountain-az6f82vi, database neondb, runtime role aeo_app. Current configured ledger has52 rows, tip053. Pending054–059 must be inspected and explicitly approved; never mark them baselined to fake application. Names055/056/057 were free at audit/main and existing migration files were not rewritten.

| Migration | Expand behavior | Runtime evidence needed |
| --- | --- | --- |
|054_search_console.sql|Existing connector schema, currently absent in configured production ledger|Flags off; exact constraints/grants and connector compatibility|
|055_source_version_approval.sql|Exact version approval actor/time and constrained app update grants|Same-content approval/no bump, stale conflict, independent agent gate with aeo_app|
|056_onboarding_progress.sql|Persistent intent/client/seed lease|Reload/error resume, trial single start, seed once|
|057_pulse_run_ledger.sql|Frozen manifest/items/append attempts, fencing, guarded grants|Expected denominator including failed/blocked/pending; accepted answers preserved|
|058_pulse_classification_repair.sql|Separate bounded classification retries/history|Raw answer preserved, unknown excluded, negative fallback safe|
|059_prompt_context.sql|Nullable constrained market, no historic backfill|Saved confirmed language/market, frozen new manifest context; legacy repair request unchanged|

On the explicitly approved isolated then production target, inject MIGRATE_DATABASE_URL through the operator secret channel. Run `npm run migrate -- --verify` and `npm run migrate -- --dry-run`; inspect ledger drift and pending hashes. Apply only the approved expand set using the existing migration runner, then rerun verify and read exact columns, indexes, constraints and grants. Do not edit deployed migrations, drop evidence, rewrite historical classifications or repair a missing schema by baselining. Disposable replay/verify/dry-run results are retained in owner-suites; they are not persistent deployment.

## App and Worker rollout, approval required

1. Resolve T00 with deployed Worker version/origin/schedules, target flags/schema and job summaries. Record alias→source SHA and rollback deployment. Current production rollback metadata is READY dpl_3u2uYmVaoLGqGCTSWraVfUZXjzJ2 at f49e1bd.
2. Deploy the approved compatible app SHA with FEATURE_PULSE_ATTEMPTS off. Verify public pages and five tools using actual approved role/session on the same target. Keep Search Console off unless its own migration/OAuth scope is approved.
3. Obtain explicit fixture client, model variants, maximum jobs/cost and test recipient authorization for one controlled run on the approved isolated target. Pause the legacy producer and keep all schedules paused. Verify the exact target/schema/app role, then explicitly enable FEATURE_PULSE_ATTEMPTS=1 on this isolated controlled target before calling the ledger path. No customer mail or external publication. Read frozen manifest, attempts/leases, accepted answers, unknown/classified summaries and alert completeness back. Production remains flag-off until its separate approval; the off path cannot establish ledger acceptance.
4. Switch one producer only. Read the deployed APP_BASE_URL rather than inferring it from legacy defaults. The AISO config has empty crons; enabling three schedules requires approval. Daily repair uses the original run across weeks. No delete-before-insert legacy writer may run alongside the ledger producer. Worker HTTP outcomes are route-attempt evidence, not item-complete jobs.
5. Read actual weekly Pulse and daily branches, last attempted/complete/failed runs, per-brand/item coverage and next due HKT. If a genuine cycle has not happened, retain待驗收. Free no-run and flag-off are separate from scheduler failure.
6. Bind alias/deployment/app SHA, Worker version, migration hashes, flags and all role journeys/job evidence to the same candidate. T17 can be已驗證完成 only after gates pass or the human explicitly signs concrete exceptions.

## Rollback

Stop new acceptance and the sole producer first; preserve active lease/attempt metadata and every accepted answer. Roll back UI/app to a compatible approved deployment while retaining expanded tables, exact approvals, actor/time, drafts and history. No destructive down migration. Once the ledger writer has run, do not restart the old destructive Pulse writer: keep schedules paused until a compatible consumer or forward fix is ready. Rollback of source UI does not revoke/approve agent permission. Each task CSV links its narrower rollback; no AUDIT cleanup is authorized.

## Required external evidence and approvals

Missing: actual Pro role, independent reviewer, account B, new-account session, matching preview issuer, deployed app origin/flags, nonempty production job coverage and bounded provider/email authorization. Actual isolated aeo_app tests and deployed Worker metadata have been obtained; role test scope is recorded separately from human UAT. Google login is already completed. No production plan/admin grant was made.

Automatic approval review initially rejected disposable-role ALTER ROLE and reading child app credentials. The human subsequently explicitly authorized this round's newly created disposable child role tests; only those child operations were performed, with credentials undisclosed and children deleted. That supersedes the earlier local refusal without granting production privileges, permanent CI delegation or future unattended role setup. The reviewable package can be approved for specific isolated role/session acceptance separately from production migration, merge, app/Worker deployment, live costs or customer email. No general approval is inferred from accepting this PR.
