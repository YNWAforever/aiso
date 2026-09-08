# C11 AISO release-readiness dossier

Date: 2026-09-07. Decision: NOT READY FOR RELEASE OR CUSTOMER WRITES.

## Release identity

- Candidate application/source: d13110f, codex/c10-readiness-audit. Separate reviewed tooling repair:9aaf413.
- Current GitHub main and AISO production source:10d9a17cd6292a0534edf4fd532760a8de9ea454.
- Vercel target: team_qvzlsFmfCsLkgItSypqHjw3z / prj_f9sxRkT1gxcBSYgT7ELIwHWqUDDV / production alias https://aiso-kappa.vercel.app.
- Current deployment:dpl_3NeDiY6mEEVp4iYcUiwDGz5ygKHE.
- Reviewed slice history remains preserved. No old branches are to be bulk-merged.

Prepared local cumulative non-document diff: .superpowers/sdd/c11-candidate-vs-production.patch, SHA25608167008EDD54BF693CC8D983A5E00FD7BB4909F7B12976D3375ED68952796E2. Generated with git diff --binary between the two source identities, excluding docs. This is a review artifact, not a validated release or permission to apply it wholesale. Rebuild it if the candidate changes and review intended slice inclusion before publication.

## Gate register

| Gate | Evidence | Status / closure requirement |
| --- | --- | --- |
| Local candidate quality | d13110f preceding handoff:45cron tests, lint/types/build passed. Current C10 verification:270focused tests passed. Earlier C9 full/browser evidence has its own exact SHA | Local evidence available; run required candidate-wide checks and CI at the final publication SHA |
| C9d/e PostgreSQL | Child br-hidden-hill-az61ux9z:040-043 hashes verified,103SQL tests passed | Isolated proof passed; not production migration or C1 equivalence |
| Application database | AISO project weathered-wave-50814522 / parent br-square-mountain-az6f82vi / neondb last verified without040-043 | BLOCKED: actual Vercel production DB binding not read; AISO project selection does not repoint a database |
| Baseline-to-head equivalence | Local runner now advances both paths to head, prepares legacy auth prerequisites and rejects failed dry-run success text;44 mocked tooling tests pass | BLOCKED: live equivalence remains unproved; authorize an exact disposable rehearsal through043 after reviewing the separate tooling diff |
| Sterile topology | User confirms current AISO parent synthetic-only | Temporary exception valid under that statement; establish permanent sterile nonproduction parent before first customer write |
| CI enforcement | main protection404; applicable rules[]; latest passing run is C9d12ec30d, not candidate | BLOCKED: prepare minimal required-check rule for observed PR gate context, with reviewer/bypass ownership; exact setting change needs approval |
| Auth/billing/provider | Local failure/replay/entitlement checks passed | BLOCKED: exact isolated deployment, account IDs/test modes and live acceptance remain open |
| Scheduler | Dedicated Worker exists, schedules[],bindings[] | Inactive; require per-job producer ownership, approved secret mapping and execution evidence before activation |
| Product / operations owners | Not designated in this task | BLOCKED: name accountable release and rollback operators |
| Write fences / canary | No exact configured fence or measured canary evidence | BLOCKED: approve and verify the release write scope before customer traffic |
| Recovery | Recorded production RPO<=5min/RTO<=60min; staging RPO<=24h/RTO<=4h | Targets only. Timed restore/reconciliation evidence and operator approval required |

C1 defects were established by source inspection and mocked regression tests, not an executed divergent-schema test. The current equivalence script provisions, resets schemas and deletes branches; it was not run against the retained C9 proof branch or any other target. The local repair adds the existing integration harness auth shim after disposable identity verification. Independent review caught malformed function-body delimiters in the first edit; an exact emitted-SQL regression failed before correction and passed afterward. Do not broaden previous permission for the three C9 SQL suites into destructive equivalence rehearsal.

## Ordered preparation and release actions

