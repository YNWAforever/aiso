# Execution ledger — plan: AISO-Codex-implementation-plan-2026-10-07.md (v2)

Input plan SHA-256: `356111f4149b47c911892769824ea025230dd5c074692322c94e6902e0d2dac2`.
Immutable evidence ZIP SHA-256: `c5ba2f07aee65f1eb72fe4486d92205ab496302f24b7f4382e0540133141189d`.
Input is extracted to `.superpowers/aiso-20261007/input/evidence/`; archive unchanged.

## B0 selection

- Starting GitHub readback: PR68 OPEN/draft, head `6f7b84a0f24e1f4427369ec12e304f618b2f68aa`, main `f49e1bd8951394cf88250b3ea88847d0038db491`. No starting Git SHA drift. The selected implementation is now `fbf8f9d209edf5ce47fc01d979c167371ffa2c76`; the same draft branch was updated by ordinary fast-forward pushes.
- Original checkout is `claude/topical-authority-truncation` at `7f9b283`; its untracked September plan remains untouched.
- The existing candidate checkout is clean, but is owned by another chat. Native attachment refused with that reason. Continuation worktree: `.worktrees/aiso-remediation-20261007`, branch `codex/aiso-remediation-20261007`, based on the exact candidate. Native attachment failure and writable-root boundaries justify the local Git worktree fallback.
- This Windows Git installation treats the linked checkout as bare unless invoked with `-c core.bare=false`. Use that process-only override; do not alter shared Git configuration.
- The repository is already indexed as `aiso-remediation-20261003`; graph reads map to the recorded candidate. Confirm actual files in the continuation checkout before editing.
- Read root instructions, controlling plan, both execution matrices, audit report, E21/E29/E30/E33/E35/E36 and candidate runbooks. Historical CI/UAT results remain historical.

## Rulings and interfaces

- T04→T21: approval is append-preserved version `approved_at`, independent of agent permission/revocation. Derive minimum approval over all owned versions in one statement; no migration/backfill.
- T01/T03→T23: partial evidence is excluded from actionable priority. The compatibility `fail` status must never become a confirmed content failure in rendering, impact or projections.
- T23 registry: explicitly retain September5 and October3 check registries before introducing October7 scanner/c18 versions. Preserve historical signatures/totals; no backfill.
- Input probe code remains in ignored scratch so TypeScript/lint do not discover external audit fixtures as product code. The controlling plan and matrices are tracked separately.
- User instruction overrides artificial RED tests for existing correct work and prohibits subagents. Execute named existing acceptance; write RED regressions only for reproduced gaps. Final branch review will be a separate self-review.
- No production mutation, merge/deploy, job enablement, paid provider request, email, role changes, activation/revocation or production AUDIT cleanup is authorized here. Existing one-off child role authorization in prior author documents is historical, not a new approval flag.

## Progress

- B0: verified the outer pack hash `afbcf69ec46da94f1d95920461f4367135b541fbc8de7f540d919d8a123b8273`, controlling v2 plan and exact nested evidence hash. Input remains in the execution workspace's `.superpowers/aiso-20261007/input/evidence/`. Clean unchanged-candidate baseline: 5,303 assertions in 372 files, exit 0. The pack's synthetic R08/R09 probes both pass against unchanged 6f7b84a, confirming defects rather than acceptance. Successful `npm ci` retained the lockfile. Early ENOSPC/temp-permission attempts were not acceptance gates.
- B1: inspected T04/T01/T03 dependencies before new code. T21 derives actual tenant-owned version approval; four real disposable-DB regressions passed. T23 validates provider payloads, retains unavailable metrics and both historical registries, projects honest owner/public/impact evidence, and aligns bilingual local-heuristic copy. T14/T22's existing SDK/Auth contracts passed; no remaining auth code fault reproduced, so auth implementation was preserved. Human login and real renewal remain blocked.
- B2: reused implemented T01–T20. Full unit gate covers every named unit file; `evidence/task-coverage.json` maps the task commands to measured file/assertion results. Final unit gate: 5,345/5,345 assertions, 373 files, no failures/skips, exit 0. Typecheck, lint and synthetic-bound production build passed. Worker own lockfile/scripts: 8/8 assertions, plus typecheck, exit 0.
- B3: final guarded default DB discovered 221 assertions in 22 files: 199 passed, 22 skipped under a failed role hook; exit 1. All 21 independent files passed, including approval, source, onboarding, Pulse, prompt context, domain and reviewer fixtures. Child `br-small-surf-az5a34c8` was deleted. The exact-target wrapper refused before creating a branch or changing a role: zero assertions, a blocked gate. No approval flags were self-set. Seven independent owner configurations passed 69/69 assertions on final implementation after one serial retry; child `br-empty-band-azer2xp2` was deleted. This is `neondb_owner` evidence, not `aeo_app` acceptance. The first retry attempt stopped at a CLI auth timeout before any branch was created; retained separately.
- B4: local discovery found 902 tests in 32 files after the worktree exclusion repair. The broad earlier compiled-SHA run found 888 passes, 8 priority failures and 6 skipped email fixtures; exit 1. The priority failure reproduced an explicit non-applicability fault plus absent fixture provenance, both corrected. A fresh final-SHA build/fixture renderer passed, followed by 106/106 affected Auth/result/priority browser cases and 8/8 mocked account-unlock cases, no failures/skips. The six earlier email skips resulted from absent legacy synthetic fixture markers; satisfying the existing fixture prerequisites did not use a Supabase project or send email. Four current CI browser shards and actual reports are indexed separately in `evidence/ci-reports.json`; no author-reported counts are reused.

