# Public scan deployment prerequisites

Moved from the README in UX Phase 8. Read it before releasing anonymous or authenticated scans.

Production anonymous scans are supported only on Vercel, where the platform overwrites
`x-vercel-forwarded-for` and exposes the `VERCEL=1` system environment invariant.
The endpoint fails closed when either invariant is missing.

Before releasing public scans:

- Apply `supabase/migrations/023_public_scan_rate_limits.sql` to the production database.
- Apply `supabase/migrations/024_stripe_lifecycle_integrity.sql` before enabling Stripe webhooks.
- Apply `supabase/migrations/025_authenticated_scan_quotas.sql` before releasing authenticated scans.
  The server-only `DATABASE_URL` role must be able to insert, update, select, and delete rows in
  `authenticated_scan_monthly_usage`; authenticated scans fail closed if the counter is unavailable.
- Apply `supabase/migrations/026_effective_brand_limit.sql` before releasing self-service brand creation.
  It replaces the legacy raw-plan trigger with serialized, effective-entitlement enforcement.
- **Apply `supabase/migrations/028_account_plan_overrides.sql` BEFORE deploying the code that
  expects it — not before first using admin plan comps.** `getProfile()` in `lib/auth.ts`
  selects `override_plan` and `override_expires_at` on every authenticated request, and the
  Neon driver throws on a missing column. Deploying the code against a pre-028 schema returns
  500 for every signed-in request (dashboard, admin, pulse, reports, authenticated scans)
  while anonymous traffic keeps working — so the public funnel smoke-tests green while every
  logged-in customer is down. The migration is additive (`add column if not exists`) and its
  only destructive statement drops the orphaned `plan_features` table, so migration-first is
  always the safe order. Apply it before, or atomically with, the deploy.
  It adds the override columns and replaces `check_brand_limit()` so a comp is honoured by
  the database as well as the application.
- Configure the server-only `PUBLIC_SCAN_RATE_LIMIT_SECRET` with at least 32 random characters.
  Do not expose it through a `NEXT_PUBLIC_` variable or commit its value.

Local development and tests use a single explicitly isolated identity and development-only
HMAC key. They ignore forwarding headers and do not claim production proxy security.
