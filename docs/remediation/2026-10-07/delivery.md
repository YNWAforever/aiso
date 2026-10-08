# AISO implementation delivery — 2026-10-07 HKT

Latest continuation: [uat-execution-addendum.md](./uat-execution-addendum.md). Operator commit a6c2f2c accepts standard Vercel Preview metadata and rejects custom environments; focused 102/102 and full unit 5,348/5,348 passed. The authorized dedicated Preview serves d1aecce with verified fresh Neon `aeo_app` binding. Human capture timed out at Vercel login; normal-session, full readiness and production acceptance remain open. Historical counts below retain their original tested SHA and environment.

Implementation SHA: `fbf8f9d209edf5ce47fc01d979c167371ffa2c76`. Continuing [draft PR68](https://github.com/YNWAforever/aiso/pull/68). This delivery contains implementation and independent verification; production is not rolled out or fully accepted.

The subsequent one-run disposable-role approval has been executed and verified at documentation delivery SHA `d0b12b656111c679bdb4be8fcc4105cfe7efa369`. [CI 37550438626](https://github.com/YNWAforever/aiso/actions/runs/37550438626) passed with 221 default DB and 178 exact-target assertions, no failures/skips, and both disposable children deleted. Its actual checkout SHA and approval scope are retained in `evidence/approved-ci.json`; see `approved-ci-addendum.md` for the complete report inventory.

## Changes

T21 activation derives the earliest actual tenant-owned source-version approval, retaining that event across repeat approval, later versions and withdrawal. T23 rejects invalid provider metrics, preserves unavailable values and deterministic counts, excludes unavailable/legacy data from confirmed priorities and impact, discloses partial evidence, preserves historical scanner registries and aligns bilingual GEO heuristics. T22's existing auth repair was validated in fixtures and retained. Worktree browser discovery and explicit non-applicability were repaired after actual failures reproduced.

Focused implementation commits: `91d41be` (activation), `5502ed9` (GEO/provider/history), `793d919` (discovery), `5df8823` (partial disclosure), `e682197` (local heuristic copy), `fbf8f9d` (non-applicability/fixture provenance). Existing candidate fixes and unrelated original-checkout work were preserved.

## Measured verification

| Environment and gate | Actual result |
|---|---|
| Final local `npm run test:unit` | 373 files; 5,345 passed; 0 failed/skipped; exit 0 |
| Final static checks and synthetic production build | Typecheck, lint, build: exit 0 |
| Worker own lockfile/scripts | 8 passed; 0 failed/skipped; typecheck exit 0 |
| Guarded default DB before subsequent approval (history) | 22 files; 199 passed, 22 skipped; failed role hook; exit 1; disposable child deleted |
| Approved default DB at d0b12b6 | 22 files; 221 passed; 0 failed/skipped; exit 0; all 22 application-role assertions executed; child deleted |
| Approved exact-target wrapper at d0b12b6 | Ten configurations/reports; 178 passed; 0 failed/skipped; exit 0; feature-store-tenancy included; child deleted |
| Seven final independent owner DB configs | 69 passed; 0 failed/skipped; exit 0; disposable child deleted; not application-role acceptance |
| Final local focused browser | 106 Auth/result/priority cases plus 8 account-unlock cases passed; 0 failed/skipped; synthetic providers/Auth/email |
| Final CI browser, reports read from all four shards | 902 passed; 0 failed/skipped/flaky; source-identical synthetic merge checkout |
| CI gate before subsequent approval (history) | Failed: default application-role hook and exact-target wrapper blocked by the authorization guard |
| Approved CI gate at d0b12b6 | Passed: all ten jobs; actual reports read; 5,345 unit, 902 fixture-browser, 221 default DB and 178 exact-target assertions passed |
| Normal authenticated UAT | Startup blocked by missing isolated issuer and captured human session; zero assertions, not a pass |

CI [37524256754](https://github.com/YNWAforever/aiso/actions/runs/37524256754) checked out `716a7a2f352dde1874e9f2a165f797b6baf1f856`, whose parents are main f49e1bd and implementation fbf8f9d. GitHub comparison showed zero file differences against fbf8f9d. A later documentation-only delivery commit has separate identity and current CI status; it must not be presented as the commit that ran these tests.

Earlier RED/failed/skipped runs remain in the receipts. Counts are not summed across overlapping runs. The later explicitly approved invocation fulfilled the disposable application-role and ten excluded exact-target gates. No persistent role authorization flag was set; the manual input applied once. Model scores, fixtures, zero cron rows and HTTP success do not establish real search/consumer visibility or scheduling health.

## Review files

- `AISO-Codex-execution-register-2026-10-07.csv`: all 24 task rows; original fields retained, current execution fields populated.
- `AISO-Codex-acceptance-matrix-2026-10-07.csv`: all 36 acceptance rows, with historical and execution fields separate.
- `baseline/` and the findings/repair/case/operation `*-execution.csv` files: F01–F22, T00–T23, UC01–UC22 and OP01–OP67 retained with appended current results.
- `evidence/command-receipts.json`, `task-coverage.json`, `ci-reports.json`: commands, actual exits/counts, timestamps, environments, SHA, role, cleanup and artifact hashes.
- `evidence/approved-ci.json`, `approved-ci-addendum.md`: actual one-run authorization, all ten exact-target reports, role/activation slices, branch provenance and independent post-cleanup readback. Appended CSV columns preserve earlier execution results and superseded blockers.
- `evidence/runtime-readback.json`, `worker-runtime.json`, `job-inventory.json`: read-only runtime identity and explicit unknowns.
- `execution-ledger.md`, `self-review.md`, `rollout-rollback-proposal.md`: drift, review findings, blockers and concrete next operation/rollback.
- `SHA256SUMS.input`: original input manifest. `SHA256SUMS.execution`: current documentation manifest. The ZIP's own hash is supplied alongside it, outside that ZIP.

The redacted delivery ZIP includes these documents plus measured reports/logs and a focused source diff. Immutable private audit input, human session files, raw environment files and credential material are excluded. All JSON reports are structurally redacted and re-parsed; counters are retained. Local `.gitattributes` preserves the exact documentation bytes across operating systems. The source fingerprint describes the tested Windows working-file bytes; Git commit/tree comparisons establish source identity independently of checkout line endings.

## Remaining gates and next operation

Production is still main f49e1bd at `aiso-kappa.vercel.app`; the migration ledger ends at 053 and the AISO Worker has empty schedules/bindings. Application binding/role, flags, other producer ownership and successful coverage are unknown. Current next due time is null.

The one approved disposable-role CI workflow invocation is complete. The next acceptance step is normal-session role/tenant/onboarding/Auth timing UAT on a verified isolated target; the exact deployment/database/issuer identity and captured human sessions are still missing. See `rollout-rollback-proposal.md`. Production migrations, merge/deploy, controlled provider runs, source approval/revocation, email, scheduler enablement and any existing-content cleanup remain separate approval gates. Matching authorized rollout and actual daily/weekly scheduling windows are required before closing production status. A later documentation-only head is source-identical but is not the SHA that executed this privileged invocation; a new run cannot inherit its one-time approval.

## 8 October maintenance acceptance follow-up

The preceding startup and CI descriptions are historical. The isolated Preview/DB/Auth issuer, real Google user profile/account and approved owned navigation client now exist. The human reported that the portfolio dashboard loads. Genuine captured storage state, an actual foreign-tenant client/reviewer fixture and the direct Entities heading/error observation remain missing; browser automation fails before tab/DOM access. No automated normal-session assertion has run.

Commit `b0c1c4403126ff861dffef7393233f3799fdcf91` repairs a reproduced acceptance-runner defect: `/entities` was a nonexistent API path whose fallback 404 could be counted as tenancy denial. The runner uses `/entity`, establishes five matching owned 200 JSON reads and checks exact foreign ownership-only error bodies. Focused RED was 1 passed/8 failed of 9; GREEN was 9 passed. The required `npm run test:unit` gate measured 374 files and 5,357 passed assertions, zero failures/skips. Lint and the verified typecheck retry passed. Initial zero-test sandbox cache failures and an exit-0 native compiler access error remain recorded as invalid attempts. Test fixtures do not establish real Auth or tenancy acceptance.

Five bounded operator SELECTs on the approved UAT `aeo_app` binding succeeded with empty fixture data; all 11 identity/state checks passed. These are table/column access checks, not full service/API/browser UAT. The current trackers retain all 7,466 preceding release-review cells and all 24/36 IDs. See [maintenance-runner-addendum.md](./maintenance-runner-addendum.md) and [the measured receipt](./evidence/maintenance-runner.json). Application, migration and Worker source still matches deployed UAT `d1aecceb3f0680d4e03b7aad9dd2f84f9b5ac9cb`; the acceptance runner itself changed. No new role authority, privileged CI invocation, build/deployment, provider/email operation or production change was performed. Production acceptance remains open.
