-- Admin plan comps that survive both the Stripe webhook and check_brand_limit().
--
-- accounts.plan keeps exactly two writers: the signup webhook seeds it ('basic')
-- and the Stripe webhook maintains it. Admin writes these override columns
-- instead, so a comp is no longer clobbered by the next subscription event.

alter table public.accounts
  add column if not exists override_plan       text,
  add column if not exists override_reason     text,
  add column if not exists override_set_by     uuid references public.profiles(id),
  add column if not exists override_expires_at timestamptz;

-- override_expires_at IS NULL means a permanent comp (internal/partner accounts).
alter table public.accounts
  drop constraint if exists accounts_override_plan_check;
alter table public.accounts
  add constraint accounts_override_plan_check
    check (override_plan is null
           or override_plan in ('free', 'basic', 'pro', 'enterprise'));

-- An unattributed comp is impossible at the database level: a grant cannot
-- exist without a reason and a person.
alter table public.accounts
  drop constraint if exists accounts_override_complete;
alter table public.accounts
  add constraint accounts_override_complete
    check (override_plan is null
           or (override_reason is not null and override_set_by is not null));

-- Orphaned third definition of plan entitlements: three rows, read by zero
-- application code. PLAN_CATALOG in lib/plans/catalog.ts is the source of truth.
drop table if exists public.plan_features;
