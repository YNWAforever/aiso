# Auth Admin rejection isolation fix report

Date: Friday, August 7, 2026
Worktree: `C:\Users\laich\Documents\geoscanner\.worktrees\alert-evaluation`

## Summary

Completed the remaining Auth Admin rejection isolation hardening in `app/api/cron/evaluate-alerts/route.ts`.

- Wrapped each `supabase.auth.admin.getUserById(profileId)` call in `loadEmailsByAccount` with `try/catch`.
- Preserved the existing resolved `{ error }` handling.
- For both resolved Auth errors and rejected Auth Admin promises, the route now:
  - logs the sanitized failure,
  - sets only that account's email to `null`,
  - continues the rest of the in-app evaluation and other account lookups.
- Preserved fail-hard behavior for database/config/profile/RPC reads.
- Preserved the Auth Admin concurrency cap of `16`.
- Preserved exactly one lookup per unique account.

## Files changed

- `app/api/cron/evaluate-alerts/route.ts`
- `__tests__/api/cron/evaluate-alerts.test.ts`

## Regression coverage added

Added a route-level provider-mocked regression test proving that a rejected Auth Admin promise:

- does not abort the route,
- still returns `200`,
- still produces in-app notifications for both accounts,
- only skips email delivery for the affected account,
- still logs the failure.

## Verification

Red/green regression cycle:

1. `npm.cmd test -- __tests__/api/cron/evaluate-alerts.test.ts -t "uses the real evaluator and skips only the affected email when one Auth Admin lookup rejects"`
   - failed before the route fix with `Error: auth admin transport rejected`
2. Re-ran the same command after the route fix
   - passed

Focused tests:

- `npm.cmd test -- __tests__/api/cron/evaluate-alerts.test.ts __tests__/lib/alerts/evaluate.test.ts __tests__/lib/resend.test.ts __tests__/supabase/023_alert_evaluation_hardening.test.ts __tests__/supabase/024_alert_evaluation_snapshot_refinement.test.ts`
  - passed (`5` files, `25` tests)

Full verification:

- `npm.cmd test`
  - passed (`45` files, `338` tests)
- `node_modules\.bin\eslint.cmd app/api/cron/evaluate-alerts/route.ts __tests__/api/cron/evaluate-alerts.test.ts`
  - passed
- `node_modules\.bin\tsc.cmd --noEmit`
  - passed
- `git diff --check`
  - passed

## Remaining concerns

- No functional blockers remain for the requested isolation gap.
- Git still warns that the working copy will normalize `LF` to `CRLF` on future Git operations for the two changed files, but this did not affect test/lint/typecheck results.
