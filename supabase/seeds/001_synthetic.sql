-- ============================================================================
-- Synthetic seed. NO PRODUCTION DATA -- every value here is invented.
--
-- Scope is deliberate: accounts -> clients -> scans, and nothing else. profiles
-- is not seeded because profiles.id carries a foreign key into neon_auth."user",
-- a schema Neon owns and provisions. Sign up through Neon Auth and the existing
-- webhooks/neon handler creates the profile; hand-written identity rows would
-- diverge from what the real flow produces.
--
-- WHY THE ACCOUNT LOOKS LIKE THIS. public.clients has a BEFORE INSERT trigger,
-- enforce_brand_limit, calling check_brand_limit(). An account left at its
-- defaults (plan 'basic', status 'active', no subscription) resolves through
-- that function to the effective plan 'free', whose limit is 1 -- and 'basic'
-- is also capped at 1. effective_plan only reaches the STORED plan when
-- status = 'active' AND stripe_subscription_id is not null. Hence pro + active
-- + a synthetic subscription id, which is limit 3.
--
-- Do NOT reach for trial_ends_at instead: check_brand_limit() compares
-- it to pg_catalog.now(), so a hardcoded timestamp is a time bomb that starts
-- failing after that date.
--
-- WHY EXACTLY TWO CLIENTS. Postgres fires BEFORE INSERT row triggers BEFORE the
-- ON CONFLICT arbiter is evaluated, so `on conflict do nothing` does
-- not by itself make a client insert idempotent: on a second run the trigger
-- counts the rows already there and raises BRAND_LIMIT_REACHED before the guard
-- can skip anything. Re-runs are safe only while the seeded count stays
-- STRICTLY BELOW the limit -- 2 < 3 passes, and the guard then skips both rows.
-- Adding a third client under this account would break re-runnability silently.
-- __tests__/db/synthetic-seed.test.ts pins that invariant.
-- ============================================================================

insert into accounts (id, plan, status, stripe_subscription_id)
values ('00000000-0000-4000-8000-000000000001', 'pro', 'active', 'sub_seed_synthetic_pro')
on conflict (id) do nothing;

insert into clients (id, account_id, brand_name, domain, industry, region)
values
  ('00000000-0000-4000-8000-000000000101',
   '00000000-0000-4000-8000-000000000001',
   'Northwind Coffee', 'northwind.example', 'retail', 'HK'),
  ('00000000-0000-4000-8000-000000000102',
   '00000000-0000-4000-8000-000000000001',
   'Harbour Books', 'harbourbooks.example', 'retail', 'HK')
on conflict (id) do nothing;

insert into scans (id, account_id, client_id, url, domain, score, grade, results)
values
  ('00000000-0000-4000-8000-000000000201',
   '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000101',
   'https://northwind.example/', 'northwind.example', 72.00, 'B',
   '{"seed": true}'::jsonb)
on conflict (id) do nothing;
