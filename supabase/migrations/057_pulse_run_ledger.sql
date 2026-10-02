-- Expand-only ledger. No synthetic backfill of historical model/denominator data.
create table public.pulse_runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  client_id uuid not null,
  scan_week date not null check (extract(isodow from scan_week) = 1),
  manifest jsonb not null,
  status text not null default 'queued' check (status in ('queued','running','partial','completed','failed','blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, scan_week), unique (id, client_id, account_id),
  foreign key (client_id, account_id) references public.clients(id, account_id)
);
create table public.pulse_run_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  account_id uuid not null,
  client_id uuid not null,
  prompt_snapshot_id uuid not null,
  snapshot jsonb not null,
  platform text not null,
  model_id text not null,
  status text not null default 'queued' check (status in ('queued','running','retry_wait','succeeded','failed','blocked')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 3),
  lease_owner text, lease_token uuid, lease_until timestamptz,
  fence bigint not null default 0,
  next_attempt_at timestamptz not null default now(),
  accepted_attempt_id uuid,
  classification_status text not null default 'unknown' check (classification_status in ('unknown','classified','fallback','failed','legacy_unknown')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (run_id, prompt_snapshot_id, model_id), unique (id, client_id, account_id),
  foreign key (run_id, client_id, account_id) references public.pulse_runs(id, client_id, account_id),
  foreign key (client_id, account_id) references public.clients(id, account_id),
  check ((lease_token is null) = (lease_until is null))
);
create table public.pulse_item_attempts (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null, account_id uuid not null, client_id uuid not null,
  attempt_number integer not null check (attempt_number between 1 and 3),
  lease_token uuid not null, fence bigint not null,
  started_at timestamptz not null default now(), finished_at timestamptz,
  collection_status text not null default 'started' check (collection_status in ('started','succeeded','failed','blocked','interrupted')),
  accepted boolean not null default false,
  requested_model text not null, actual_model text, provider_request_id text,
  collector text not null default 'openrouter_api', collector_version text not null default '2026-10-03.v1',
  raw_answer text, prompt_tokens integer, completion_tokens integer, cost_usd numeric,
  http_status integer, error_code text,
  classification jsonb, classifier_method text, classifier_version text,
  unique (item_id, attempt_number),
  unique (id, item_id, client_id, account_id),
  foreign key (item_id, client_id, account_id) references public.pulse_run_items(id, client_id, account_id),
  foreign key (client_id, account_id) references public.clients(id, account_id)
);
alter table public.pulse_run_items add constraint pulse_item_accepted_attempt
  foreign key (accepted_attempt_id, id, client_id, account_id) references public.pulse_item_attempts(id, item_id, client_id, account_id);
create index pulse_items_due on public.pulse_run_items(status, next_attempt_at, lease_until);
create index pulse_runs_scope on public.pulse_runs(account_id, client_id, scan_week);
alter table public.pulse_metrics add column run_item_id uuid references public.pulse_run_items(id);
create unique index pulse_metrics_run_item on public.pulse_metrics(run_item_id) where run_item_id is not null;
-- Keep immutable run snapshots and successful legacy observations after prompt deletion.
alter table public.pulse_metrics drop constraint pulse_metrics_prompt_id_fkey;
alter table public.pulse_metrics add constraint pulse_metrics_prompt_id_fkey
  foreign key (prompt_id) references public.prompt_bank(id) on delete set null;
grant select, insert on public.pulse_runs, public.pulse_run_items, public.pulse_item_attempts to aeo_app;
revoke update on public.pulse_runs, public.pulse_run_items from aeo_app;
grant update(status,updated_at) on public.pulse_runs to aeo_app;
grant update(status,attempt_count,lease_owner,lease_token,lease_until,fence,next_attempt_at,accepted_attempt_id,classification_status,updated_at)
  on public.pulse_run_items to aeo_app;
grant update on public.pulse_item_attempts to aeo_app;
