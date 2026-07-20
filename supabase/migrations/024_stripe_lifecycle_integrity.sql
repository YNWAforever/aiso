-- Keep Stripe lifecycle events idempotent and ordered independently of webhook delivery order.
alter table public.accounts
  add column if not exists stripe_event_created_at bigint not null default 0,
  add column if not exists stripe_event_id text;

create unique index if not exists accounts_stripe_subscription_id_unique
  on public.accounts (stripe_subscription_id)
  where stripe_subscription_id is not null;

create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_created bigint not null check (event_created >= 0),
  event_type text not null,
  account_id uuid not null references public.accounts (id) on delete cascade,
  processed_at timestamptz not null default now()
);

alter table public.stripe_webhook_events enable row level security;
revoke all on table public.stripe_webhook_events from public;

do $acl$
begin
  if to_regrole('anon') is not null then
    execute 'revoke all on table public.stripe_webhook_events from anon';
  end if;
  if to_regrole('authenticated') is not null then
    execute 'revoke all on table public.stripe_webhook_events from authenticated';
  end if;
  if to_regrole('service_role') is not null then
    execute 'grant select, insert on table public.stripe_webhook_events to service_role';
  end if;
end
$acl$;

-- Serialize canonical Stripe reads and persistence without holding a database
-- transaction open across the Stripe network request. Expiry allows recovery if
-- a handler crashes before its best-effort release.
create table if not exists public.stripe_subscription_processing_leases (
  subscription_id text primary key check (btrim(subscription_id) <> ''),
  lease_owner uuid not null,
  lease_expires_at timestamptz not null
);

alter table public.stripe_subscription_processing_leases enable row level security;
revoke all on table public.stripe_subscription_processing_leases from public;

do $acl$
begin
  if to_regrole('anon') is not null then
    execute 'revoke all on table public.stripe_subscription_processing_leases from anon';
  end if;
  if to_regrole('authenticated') is not null then
    execute 'revoke all on table public.stripe_subscription_processing_leases from authenticated';
  end if;
  if to_regrole('service_role') is not null then
    execute 'grant select, insert, update, delete on table public.stripe_subscription_processing_leases to service_role';
  end if;
end
$acl$;

