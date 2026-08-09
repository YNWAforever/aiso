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

---

## Accessibility coverage implementation

- Added `@axe-core/playwright` and `tests/e2e/accessibility.spec.ts` for the English home, login, and fixture-result flows, including pre- and post-email-unlock scans and keyboard tab reachability assertions.
- Added stable IDs and visually-hidden localized labels for the login, result, hero, and bottom scan inputs, plus the home industry and region selectors.
- Associated conditional login/result errors with their inputs and announced them with `role="alert"` and `aria-live="polite"`.

### Verification

- Red: the new Playwright suite initially failed because `@axe-core/playwright` was absent.
- Green local checks: `npm.cmd test -- __tests__/ci/e2e-fixtures.test.ts --run` (3 passed) and `npm.cmd run typecheck` passed.
- Browser accessibility execution was attempted with `E2E_FIXTURE_MODE=1` and `START_DEV_SERVER=1`, but Next/Turbopack crashed before serving due to the sandbox-inaccessible inferred workspace root (`C:\Users\laich`).
- `git diff --check` passed.

---

## Review fix: attach sanitized axe reports

- Added `lib/axe-report.ts`, a serializable sanitizer that retains rule metadata, node counts, and selector targets for axe `violations`, `passes`, and `incomplete` findings while omitting URLs, HTML, timestamps, failure summaries, and arbitrary check data.
- Each audited accessibility flow now attaches its complete sanitized JSON result to the Playwright report with `application/json`; the assertion still fails only on serious or critical violations and keeps the existing compact blocking summary.
- Added unit coverage for the sanitizer's diagnostic shape and content exclusion.

### Verification

- `npm.cmd test -- --run __tests__/lib/axe-report.test.ts __tests__/ci/e2e-fixtures.test.ts` (2 files, 4 tests passed)
- `npm.cmd run typecheck` passed.
- `npx.cmd playwright test tests/e2e/accessibility.spec.ts --list` listed 6 project/test entries without executing browser E2E.
- `git diff --check` passed.
