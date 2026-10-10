-- Expand only; unknown legacy rows are not silently upgraded to classified.
alter table public.pulse_metrics
  add column classification_status text not null default 'legacy_unknown'
    check (classification_status in ('classified','fallback','failed','legacy_unknown')),
  add column classifier_method text, add column classifier_version text,
  add column matched_text jsonb;
alter table public.pulse_run_items
  add column classification_attempt_count integer not null default 0 check (classification_attempt_count between 0 and 3),
  add column classification_lease_token uuid, add column classification_lease_until timestamptz,
  add column classification_fence bigint not null default 0,
  add column classification_next_at timestamptz not null default now(),
  add constraint classification_lease_pair check ((classification_lease_token is null) = (classification_lease_until is null));
create table public.pulse_classification_attempts (
  id uuid primary key default gen_random_uuid(),item_id uuid not null,provider_attempt_id uuid not null,
  account_id uuid not null,client_id uuid not null,attempt_number integer not null check (attempt_number between 1 and 3),
  lease_token uuid not null,fence bigint not null,started_at timestamptz not null default now(),finished_at timestamptz,
  status text not null default 'started' check (status in ('started','classified','fallback','failed','interrupted')),
  analysis jsonb,
  unique(item_id,attempt_number),
  foreign key(item_id,client_id,account_id) references public.pulse_run_items(id,client_id,account_id),
  foreign key(provider_attempt_id,item_id,client_id,account_id) references public.pulse_item_attempts(id,item_id,client_id,account_id)
);
create index pulse_classification_due on public.pulse_run_items(classification_status,classification_next_at,classification_lease_until);
revoke update,delete on public.pulse_classification_attempts from aeo_app;
grant select,insert on public.pulse_classification_attempts to aeo_app;
grant update(status,analysis,finished_at) on public.pulse_classification_attempts to aeo_app;
grant update(classification_attempt_count,classification_lease_token,classification_lease_until,
  classification_fence,classification_next_at) on public.pulse_run_items to aeo_app;
