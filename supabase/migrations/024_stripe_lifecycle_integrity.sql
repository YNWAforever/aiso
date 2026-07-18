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
revoke all on table public.stripe_webhook_events from public, anon, authenticated;
grant select, insert on table public.stripe_webhook_events to service_role;

create or replace function public.apply_stripe_account_event(
  p_account_id uuid,
  p_subscription_id text,
  p_customer_id text,
  p_plan text,
  p_status text,
  p_event_created bigint,
  p_event_id text,
  p_event_type text
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

  -- Equal-second events are safe because the handler retrieves canonical Stripe state.
  -- Event IDs are identity keys only; their lexical order is never treated as chronology.
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
  uuid, text, text, text, text, bigint, text, text
) from public, anon, authenticated;
grant execute on function public.apply_stripe_account_event(
  uuid, text, text, text, text, bigint, text, text
) to service_role;
