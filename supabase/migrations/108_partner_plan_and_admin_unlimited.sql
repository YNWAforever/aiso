-- Partner comp tier + unlimited brands for platform administrators.
--
-- `partner` is a companion plan: every Enterprise capability at no charge, with a
-- 20-brand ceiling. It has no Stripe price and `checkout: false` in
-- lib/plans/catalog.ts, so it is only ever granted as an admin override
-- (`override_plan = 'partner'`). `accounts.plan` intentionally keeps its narrower
-- CHECK (basic/pro/enterprise) because that column is written only by the signup
-- and Stripe webhooks, and an unresolved stored 'partner' would resolve to free
-- in lib/tier.ts anyway.
--
-- Accounts that hold an active platform administrator (`profiles.is_admin` with a
-- null `deactivated_at`) skip the brand ceiling entirely, in the database and not
-- only in the UI: every brand insert goes through this trigger.
--
-- This migration supersedes 028's check_brand_limit() definition. Keep the plan-id
-- lists and the brand_limit CASE in sync with PLAN_IDS / PLAN_CATALOG[*].maxBrands
-- in lib/plans/catalog.ts — __tests__/db/brand-limit-entitlement.test.ts enforces it.

alter table public.accounts
  drop constraint if exists accounts_override_plan_check,
  add constraint accounts_override_plan_check
    check (override_plan is null
           or override_plan in ('free', 'basic', 'pro', 'enterprise', 'partner'));

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

  -- Platform administrators are uncapped. This is deliberately checked after the
  -- account-existence guard (so a brand cannot be made for a missing account) and
  -- before every entitlement rule, including the malformed-state guard: the
  -- platform's own account must stay usable even while Stripe state is broken.
  perform 1
    from public.profiles
    where profiles.account_id = new.account_id
      and profiles.is_admin
      and profiles.deactivated_at is null;

  if found then
    return new;
  end if;

  override_is_live := override_plan is not null
    and override_plan in ('free', 'basic', 'pro', 'enterprise', 'partner')
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
    when 'partner' then 20
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
