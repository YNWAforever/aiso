# Auth isolation and keyset snapshot fix report

## Scope

- Implemented the two Important findings from `final-review-4.md`.
- Did not modify evaluator policy semantics.
- Did not modify SQL migrations or apply migrations.

## Fixes

1. Auth Admin failure isolation
   - `auth.admin.getUserById` errors now mark only that account email as unavailable (`null`).
   - The route logs a sanitized lookup failure with profile id and error message.
   - Snapshot loading still fails hard for alert config, profile, and weekly snapshot database errors.
   - In-app notifications and other account emails continue through the real evaluator path.

2. Mutation-safe snapshot loading
   - `alert_configs` and `profiles` now use stable keyset pagination by ordered `id`.
   - Keyset pagination continues until an empty page, so short non-empty provider-capped pages do not truncate reads.
   - Weekly snapshot RPC output is no longer offset-paged. Client IDs are chunked before calling `get_alert_weekly_snapshot`, and chunk results are merged in deterministic client order.

## Size limits

- Config/profile keyset page size: `1000`.
- Weekly snapshot RPC client chunk size: `400` client IDs, targeting at most about `800` weekly rows per RPC because the RPC returns up to two rows per client.
- Profile account filter chunk size: `100`.
- Profile query concurrency cap: `4`.
- Auth Admin lookup concurrency cap: `16`.

## Verification

- Red check before implementation: `npm.cmd test -- __tests__/api/cron/evaluate-alerts.test.ts` failed on the new cursor/RPC/Auth contracts.
- Focused route test: `npm.cmd test -- __tests__/api/cron/evaluate-alerts.test.ts` passed, 12 tests.
- Focused route/evaluator/Resend/SQL tests: `npm.cmd test -- __tests__/api/cron/evaluate-alerts.test.ts __tests__/lib/alerts/evaluate.test.ts __tests__/lib/resend.test.ts __tests__/supabase/023_alert_evaluation_hardening.test.ts __tests__/supabase/024_alert_evaluation_snapshot_refinement.test.ts` passed, 5 files / 24 tests.
- Full suite: `npm.cmd test` passed, 45 files / 337 tests.
- Changed-file ESLint: `.\node_modules\.bin\eslint.cmd app/api/cron/evaluate-alerts/route.ts __tests__/api/cron/evaluate-alerts.test.ts` passed.
- TypeScript: `.\node_modules\.bin\tsc.cmd --noEmit --incremental false` passed.
- Whitespace: `git diff --check` passed.

## Remaining concerns

- Migration behavior remains statically/textually tested only; no local PostgreSQL/Supabase migration application was performed.
- The route still depends on the RPC returning rows in newest-first order per client, as guarded by the existing SQL text tests and route normalization tests.
