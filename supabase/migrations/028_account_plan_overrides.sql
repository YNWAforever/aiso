-- Admin plan comps that survive both the Stripe webhook and check_brand_limit().
--
-- accounts.plan keeps exactly two writers: the signup webhook seeds it ('basic')
-- and the Stripe webhook maintains it. Admin writes these override columns
-- instead, so a comp is no longer clobbered by the next subscription event.
--
-- override_expires_at IS NULL means a permanent comp (internal/partner accounts).
--
-- override_set_by deliberately carries no foreign key: attribution must outlive
-- the actor it names. profiles.id cascade-deletes from neon_auth.user (022) and
-- profiles.account_id cascade-deletes from accounts (003), so an FK here would
-- block deleting an admin's Neon Auth user — or their account — on a constraint
-- naming a table the caller never touched. accounts_override_complete still
-- guarantees a person is recorded at grant time.

alter table public.accounts
  add column if not exists override_plan       text,
  add column if not exists override_reason     text,
  add column if not exists override_set_by     uuid,
  add column if not exists override_expires_at timestamptz;

-- An unattributed comp is impossible at the database level: a grant cannot
-- exist without a reason and a person.
alter table public.accounts
  drop constraint if exists accounts_override_plan_check,
  drop constraint if exists accounts_override_complete,
  add constraint accounts_override_plan_check
    check (override_plan is null
           or override_plan in ('free', 'basic', 'pro', 'enterprise')),
  add constraint accounts_override_complete
    check (override_plan is null
           or (override_set_by is not null
               and char_length(btrim(override_reason)) between 1 and 500));

-- Orphaned third definition of plan entitlements: three rows, read by zero
-- application code. PLAN_CATALOG in lib/plans/catalog.ts is the source of truth.
drop table if exists public.plan_features;
