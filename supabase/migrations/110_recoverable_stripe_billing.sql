-- Persist the intent before making a non-transactional Stripe request.
create table public.stripe_customer_attempts (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  email text,
  started_at timestamptz not null default clock_timestamp()
);

create table public.stripe_subscription_attempts (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  lease_owner uuid,
  lease_until timestamptz,
  operation_id uuid unique,
  kind text check (kind in ('checkout', 'admin')),
  payload jsonb,
  stripe_object_id text,
  started_at timestamptz,
  check ((lease_owner is null) = (lease_until is null)),
  check ((operation_id is null and kind is null and payload is null and stripe_object_id is null and started_at is null)
    or (operation_id is not null and kind is not null and payload is not null and started_at is not null))
);

alter table public.billing_invoices
  add column request_id uuid,
  add column issue_stage smallint not null default 0 check (issue_stage between 0 and 4),
  add column issue_days_until_due integer check (issue_days_until_due between 1 and 90),
  add column issue_lease_owner uuid,
  add column issue_lease_until timestamptz,
  add constraint billing_invoices_issue_lease_pair check ((issue_lease_owner is null) = (issue_lease_until is null)),
  add constraint billing_invoices_issue_request_unique unique (account_id, request_id);

alter table public.stripe_customer_attempts enable row level security;
alter table public.stripe_subscription_attempts enable row level security;
revoke all on public.stripe_customer_attempts, public.stripe_subscription_attempts from public, aeo_app;
grant select, insert, update on public.stripe_subscription_attempts to aeo_app;
grant select, insert, delete on public.stripe_customer_attempts to aeo_app;