## Runtime and drift

Live Vercel remains deployment `dpl_3u2uYmVaoLGqGCTSWraVfUZXjzJ2`, AISO project `prj_f9sxRkT1gxcBSYgT7ELIwHWqUDDV`, alias `aiso-kappa.vercel.app`, source/main `f49e1bd`. The primary Neon connector has 52 migrations through 053; 054–059 are absent and cron_runs has zero rows. The app's database binding/runtime role and feature flags are not established by the owner connector.

Read-only Cloudflare evidence identifies `aiso-cron-worker` in account `e387dfbeded3deb5b8f0023a78a660b5`, live version `2546d97d-edb8-4a16-a257-2b7750ef8af8`. Actual schedules and bindings are empty; module SHA-256 is `a178d5b14fd16bac26bf5def39c1e16445c7595573ba2ac5c6dcc33a5a8048bf`. Scheduling is disabled; APP_BASE_URL, other producer ownership and successful coverage remain unknown. Named ROUTES constants are not enabled schedules. Current next due time is null.

CI runs on synthetic PR merge checkouts. The final implementation's checkout `716a7a2f352dde1874e9f2a165f797b6baf1f856` has parents main f49e1bd and fbf8f9d; GitHub comparison found zero file differences against fbf8f9d. Previous e682197 CI also used a source-identical merge; its eight failures are retained, not overwritten by the final result. A later docs-only delivery SHA must preserve the implementation fingerprint and is distinguished from the tested implementation SHA.

## Current acceptance and permission boundaries

All 24 task IDs, 36 acceptance IDs, 22 finding IDs, 22 case IDs and 67 operation IDs remain present. Original status/results/SHA/history fields are unchanged; the current execution fields and full baseline CSV copies are separate. AC27/28/29/34 are verified in their named fixture/disposable environments. Other required normal-session/rollout acceptance remains partial or blocked. No UC/OP normal journey is relabelled passed from a related fixture.

Missing evidence: isolated deployment/issuer and captured human owner session; Free/Pro/reviewer/B/new-signup normal persisted journeys; real Auth renewal/expiry/revocation, including long same-path behavior; application-role authorization plus all ten exact-target configs; verified app DB/role/flags/producer binding; authorized production migration/deployment/controlled run; actual required daily/weekly windows. Production stays open.

The reviewable next operation is the one-run disposable-role workflow invocation in `rollout-rollback-proposal.md`. It requires the user's explicit privilege authorization. Production actions require separate exact-target approvals. No production mutation, paid provider request, email, activation/revocation, scheduling or production AUDIT cleanup occurred.

## Local preservation and cleanup

The original checkout's unrelated September plan remains untouched. The executor's duplicate temporary import initially failed automatic approval review because one ZIP hash was not a full directory backup. All 142 files were then inventoried and copied to ignored `.superpowers/aiso-20261007/root-import-backup/`, with every SHA-256 verified. A second safety check confirmed the exact unchanged file set, backup hashes, intended absolute target and absence of tracked content before cleanup was allowed. Original checkout status now contains only the user's pre-existing September plan. This was local executor-created content; no existing production audit content was cleaned up.

Redacted structured JSON reports preserve valid JSON and measured counters; logs are redacted separately. Secrets, human session files, raw environment values and downloaded private audit input are excluded from the delivery ZIP. The input manifest describes the original package; the execution manifest describes the delivery.

## Subsequent explicitly approved invocation

The user's `approve` authorized the concrete disposable-role operation above once. [Run 37550438626](https://github.com/YNWAforever/aiso/actions/runs/37550438626), attempt 1, executed at delivery/checkout `d0b12b656111c679bdb4be8fcc4105cfe7efa369`, source-identical to implementation `fbf8f9d`. The actual resolver reported `manual-run`; no persistent repository approval variable was set. All ten jobs passed. Actual report counts: 5,345 unit; 902 fixture browser; 221 default DB, including all 22 least-privilege assertions and four activation regressions; 178 assertions across all ten excluded exact-target configurations. Required failures/skips/flaky browser results were zero. Worker own scripts passed eight tests and typecheck; static/build checks passed. Integration elapsed 26m38s without changing its 30-minute timeout or guards.

Default child `br-autumn-frost-azqt6dym` and exact-target child `br-solitary-bread-az47x3vg` have run/SHA/project-bound provenance, logged deletion receipts and independent post-run absence in Neon. Only registered fresh children were changed/deleted; the existing parent and archived historical child remain. Every exact-target report, including feature-store-tenancy, was downloaded, structurally redacted, parsed and measured. The successful gate summary is supplementary to the actual test reports.

`evidence/approved-ci.json` and `approved-ci-addendum.md` supersede the earlier absent-authorization blocker for this invocation only. All previous JSON CI receipts remain unchanged. Appended CSV fields retain the earlier execution values and superseded blockers; 4,312 previous field values and all 24/36/22/24/22/67 row sets were compared against d0b12b6. Production, normal-session UAT, live providers/search visibility and actual scheduling windows remain open. The approval is consumed; a documentation-only follow-up does not authorize a new privileged run. No implementation or auth amendment was required.