create or replace function public.acquire_stripe_subscription_lease(
  p_subscription_id text,
  p_lease_owner uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_acquired integer;
begin
  if p_subscription_id is null or btrim(p_subscription_id) = '' then
    raise exception 'subscription id is required';
  end if;
  if p_lease_owner is null then
    raise exception 'lease owner is required';
  end if;

  insert into public.stripe_subscription_processing_leases (
    subscription_id,
    lease_owner,
    lease_expires_at
  )
  values (
    p_subscription_id,
    p_lease_owner,
    clock_timestamp() + interval '300 seconds'
  )
  on conflict (subscription_id) do update
    set lease_owner = excluded.lease_owner,
        lease_expires_at = excluded.lease_expires_at
    where public.stripe_subscription_processing_leases.lease_expires_at <= clock_timestamp();

  get diagnostics v_acquired = row_count;
  return v_acquired = 1;
end;
$$;

create or replace function public.release_stripe_subscription_lease(
  p_subscription_id text,
  p_lease_owner uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_subscription_id is null or btrim(p_subscription_id) = '' then
    raise exception 'subscription id is required';
  end if;
  if p_lease_owner is null then
    raise exception 'lease owner is required';
  end if;

  delete from public.stripe_subscription_processing_leases
    where subscription_id = p_subscription_id
      and lease_owner = p_lease_owner;

  return found;
end;
$$;

revoke all on function public.acquire_stripe_subscription_lease(text, uuid) from public;

do $acl$
begin
  if to_regrole('anon') is not null then
    execute 'revoke all on function public.acquire_stripe_subscription_lease(text, uuid) from anon';
  end if;
  if to_regrole('authenticated') is not null then
    execute 'revoke all on function public.acquire_stripe_subscription_lease(text, uuid) from authenticated';
  end if;
  if to_regrole('service_role') is not null then
    execute 'grant execute on function public.acquire_stripe_subscription_lease(text, uuid) to service_role';
  end if;
end
$acl$;
revoke all on function public.release_stripe_subscription_lease(text, uuid) from public;

do $acl$
begin
  if to_regrole('anon') is not null then
    execute 'revoke all on function public.release_stripe_subscription_lease(text, uuid) from anon';
  end if;
  if to_regrole('authenticated') is not null then
    execute 'revoke all on function public.release_stripe_subscription_lease(text, uuid) from authenticated';
  end if;
  if to_regrole('service_role') is not null then
    execute 'grant execute on function public.release_stripe_subscription_lease(text, uuid) to service_role';
  end if;
end
$acl$;

-- CREATE OR REPLACE with a new argument list creates an overload. Remove the
-- unfenced legacy signature so every caller must prove current lease ownership.
drop function if exists public.apply_stripe_account_event(
  uuid, text, text, text, text, bigint, text, text
);

create or replace function public.apply_stripe_account_event(
  p_account_id uuid,
  p_subscription_id text,
  p_customer_id text,
  p_plan text,
  p_status text,
  p_event_created bigint,
  p_event_id text,
  p_event_type text,
  p_lease_owner uuid
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_last_event_created bigint;
  v_inserted integer;
begin
  if p_subscription_id is null or btrim(p_subscription_id) = '' then
    raise exception 'subscription id is required';
  end if;
  if p_customer_id is null or btrim(p_customer_id) = '' then
    raise exception 'customer id is required';
  end if;
  if p_plan not in ('basic', 'pro', 'enterprise') then
    raise exception 'unsupported account plan: %', p_plan;
  end if;
  if p_status not in ('active', 'past_due', 'cancelled', 'trialing') then
    raise exception 'unsupported account status: %', p_status;
  end if;
  if p_event_created is null or p_event_created < 0 then
    raise exception 'invalid Stripe event creation time';
  end if;
  if p_event_id is null or btrim(p_event_id) = '' then
    raise exception 'event id is required';
  end if;
  if p_event_type is null or btrim(p_event_type) = '' then
    raise exception 'event type is required';
  end if;
  if p_lease_owner is null then
    raise exception 'lease owner is required';
  end if;

  -- Lock and validate the lease in this transaction before touching the event
  -- ledger or account. An expired lease can be stolen, but its former owner can
  -- never persist after the takeover.
  perform 1
    from public.stripe_subscription_processing_leases
    where subscription_id = p_subscription_id
      and lease_owner = p_lease_owner
      and lease_expires_at > clock_timestamp()
    for update;

  if not found then
    return 'lease_lost';
  end if;

  if p_account_id is not null then
    select accounts.id, accounts.stripe_event_created_at
      into v_account_id, v_last_event_created
      from public.accounts
      where accounts.id = p_account_id
      for update;
  else
    select accounts.id, accounts.stripe_event_created_at
      into v_account_id, v_last_event_created
      from public.accounts
      where accounts.stripe_subscription_id = p_subscription_id
      for update;
  end if;

  -- Do not consume the event before Checkout has linked the subscription.
  if v_account_id is null then
    return 'not_found';
  end if;

  insert into public.stripe_webhook_events (
    event_id,
    event_created,
    event_type,
    account_id
  )
  values (
    p_event_id,
    p_event_created,
    p_event_type,
    v_account_id
  )
  on conflict (event_id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return 'duplicate';
  end if;

  if p_event_created < v_last_event_created then
    return 'stale';
  end if;

  -- The processing lease serializes canonical reads through this update, including
  -- equal-second events. Event IDs remain identity keys, never chronology.
  update public.accounts
    set stripe_customer_id = p_customer_id,
        stripe_subscription_id = p_subscription_id,
        plan = p_plan,
        status = p_status,
        stripe_event_created_at = greatest(stripe_event_created_at, p_event_created),
        stripe_event_id = p_event_id
    where id = v_account_id;

  if not found then
    raise exception 'account disappeared during Stripe event update';
  end if;

  return 'applied';
end;
$$;

revoke all on function public.apply_stripe_account_event(
  uuid, text, text, text, text, bigint, text, text, uuid
) from public;

do $acl$
begin
  if to_regrole('anon') is not null then
    execute 'revoke all on function public.apply_stripe_account_event(uuid, text, text, text, text, bigint, text, text, uuid) from anon';
  end if;
  if to_regrole('authenticated') is not null then
    execute 'revoke all on function public.apply_stripe_account_event(uuid, text, text, text, text, bigint, text, text, uuid) from authenticated';
  end if;
  if to_regrole('service_role') is not null then
    execute 'grant execute on function public.apply_stripe_account_event(uuid, text, text, text, text, bigint, text, text, uuid) to service_role';
  end if;
end
$acl$;
