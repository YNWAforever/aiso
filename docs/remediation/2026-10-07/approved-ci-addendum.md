# Approved disposable-role CI acceptance — 2026-10-07 HKT

The user approved the concrete one-run proposal in `rollout-rollback-proposal.md`. Exactly one workflow invocation was dispatched: [37550438626](https://github.com/YNWAforever/aiso/actions/runs/37550438626), attempt 1, `workflow_dispatch`, checkout/head `d0b12b656111c679bdb4be8fcc4105cfe7efa369`. This documentation delivery has no source/test/config/migration differences against implementation `fbf8f9d209edf5ce47fc01d979c167371ffa2c76`; all 1,128 recorded source-file hashes matched locally.

The invocation used `allow_disposable_role_password=true`. The actual resolver log reported `manual-run`; the persistent repository authorization variable was absent before and after. Only synthetic `aeo_app` password setup on the wrappers' fresh guarded Neon children was authorized. No production role, migration, deployment, scheduler, paid provider, email, source approval/revocation or existing-content cleanup was performed. The permission is consumed.

## Actual reports read

GitHub Actions Ubuntu / Node 24.x. DB tests used the guarded disposable setup in Neon project `weathered-wave-50814522`, database `neondb`, with owner and synthetic application roles. Browser/provider/Auth/email fixtures remain distinct from real user sessions. The invocation's exact commands, successful step exits, timestamps, reports and SHA-256 hashes are in `evidence/approved-ci.json` and the appended run in `evidence/ci-reports.json`. Exit 0 is established by successful Actions steps and the workflow's propagated command exits; each exact-target `ok` receipt requires child status 0 and a positive readable report with no skipped assertions.

| Layer/configuration | Files | Discovered | Passed | Failed | Skipped |
|---|---:|---:|---:|---:|---:|
| Unit contract | 373 | 5,345 | 5,345 | 0 | 0 |
| Default integration | 22 | 221 | 221 | 0 | 0 |
| entity-integration | 1 | 3 | 3 | 0 | 0 |
| work-items-integration | 1 | 5 | 5 | 0 | 0 |
| change-sets-integration | 1 | 22 | 22 | 0 | 0 |
| change-set-stores-integration | 1 | 19 | 19 | 0 | 0 |
| delivery-integration | 1 | 68 | 68 | 0 | 0 |
| first-run-journey-integration | 1 | 4 | 4 | 0 | 0 |
| feature-store-tenancy-integration | 1 | 16 | 16 | 0 | 0 |
| reports-entities-tenancy-integration | 1 | 13 | 13 | 0 | 0 |
| alerts-agents-tenancy-integration | 1 | 8 | 8 | 0 | 0 |
| search-console-integration | 1 | 20 | 20 | 0 | 0 |
| Four browser shards | 4 reports | 902 | 902 | 0 | 0 |

Exact-target total: ten configurations, 178 assertions, zero failures/skips. These ten files are excluded from the default integration configuration, so the two DB layers are distinct. Counts from earlier or overlapping runs are not added to this invocation. The default DB report positively records all 22 least-privilege-role assertions and four activation-approval regressions as passed. Browser shards contain 226, 226, 225 and 225 passed assertions, zero flaky results and zero global errors. Worker own lockfile/scripts: one file, eight tests passed; typecheck passed. Static lint/typecheck and synthetic build passed. All ten Actions jobs, including the aggregate gate, completed successfully. Integration ran from 00:09:13 to 00:35:51 UTC (26m38s), within the existing 30-minute limit; its timeout and guards were not changed.

## Target and cleanup proof

| Scope | Registered child | Created provenance UTC | Cleanup |
|---|---|---|---|
| Default DB | br-autumn-frost-azqt6dym | 2026-10-07 00:09:52.345 | Logged deletion; absent in post-run Neon readback |
| Exact-target wrapper | br-solitary-bread-az47x3vg | 2026-10-07 00:23:20.296 | Logged deletion; absent in post-run Neon readback |

Both provenance records bind project `weathered-wave-50814522`, parent `br-square-mountain-az6f82vi`, run `37550438626`, attempt 1 and checkout `d0b12b6`. Independent control-plane snapshots observed each new child as non-primary, non-default and TTL-expiring. The post-run listing retained the existing production parent and archived historical child; neither newly registered test child remained. No unrelated branch was cleaned up.

## Preserved history and remaining acceptance

All 24 task rows, 36 acceptance rows, F01–F22, UC01–UC22 and OP01–OP67 retain their IDs and historical columns. New `approved_ci_*` fields append this invocation's results; superseded active blockers and isolated results are retained in `pre_approved_ci_*` columns. The previous authorization-blocked runs remain in the JSON receipts. Active T16/T17 and AC20/AC21/AC35 blockers now identify normal-session and rollout evidence, rather than an absent permission for this completed invocation.

This closes the disposable DB/application-role gate at the actual tested SHA. Normal-session UAT still lacks a verified isolated deployment ID/SHA/origin, app-bound DB/runtime role, Neon Auth issuer and captured owner/reviewer/second-tenant/new-signup sessions. Same-path real Auth renewal/expiry/revocation remains unobserved. Production rollout, real providers/search visibility, producer ownership/flags, actual daily/weekly scheduling windows and corresponding live evidence remain open. A subsequent documentation-only commit does not reuse this one-time approval or become the SHA that executed these tests.
