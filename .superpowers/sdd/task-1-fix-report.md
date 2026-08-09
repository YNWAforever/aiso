# Task 1 review fix report

Date: 2026-08-07

Scope:
- Resume the interrupted Task 1 review fix in the shared `alert-evaluation` worktree.
- Preserve correct existing uncommitted changes in `__tests__/lib/alerts/evaluate.test.ts`.
- Finish the two required review fixes without adding production code or weakening assertions.

Outcome:
- Preserved the existing uncommitted test changes because they correctly address both review findings.
- Confirmed the test contract now covers explicit `sov_recovery` behavior.
- Confirmed the ordering test now detects an interleaved evaluate-and-deliver implementation by mutating the second config's source data during the first delivery.
- Did not add any production code.

Files:
- Modified: `__tests__/lib/alerts/evaluate.test.ts`
- Added: `.superpowers/sdd/task-1-fix-report.md`

Review-fix details:
1. `sov_recovery` coverage
   - Added a dedicated recovery case with previous SoV below threshold and latest SoV at the threshold.
   - Asserts one fired action, one notification, one email, and `type: 'sov_recovery'` on both delivery ports.

2. Evaluate-before-deliver ordering guard
   - Reworked the deterministic-order test to use two configs.
   - The first notification delivery mutates the second config's `weeksByClient` data so its week-over-week drop would disappear if the second action were evaluated only after the first delivery.
   - The test still expects the second `sov_wow_drop` action to be delivered, proving actions must be computed before delivery begins.

Verification:
- Command run:
  - `npm.cmd test -- --run __tests__/lib/alerts/evaluate.test.ts`
- Result:
  - Expected RED observed.
  - Vitest failed because `@/lib/alerts/evaluate` does not exist yet.
  - No test-setup failure replaced the intended missing-module failure.

Observed failure excerpt:
- `Error: Cannot find package '@/lib/alerts/evaluate' imported from C:/Users/laich/Documents/geoscanner/.worktrees/alert-evaluation/__tests__/lib/alerts/evaluate.test.ts`

Concerns:
- Expected blocker remains: Task 1 cannot go green until `lib/alerts/evaluate.ts` is implemented in the next step.
- Git in this sandboxed identity hits a safe-directory ownership guard on the shared worktree, so repository commands must be run with an explicit safe-directory override.
