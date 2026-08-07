# Nullable scores, SQL dedup, profile chunking, and pagination fix report

## Summary

Implemented the four Important fixes from `final-review-3.md` without applying migrations or touching live providers.

- `AlertWeekSnapshot.sov_score` is now `number | null`.
- Alert evaluation skips all policies when the latest score is null.
- Threshold/WoW/recovery policies require non-null previous scores where the policy depends on the previous week, while preserving the existing first-observed below-threshold behavior when no previous week exists.
- Migration 023 now deduplicates same-week summary rows by `created_at DESC NULLS LAST, id DESC` before ranking latest distinct weeks.
- Profile reads now chunk account IDs in groups of 100 with bounded query concurrency and retain one Auth Admin lookup per unique account.
- Paged reads now advance by the number of rows returned and stop only after an empty page, avoiding truncation when a provider cap is below `PAGE_SIZE`.

## Files changed

- `lib/alerts/evaluate.ts`
- `app/api/cron/evaluate-alerts/route.ts`
- `supabase/migrations/023_alert_evaluation_hardening.sql`
- `__tests__/lib/alerts/evaluate.test.ts`
- `__tests__/api/cron/evaluate-alerts.test.ts`
- `__tests__/supabase/023_alert_evaluation_hardening.test.ts`

## Verification

- Red check before implementation: `npm.cmd test -- __tests__/lib/alerts/evaluate.test.ts __tests__/api/cron/evaluate-alerts.test.ts __tests__/supabase/023_alert_evaluation_hardening.test.ts`
  - Failed as expected: null latest fired alerts, SQL contract expected `created_at DESC NULLS LAST`, short provider-capped pages truncated, and profile `.in` exceeded the chunk limit.
- Focused evaluator/route/SQL after implementation: `npm.cmd test -- __tests__/lib/alerts/evaluate.test.ts __tests__/api/cron/evaluate-alerts.test.ts __tests__/supabase/023_alert_evaluation_hardening.test.ts`
  - 3 files passed, 20 tests passed.
- Focused evaluator/route/Resend/SQL: `npm.cmd test -- __tests__/lib/alerts/evaluate.test.ts __tests__/api/cron/evaluate-alerts.test.ts __tests__/lib/resend.test.ts __tests__/supabase/023_alert_evaluation_hardening.test.ts`
  - 4 files passed, 22 tests passed.
- Full suite: `npm.cmd test`
  - 44 files passed, 335 tests passed.
- Changed-file ESLint: `node_modules\.bin\eslint.cmd __tests__\api\cron\evaluate-alerts.test.ts __tests__\lib\alerts\evaluate.test.ts __tests__\supabase\023_alert_evaluation_hardening.test.ts app\api\cron\evaluate-alerts\route.ts lib\alerts\evaluate.ts`
  - Passed with no diagnostics.
- TypeScript: `node_modules\.bin\tsc.cmd --noEmit --incremental false`
  - Passed.
- Whitespace: `git diff --check`
  - Passed; Git printed Windows CRLF conversion warnings only.

## Remaining concern

No code/test concern remains from the four Important items. Migration 023 was edited but intentionally not applied, per instruction.
