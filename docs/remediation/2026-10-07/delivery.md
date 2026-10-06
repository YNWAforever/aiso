# AISO implementation delivery — 2026-10-07 HKT

Implementation SHA: `fbf8f9d209edf5ce47fc01d979c167371ffa2c76`. Continuing [draft PR68](https://github.com/YNWAforever/aiso/pull/68). This delivery contains implementation and independent verification; production is not rolled out or fully accepted.

## Changes

T21 activation derives the earliest actual tenant-owned source-version approval, retaining that event across repeat approval, later versions and withdrawal. T23 rejects invalid provider metrics, preserves unavailable values and deterministic counts, excludes unavailable/legacy data from confirmed priorities and impact, discloses partial evidence, preserves historical scanner registries and aligns bilingual GEO heuristics. T22's existing auth repair was validated in fixtures and retained. Worktree browser discovery and explicit non-applicability were repaired after actual failures reproduced.

Focused implementation commits: `91d41be` (activation), `5502ed9` (GEO/provider/history), `793d919` (discovery), `5df8823` (partial disclosure), `e682197` (local heuristic copy), `fbf8f9d` (non-applicability/fixture provenance). Existing candidate fixes and unrelated original-checkout work were preserved.

## Measured verification

| Environment and gate | Actual result |
|---|---|
| Final local `npm run test:unit` | 373 files; 5,345 passed; 0 failed/skipped; exit 0 |
| Final static checks and synthetic production build | Typecheck, lint, build: exit 0 |
| Worker own lockfile/scripts | 8 passed; 0 failed/skipped; typecheck exit 0 |
| Final guarded default DB | 22 files; 199 passed, 22 skipped; failed role hook; exit 1; disposable child deleted |
| Seven final independent owner DB configs | 69 passed; 0 failed/skipped; exit 0; disposable child deleted; not application-role acceptance |
| Final local focused browser | 106 Auth/result/priority cases plus 8 account-unlock cases passed; 0 failed/skipped; synthetic providers/Auth/email |
| Final CI browser, reports read from all four shards | 902 passed; 0 failed/skipped/flaky; source-identical synthetic merge checkout |
| Final CI gate | Failed: default application-role hook and exact-target wrapper remain blocked by the authorization guard |
| Normal authenticated UAT | Startup blocked by missing isolated issuer and captured human session; zero assertions, not a pass |

CI [37524256754](https://github.com/YNWAforever/aiso/actions/runs/37524256754) checked out `716a7a2f352dde1874e9f2a165f797b6baf1f856`, whose parents are main f49e1bd and implementation fbf8f9d. GitHub comparison showed zero file differences against fbf8f9d. A later documentation-only delivery commit has separate identity and current CI status; it must not be presented as the commit that ran these tests.

Earlier RED/failed/skipped runs remain in the receipts. Counts are not summed across overlapping runs. The ten excluded exact-target configs are still an unfulfilled release gate, even though seven owner-only configs independently passed. No role authorization flag was self-set. Model scores, fixtures, zero cron rows and HTTP success do not establish real search/consumer visibility or scheduling health.

## Review files

- `AISO-Codex-execution-register-2026-10-07.csv`: all 24 task rows; original fields retained, current execution fields populated.
- `AISO-Codex-acceptance-matrix-2026-10-07.csv`: all 36 acceptance rows, with historical and execution fields separate.
- `baseline/` and the findings/repair/case/operation `*-execution.csv` files: F01–F22, T00–T23, UC01–UC22 and OP01–OP67 retained with appended current results.
- `evidence/command-receipts.json`, `task-coverage.json`, `ci-reports.json`: commands, actual exits/counts, timestamps, environments, SHA, role, cleanup and artifact hashes.
- `evidence/runtime-readback.json`, `worker-runtime.json`, `job-inventory.json`: read-only runtime identity and explicit unknowns.
- `execution-ledger.md`, `self-review.md`, `rollout-rollback-proposal.md`: drift, review findings, blockers and concrete next operation/rollback.
- `SHA256SUMS.input`: original input manifest. `SHA256SUMS.execution`: current documentation manifest. The ZIP's own hash is supplied alongside it, outside that ZIP.

The redacted delivery ZIP includes these documents plus measured reports/logs and a focused source diff. Immutable private audit input, human session files, raw environment files and credential material are excluded. All JSON reports are structurally redacted and re-parsed; counters are retained. Local `.gitattributes` preserves the exact documentation bytes across operating systems. The source fingerprint describes the tested Windows working-file bytes; Git commit/tree comparisons establish source identity independently of checkout line endings.

## Remaining gates and next operation

Production is still main f49e1bd at `aiso-kappa.vercel.app`; the migration ledger ends at 053 and the AISO Worker has empty schedules/bindings. Application binding/role, flags, other producer ownership and successful coverage are unknown. Current next due time is null.

The next proposed operation is a single explicitly authorized disposable-role CI workflow invocation, scoped to its fresh guarded Neon children; see `rollout-rollback-proposal.md`. Then complete normal-session role/tenant/onboarding/Auth timing UAT on a verified isolated target. Production migrations, merge/deploy, controlled provider runs, source approval/revocation, email, scheduler enablement and any existing-content cleanup remain separate approval gates. Matching authorized rollout and actual daily/weekly scheduling windows are required before closing production status.
