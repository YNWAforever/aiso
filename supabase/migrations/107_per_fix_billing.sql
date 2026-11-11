-- 107: Phase 4 per-fix billing. Design:
-- docs/superpowers/specs/2026-11-11-per-fix-billing-design.md (PR #224).
--
-- Three tables, no code depends on them yet:
--   account_billing     the platform administrator's billing control row per
--                       account: Stripe customer, the metered subscription item,
--                       and a closed mode ('included' | 'metered').
--   fix_billing_events  insert-only ledger, ONE row per billable generated fix
--                       pack. unique(fix_pack_id) is the double-billing guard;
--                       the Stripe meter-event identifier is minted from the
--                       same id, so a retry cannot charge twice.
--   billing_invoices    local mirror of one-off invoices the admin issues, so
--                       the admin and client lists render without a Stripe round
--                       trip and survive a Stripe outage.
--
-- Tenancy is in the key chain: fix billing rows carry account_id + client_id and
-- the FK is composite against clients (id, account_id), so a row cannot exist
-- outside the account that owns the brand. Financial rows are never deleted by
-- the app; a fix pack deletion (scan cleanup) nulls fix_pack_id but keeps the
-- ledger row and its identifier for reconciliation.
--
-- Posture follows 101: RLS enabled with app grants only, no policies (036).
-- aeo_app may SELECT/INSERT and may UPDATE state columns only. No DELETE on any
-- of the three.

create table if not exists public.account_billing (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  stripe_customer_id text not null unique,
  stripe_subscription_id text,
  stripe_metered_item_id text,
  mode text not null default 'included',
  -- Frozen platform-admin profile id. No FK: 042/043/046's rule, a decision
  -- outlives the person who made it, and profiles are never deleted anyway (049).
  opened_by uuid not null,
  opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_billing_mode_check check (mode in ('included', 'metered')),
  -- A metered row without a meter item would silently bill nothing.
  constraint account_billing_metered_shape_check
    check (mode <> 'metered'
           or (stripe_metered_item_id is not null and stripe_subscription_id is not null))
);

create table if not exists public.fix_billing_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  client_id uuid not null,
  -- Nullable only for the scan-cleanup cascade below; every app insert sets it.
  fix_pack_id uuid unique references public.fix_packs(id) on delete set null,
  -- The Stripe v2 meter event identifier, 'fixbilling:<fix_pack_id>', minted at
  -- insert time so a retry does not depend on fix_pack_id still existing.
  stripe_meter_event_identifier text not null,
  quantity integer not null default 1,
  state text not null default 'pending',
  attempts integer not null default 0,
  last_error_code text,
  created_at timestamptz not null default now(),
  reported_at timestamptz,
  constraint fix_billing_events_quantity_check check (quantity = 1),
  constraint fix_billing_events_state_check
    check (state in ('pending', 'reported', 'failed', 'void')),
  constraint fix_billing_events_identifier_check
    check (stripe_meter_event_identifier ~ '^fixbilling:[0-9a-f-]{36}$'),
  constraint fix_billing_events_reported_shape_check
    check (state <> 'reported' or reported_at is not null),
  constraint fix_billing_events_attempts_check check (attempts between 0 and 10),
  constraint fix_billing_events_error_code_check
    check (last_error_code is null or last_error_code ~ '^[A-Z][A-Z0-9_]{2,40}$'),
  constraint fix_billing_events_client_tenant_fkey
    foreign key (client_id, account_id)
    references public.clients (id, account_id)
    on delete restrict
);

create index if not exists fix_billing_events_scope_time_idx
  on public.fix_billing_events (account_id, client_id, created_at desc);

-- The admin retry queue: only rows that still need attention.
create index if not exists fix_billing_events_open_idx
  on public.fix_billing_events (state, created_at)
  where state <> 'reported';

create table if not exists public.billing_invoices (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete restrict,
  stripe_invoice_id text unique,
  description text not null,
  amount_cents integer not null,
  currency text not null,
  status text not null default 'draft',
  hosted_invoice_url text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_invoices_description_check
    check (char_length(btrim(description)) between 3 and 500),
  constraint billing_invoices_amount_check check (amount_cents > 0),
  constraint billing_invoices_currency_check check (currency in ('usd', 'hkd')),
  constraint billing_invoices_status_check
    check (status in ('draft', 'open', 'paid', 'void', 'uncollectible')),
  constraint billing_invoices_url_check
    check (hosted_invoice_url is null or hosted_invoice_url ~ '^https://')
);

create index if not exists billing_invoices_account_time_idx
  on public.billing_invoices (account_id, created_at desc);

alter table public.account_billing enable row level security;
alter table public.fix_billing_events enable row level security;
alter table public.billing_invoices enable row level security;

revoke all on public.account_billing from public;
revoke all on public.fix_billing_events from public;
revoke all on public.billing_invoices from public;

do $acl$
begin
  if to_regrole('anon') is not null then
    execute 'revoke all on public.account_billing from anon';
    execute 'revoke all on public.fix_billing_events from anon';
    execute 'revoke all on public.billing_invoices from anon';
  end if;
  if to_regrole('authenticated') is not null then
    execute 'revoke all on public.account_billing from authenticated';
    execute 'revoke all on public.fix_billing_events from authenticated';
    execute 'revoke all on public.billing_invoices from authenticated';
  end if;
  if to_regrole('service_role') is not null then
    execute 'revoke all on public.account_billing from service_role';
    execute 'revoke all on public.fix_billing_events from service_role';
    execute 'revoke all on public.billing_invoices from service_role';
  end if;
  if to_regrole('aeo_app') is not null then
    -- The admin control row can be opened/updated; it is never deleted.
    execute 'revoke all on public.account_billing from aeo_app';
    execute 'grant select, insert, update on public.account_billing to aeo_app';
    -- Ledger: insert once, then only state/attempts/reported_at/error move.
    execute 'revoke all on public.fix_billing_events from aeo_app';
    execute 'grant select, insert, update on public.fix_billing_events to aeo_app';
    execute 'revoke all on public.billing_invoices from aeo_app';
    execute 'grant select, insert, update on public.billing_invoices to aeo_app';
  end if;
end
$acl$;
