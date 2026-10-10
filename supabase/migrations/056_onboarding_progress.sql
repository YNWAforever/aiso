-- Expand-only: retries retain brand, scan, trial and manual questions.
create table public.onboarding_progress (
  account_id uuid not null references public.accounts(id),
  intent_key text not null check (length(intent_key) between 1 and 128),
  client_id uuid not null,
  scan_id uuid references public.scans(id),
  draft jsonb not null check (pg_column_size(draft) <= 16384),
  prompt_status text not null default 'pending' check (prompt_status in ('pending','running','ready','failed')),
  prompt_count integer not null default 0 check (prompt_count >= 0),
  seed_version text not null default '2026-10-03.v1',
  error_code text,
  lease_token uuid,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (account_id, intent_key),
  unique (account_id, client_id),
  foreign key (client_id, account_id) references public.clients(id, account_id),
  check ((lease_token is null) = (lease_until is null))
);
create index onboarding_progress_client on public.onboarding_progress(account_id, client_id);
alter table public.prompt_bank add column onboarding_seed_key text;
create unique index prompt_bank_onboarding_seed on public.prompt_bank(client_id, onboarding_seed_key)
  where onboarding_seed_key is not null;
grant select, insert, update on public.onboarding_progress to aeo_app;
