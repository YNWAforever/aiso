# Task 3 Report

## Summary

Implemented Task 3 in the shared `alert-evaluation` worktree by replacing the inline alert evaluator in `app/api/cron/evaluate-alerts/route.ts` with route-owned Supabase and Resend adapters that delegate to `runAlertEvaluation`.

## Files changed

- `app/api/cron/evaluate-alerts/route.ts`
- `__tests__/api/cron/evaluate-alerts.test.ts`

## What changed

- Preserved the existing cron auth contract:
  - missing `CRON_SECRET` -> `500 { error: 'Cron not configured' }`
  - missing or wrong `x-cron-secret` -> `401 { error: 'Unauthorized' }`
  - valid auth -> `Response.json(result)`
- Added a route contract test that:
  - proved the old route failed to delegate before implementation
  - verifies the new route delegates to `runAlertEvaluation`
  - verifies the success payload `{ processed: 1, fired: 1 }`
- Added route-owned adapter construction for:
  - snapshot loading from `alert_configs`, `pulse_weekly_summary`, and `profiles`
  - account email lookup through `auth.admin.getUserById` once per unique account
  - notification upsert with `onConflict: 'client_id,type,scan_week'` and `ignoreDuplicates: true`
  - email delivery via `sendAlertEmail`
- Kept only the newest two aggregate weeks per client in the normalized snapshot payload consumed by the evaluator.
- Left notification/email delivery failures fail-soft inside `runAlertEvaluation`; snapshot-loading failures still abort the request and surface through the route as a server failure.

## TDD evidence

Red:

- `npm.cmd test -- --run __tests__/api/cron/evaluate-alerts.test.ts`
- Result before implementation: 1 failed, 3 passed
- Failure: `runAlertEvaluation` was expected once but was called 0 times

Green:

- `npm.cmd test -- --run __tests__/api/cron/evaluate-alerts.test.ts`
- Result after implementation: 1 file passed, 4 tests passed

Focused verification:

- `npm.cmd test -- --run __tests__/lib/alerts/evaluate.test.ts __tests__/api/cron/evaluate-alerts.test.ts __tests__/api/alerts.test.ts`
- Result: 3 files passed, 10 tests passed

## Concerns

- The shared worktree already contains an untracked plan file at `docs/superpowers/plans/2026-08-08-alert-evaluation.md`; it was left untouched and not staged.
- Dashboard URLs still depend on `NEXT_PUBLIC_APP_URL`, matching the prior route behavior.
