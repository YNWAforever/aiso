-- Admin plan comps that survive both the Stripe webhook and check_brand_limit().
--
-- accounts.plan keeps exactly two writers: the signup webhook seeds it ('basic')
-- and the Stripe webhook maintains it. Admin writes these override columns
-- instead, so a comp is no longer clobbered by the next subscription event.
--
-- override_expires_at IS NULL means a permanent comp (internal/partner accounts).
--
-- override_set_by deliberately carries no foreign key. The design spec
-- (docs/superpowers/specs/2026-07-26-admin-plan-override-design.md) specifies
-- `references public.profiles(id)`; that is not carried over here, on purpose.
-- Attribution must outlive the actor it names, and
-- profiles.id cascade-deletes from neon_auth.user (022) and
-- profiles.account_id cascade-deletes from accounts (003), so an FK here would
-- block deleting an admin's Neon Auth user — or their account — on a constraint
-- naming a table the caller never touched. accounts_override_complete still
-- guarantees a person is recorded at grant time.

alter table public.accounts
  add column if not exists override_plan       text,
  add column if not exists override_reason     text,
  add column if not exists override_set_by     uuid,
  add column if not exists override_expires_at timestamptz;

-- accounts_override_plan_check restricts a comp to a known plan; accounts_override_complete
-- makes an unattributed comp impossible at the database level — a grant cannot exist
-- without both a reason and a person.
alter table public.accounts
  drop constraint if exists accounts_override_plan_check,
  drop constraint if exists accounts_override_complete,
  add constraint accounts_override_plan_check
    check (override_plan is null
           or override_plan in ('free', 'basic', 'pro', 'enterprise')),
  add constraint accounts_override_complete
    check (override_plan is null
           or (override_set_by is not null
               and override_reason is not null
               and char_length(btrim(override_reason)) between 1 and 500));

-- Replaces the definition from 026. A live override is evaluated FIRST, before
-- the stored-plan validation and before has_subscription: a comped account has
-- no Stripe subscription, and an account with malformed Stripe state is exactly
-- the case a comp exists to rescue.
create or replace function public.check_brand_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_plan text;
  account_status text;
  stripe_subscription_id text;
  trial_ends_at timestamptz;
  override_plan text;
  override_expires_at timestamptz;
  override_is_live boolean;
  has_subscription boolean;
  trial_is_live boolean;
  effective_plan text;
  brand_limit integer;
  current_count integer;
begin
  if new.account_id is null then
    raise exception 'ACCOUNT_ENTITLEMENT_INVALID'
      using detail = 'account_id is required';
  end if;

  -- Serialize every brand insert for one account before reading account state or counting.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.account_id::text, 0)
  );

  select
    accounts.plan,
    accounts.status,
    accounts.stripe_subscription_id,
    accounts.trial_ends_at,
    accounts.override_plan,
    accounts.override_expires_at
  into
    stored_plan,
    account_status,
    stripe_subscription_id,
    trial_ends_at,
    override_plan,
    override_expires_at
  from public.accounts
  where accounts.id = new.account_id;

  if not found then
    raise exception 'ACCOUNT_ENTITLEMENT_INVALID'
      using detail = 'account does not exist';
  end if;

  override_is_live := override_plan is not null
    and override_plan in ('free', 'basic', 'pro', 'enterprise')
    and (override_expires_at is null or override_expires_at > pg_catalog.now());

  if override_is_live then
    effective_plan := override_plan;
  else
    if stored_plan is null
      or stored_plan not in ('basic', 'pro', 'enterprise')
      or account_status is null
      or account_status not in ('active', 'past_due', 'cancelled', 'trialing')
    then
      raise exception 'ACCOUNT_ENTITLEMENT_INVALID'
        using detail = 'account plan or status is malformed';
    end if;

    if stripe_subscription_id is not null
      and pg_catalog.btrim(stripe_subscription_id) = ''
    then
      raise exception 'ACCOUNT_ENTITLEMENT_INVALID'
        using detail = 'subscription id is malformed';
    end if;

    has_subscription := stripe_subscription_id is not null;
    trial_is_live := trial_ends_at is not null
      and trial_ends_at > pg_catalog.now();

    effective_plan := case
      when account_status in ('past_due', 'cancelled') then 'free'
      when account_status = 'active' and has_subscription then stored_plan
      when trial_is_live
        or (account_status = 'trialing' and has_subscription)
        then stored_plan
      else 'free'
    end;
  end if;

  -- Keep these in sync with PLAN_CATALOG[*].maxBrands in lib/plans/catalog.ts.
  -- __tests__/db/brand-limit-entitlement.test.ts fails if they diverge.
  brand_limit := case effective_plan
    when 'free' then 1
    when 'basic' then 1
    when 'pro' then 3
    when 'enterprise' then 10
    else null
  end;

  if brand_limit is null then
    raise exception 'ACCOUNT_ENTITLEMENT_INVALID'
      using detail = 'effective plan is malformed';
  end if;

  select count(*)
  into current_count
  from public.clients
  where clients.account_id = new.account_id;

  if current_count >= brand_limit then
    raise exception 'BRAND_LIMIT_REACHED'
      using detail = pg_catalog.format(
        'effective_plan=%s limit=%s',
        effective_plan,
        brand_limit
      );
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_brand_limit on public.clients;

create trigger enforce_brand_limit
  before insert on public.clients
  for each row
  execute function public.check_brand_limit();

revoke all on function public.check_brand_limit() from public;

do $acl$
begin
  if to_regrole('anon') is not null then
    execute 'revoke all on function public.check_brand_limit() from anon';
  end if;
  if to_regrole('authenticated') is not null then
    execute 'revoke all on function public.check_brand_limit() from authenticated';
  end if;
end
$acl$;

-- Orphaned third definition of plan entitlements: three rows, read by zero
-- application code. PLAN_CATALOG in lib/plans/catalog.ts is the source of truth.
drop table if exists public.plan_features;
