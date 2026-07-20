-- Enforce brand limits from effective commercial entitlement, not the raw stored plan.
-- The per-account transaction lock makes the count-and-insert decision serial.
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
    accounts.trial_ends_at
  into
    stored_plan,
    account_status,
    stripe_subscription_id,
    trial_ends_at
  from public.accounts
  where accounts.id = new.account_id;

  if not found then
    raise exception 'ACCOUNT_ENTITLEMENT_INVALID'
      using detail = 'account does not exist';
  end if;

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
