# SQL privilege static coverage report

Date: 2026-08-07
Worktree: `C:\Users\laich\Documents\geoscanner\.worktrees\alert-evaluation`

## Scope

Close the minor static SQL coverage gap called out in `migration-forward-review.md` without changing SQL or production code.

## Change made

Updated both split migration contract tests:

- `__tests__/supabase/023_alert_evaluation_hardening.test.ts`
- `__tests__/supabase/024_alert_evaluation_snapshot_refinement.test.ts`

Each test now asserts the full execute privilege contract for `public.get_alert_weekly_snapshot(uuid[])`:

- `REVOKE ALL ... FROM PUBLIC`
- `REVOKE ALL ... FROM anon`
- `REVOKE ALL ... FROM authenticated`
- `GRANT EXECUTE ... TO service_role`

No SQL files or production code were changed.

## Verification

- Focused SQL tests:
  - `npm.cmd test -- __tests__/supabase/023_alert_evaluation_hardening.test.ts __tests__/supabase/024_alert_evaluation_snapshot_refinement.test.ts`
  - Result: pass (`2` files, `2` tests)
- Full test suite:
  - `npm.cmd test`
  - Result: pass (`45` files, `336` tests)
- ESLint:
  - `npx.cmd eslint __tests__/supabase/023_alert_evaluation_hardening.test.ts __tests__/supabase/024_alert_evaluation_snapshot_refinement.test.ts`
  - Result: pass
- Diff hygiene:
  - `git diff --check`
  - Result: no diff errors; Git emitted existing LF->CRLF working-copy warnings only

## Outcome

The static coverage gap is closed at the migration-contract level, and the shared worktree now verifies the revoke-and-grant privilege contract alongside the existing function/index semantics.
