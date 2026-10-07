# Reviewable release proposal — no release action executed

Selected implementation: `fbf8f9d209edf5ce47fc01d979c167371ffa2c76`, continuing draft [PR68](https://github.com/YNWAforever/aiso/pull/68). A later documentation-only delivery commit must have the same source/test/config/migration fingerprint. Production remains `f49e1bd8951394cf88250b3ea88847d0038db491`.

## Approved one-run disposable application-role acceptance

The user's subsequent `approve` authorized this section's operation once. Workflow [37550438626](https://github.com/YNWAforever/aiso/actions/runs/37550438626) was dispatched on 2026-10-07 at 00:09:09 UTC against delivery SHA `d0b12b656111c679bdb4be8fcc4105cfe7efa369`, with `allow_disposable_role_password=true`. The delivery contains no source/test/config/migration differences against implementation `fbf8f9d`. The persistent repository authorization variable was absent before and after the invocation and was not set. The actual resolver reported `manual-run`. This permission is consumed and does not authorize another invocation or any production action.

The approved invocation passed: default DB 221/221, including all 22 application-role assertions and four activation regressions; all ten exact-target reports 178/178, including feature-store-tenancy 16/16; unit 5,345/5,345; browser fixtures 902/902; Worker 8/8; static/build checks passed. Required test failures and skips were zero. Both fresh children (`br-autumn-frost-azqt6dym`, `br-solitary-bread-az47x3vg`) have logged deletion receipts and were absent in a subsequent read-only Neon listing. Provenance binds both children to project `weathered-wave-50814522`, the actual run/attempt and checkout SHA. See `evidence/approved-ci.json` and `approved-ci-addendum.md`. These disposable/fixture results do not close normal-session UAT, production rollout or real scheduling acceptance.

Proposed operation: manually dispatch `.github/workflows/pr-gate.yml` on `codex/aiso-full-remediation-20261003` after verifying its head equals the delivery SHA and its implementation fingerprint equals the selected SHA, with `allow_disposable_role_password=true` for that invocation only. Capture the actual run ID and checkout SHA. Do not set the persistent `AISO_ALLOW_DISPOSABLE_ROLE_PASSWORD` repository variable.

Target: fresh test branches created by the existing guarded wrappers in Neon project `weathered-wave-50814522`; database `neondb`. The existing guard must prove a fresh disposable child with the registered provenance and never the parent `br-square-mountain-az6f82vi`. The only privilege action proposed is the wrapper's synthetic `aeo_app` password setup on those fresh children. No existing branch's roles or credentials may be changed.

Acceptance: the default DB suite's 22 role assertions execute with no required skips, and `scripts/ci/run-exact-target-suites.mjs` positively discovers all ten configurations, including `feature-store-tenancy`, and reports actual counts. Download and read every report. Owner-only suites are useful independent coverage, but do not replace the application-role gate. Missing credentials, guard failure, absent reports, skipped assertions or zero discovery keep the release gate closed.

Rollback/cleanup: wrappers delete only their registered disposable children in `finally`; record branch IDs and deletion receipts. If cleanup fails, retain the receipt and propose the exact leftover child for review. Do not clean up unrelated branches. Existing secrets remain in their existing authorized environment and must not enter artifacts. No provider run, email, production migration, merge, deployment, activation/revocation, or scheduling is included in this authorization.

The role guard and the user's explicit privilege-change boundary required the separate approval now recorded above. The prior pack's one-run permission remains historical and cannot authorize a further invocation. A separate automatic-review rejection concerned cleanup of the executor's temporary local import without a complete inventory/backup. Every file was subsequently inventoried and backed up before retrying; that event does not authorize role changes or production cleanup.

## Normal-session preview acceptance

Before real UAT, supply/verify an isolated AISO deployment's exact deployment ID, Git SHA, origin, app-bound Neon branch/database/runtime role, and Neon Auth issuer. These values are currently missing; do not substitute production or fabricate a target. Provisioning accounts, assigning reviewer roles, sending magic-link email, paid provider execution or approving/revoking sources needs a separately scoped authorization if not already granted.

Use a human-captured normal Google/magic-link session through `npm run e2e:auth:capture` and the existing `npm run e2e:authenticated -- tests/e2e/authenticated/aiso-maintenance.spec.ts`. The session file is private and excluded from the evidence package. Fixtures and SDK mocks do not satisfy this gate.

Actors required by the acceptance matrix: owner A with Free and Pro flows, independent reviewer, owner B in a separate tenant, and a new signup. Verify actual persisted source versions, tenant denials, concurrent approval/revision behavior, onboarding recovery, pagination, maintenance, and real Auth renewal/expiry/revocation. Record exact operations UC01–UC22 / OP01–OP67 and AC01–AC36 with fixtures and human operations distinguished. Long same-path activity remains an explicit boundary: the pathname-triggered refresh does not establish API-only renewal. A human renewal/expiry observation is still required.

## Proposed production rollout after every prerequisite is satisfied

Target identities observed read-only:

- Repository/main: `YNWAforever/aiso`, `f49e1bd8951394cf88250b3ea88847d0038db491`.
- Vercel AISO project: `prj_f9sxRkT1gxcBSYgT7ELIwHWqUDDV`; live alias `aiso-kappa.vercel.app`; current deployment `dpl_3u2uYmVaoLGqGCTSWraVfUZXjzJ2`.
- Neon control-plane branch: project `weathered-wave-50814522`, `br-square-mountain-az6f82vi`, `neondb`. The connector's `neondb_owner` role does not prove the application's binding or runtime role. Those bindings must be verified before any migration.
- Cloudflare account `e387dfbeded3deb5b8f0023a78a660b5`, Worker `aiso-cron-worker`; deployment `9ee2db8b-fc56-4ff9-a8cf-32eacbe3172b`, version `2546d97d-edb8-4a16-a257-2b7750ef8af8` at 100%. Current schedules and bindings are empty. The module hash is `a178d5b14fd16bac26bf5def39c1e16445c7595573ba2ac5c6dcc33a5a8048bf`.

The live migration ledger has 52 entries ending at `053_client_domain_verification.sql`; 054–059 are absent. No new migration is needed for T21/T23. The candidate's existing expansion files are:

| File under `supabase/migrations/` | SHA-256 |
|---|---|
| 054_search_console.sql | 29aec3b2d74f4edf4b18c34cc510c97b7ac0871829f184cf5db80e6c35713560 |
| 055_source_version_approval.sql | 9e2b9db361f8d0f03bc5a55b5a1835d6ba268c6841173ed5e6d61471bb22fc0e |
| 056_onboarding_progress.sql | 5726b4ff324746a8a6622739a1c13e525f1496100fff9e73c227c5dde5f7d0ae |
| 057_pulse_run_ledger.sql | ecfde989827b869a9cf5db7ab3f0fe594ac58164363d34bbab2f6a85c92ac571 |
| 058_pulse_classification_repair.sql | e5ce6822385e1f8e1320b170d7e01848fc620b1abb69d270247f85b9d027acac |
| 059_prompt_context.sql | 09ab7c4bf41b37009676d754af0b4312c7a66e0abc9208f5492f15eda27f306a |

Separate approvals must name the exact target, delivery SHA, operations and rollback for each stage:

1. Read-only `npm run migrate -- --verify` and `--dry-run` against the verified app-bound database, plus flags, runtime role, producer ownership and backup/restore readiness. Disposable replay already passed; that does not establish the production target. Stop on drift, a legacy migration baseline conflict or unexplained checksums. Do not force-baseline the ledger.
2. Apply only the reviewed pending expansion using the existing migrator after explicit production migration authorization. Preserve historical scans, approval events, successful answers and immutable audit content. Record the ledger before/after.
3. Merge/deploy the reviewed delivery SHA to the verified AISO project only after explicit merge/deploy authorization. Match deployment SHA, source fingerprint, DB binding and normal-session UAT. Keep producers paused while checking compatibility.
4. Review the exact `cloudflare/aiso-worker/wrangler.jsonc` target with `APP_BASE_URL=https://aiso-kappa.vercel.app` and `crons=[]`. Never deploy the legacy default Fimmick config. Only one authorized producer may own each job. Worker deployment and subsequent schedule changes each need a reviewed operation and explicit authorization.
5. Approve a bounded controlled run only after naming tenant/brand/items, models, provider budget, deadline, retry cap, email policy, source permissions and stop conditions. None of those production run values is invented in this proposal. A valid model score is not consumer/search visibility evidence.
6. After separately approving schedules, observe the actual daily and weekly firing windows and persisted coverage. Planned source schedules translate to Monday 12:17 HKT (Pulse), Monday 15:47 HKT (alerts), and daily 17:00 HKT (repair/trials). Current schedules are empty, so current next due time is null. Search Console scheduling needs a verified owner/flag/producer plan. A forced invocation or HTTP 200 cannot replace actual scheduled coverage.

## Rollback and stop conditions

Stop for cross-tenant exposure, unavailable metrics becoming definite repairs, auth renewal faults, wrong application/database identity, destructive history changes, duplicate producers, unexplained cost/coverage, or missing required evidence.

First pause/disable the affected producer and feature through its reviewed control, preserving audit rows and completed Pulse items. Roll application traffic back to deployment `dpl_3u2uYmVaoLGqGCTSWraVfUZXjzJ2` / SHA `f49e1bd` only after checking compatibility with the expanded schema. Retain expansion tables and migration history; do not DROP tables or erase approvals/answers. An old destructive Pulse writer must not run after new-ledger commits. For a Worker change, restore the recorded version and empty schedules, with target bindings checked. Cleanup of existing production AUDIT content is a separate exact-content proposal and is not part of rollback.

Production acceptance remains open until authorized rollout, matching normal-session UAT, application-role acceptance, and actual required scheduling windows are evidenced.