1. Review the separate local C1 tooling repair and pin its exact SHA before proposing a disposable equivalence run. Local orchestration tests now cover both paths reaching head, exact auth SQL, connection mismatch refusal, post-baseline migration failure and failed dry-run output. They do not establish live PostgreSQL equivalence.
2. Build an isolated AISO application release proposal referencing the candidate, exact branch/database roles and provider test modes. The existing C9 proof branch contains retained fixtures and is not automatically a shared staging environment. No environment file is evidence of intended ownership.
3. Complete the [C10 verification matrix](2026-09-07-c10-provider-verification.md) using approved synthetic users/sinks/budgets. Record actual failure/replay results, not only HTTP success.
4. Prepare the publication PR from reviewed slice commits, verify its exact SHA in CI, and establish required-check enforcement through a separately approved rule diff. No push/merge occurred here.
5. Prepare application migrations only after the actual runtime DB identity is verified. If AISO is the selected database, its recorded missing range is040-043; if bindings still use legacy, stop rather than migrate legacy by inference. Include current-ledger readback, exact hashes, grants and rollback/retention plan.
6. Approve deployment/canary/write fences and recovery operator, then verify deployed SHA, role and schema before enabling writes. Scheduler activation is a distinct per-job decision after application acceptance.

## Rollback and abort rules

Abort on identity drift, unexpected migration ledger, wrong provider mode, missing required check, tenant isolation failure, secret exposure, duplicate job ownership or failed canary. Preserve the evidence and keep scheduling paused.

Application rollback returns to the exact previously accepted deployment only after checking compatibility with new schema and writes. Retain additive C9 tables and immutable history; do not drop040-043 or delete customer records as a routine rollback. If old application behavior cannot safely coexist with new writes, halt writes and follow the reviewed recovery procedure instead of guessing.

Scheduler rollback disables future triggers on the dedicated Worker and reconciles in-flight work; it cannot undo already sent messages or provider spend. Resume a prior producer only when its ownership and non-overlap are proven. Restore drills must use a separately approved isolated target; recorded RPO/RTO are not guarantees until measured.

## Work completed in this continuation

Prepared current C10 verification and C11 gate/action packages, ran270focused local tests, read Vercel deployment identity, GitHub main/rules/CI metadata and Cloudflare schedules/deployment/settings. No application runtime code changed in this continuation. Separately repaired the C1 verification runner and added four mocked orchestration regressions. All44 related tooling tests passed; scoped ESLint, JavaScript syntax, TypeScript and diff checks passed. Initial regression failures and the review-found SQL delimiter defect were corrected locally. No fresh full build or live schema-equivalence run was performed for this tooling/documentation diff. No provider mutation, branch cleanup, migration, real email, paid scan, deployment, push, merge or cutover occurred. Remaining gates above are explicit and are not relabeled complete by this dossier.

Independent re-review approved the corrected tooling diff with no remaining actionable findings. Review covered identity guards, exact emitted auth SQL, migration ordering, dry-run failure handling and cleanup; it did not execute live PostgreSQL.

## Slice C update — 2026-09-08 (supersedes local tooling status only)

The historical September 7 gate register and targets above are retained as dated
records. They do not select or authorize a target for the new strict rehearsal.
In particular, the old temporary synthetic-parent statement is not inherited.

At implementation source b866f14e97c203852f9143699c35d2cb698a094a, Slice C adds explicit
request/clean-source/manifest binding, child/session identity guards, exact two-path
head checks, canonical evidence and cleanup failure/readback enforcement. Local selected
verification passed 421 tests in 10 files, scoped lint, Next typegen and TypeScript.
No build or live rehearsal ran; whole-slice final independent review remains PENDING.
The [schema handoff](2026-09-08-schema-equivalence-handoff.md) gives exact commands,
source-specific hashes, limitations and the unexecuted UNKNOWN/BLOCKED live proposal.

Baseline-to-head equivalence remains BLOCKED/UNPROVED until a separately authorized
live run succeeds with confirmed recoverable cleanup. TTL does not confirm absence,
and ordinary branch deletion is not irreversible erasure. A parser cannot authenticate
live origin; reusable:false, enforced:false and productionReady:false remain. Candidate
DB bindings/migrations/grants, provider acceptance, tenant isolation, release operators,
CI enforcement, recovery, publication and Slice D remain separate unresolved gates.
