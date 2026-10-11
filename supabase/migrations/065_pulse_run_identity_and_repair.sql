-- Preserve the original weekly row as canonical; a retest has its own immutable identity.
alter table public.pulse_runs add column purpose text not null default 'canonical' check(purpose in ('canonical','retest')),
 add column intent_key text,add column source_run_id uuid;
alter table public.pulse_runs add constraint pulse_run_source_scope foreign key(source_run_id,client_id,account_id) references public.pulse_runs(id,client_id,account_id);
alter table public.pulse_runs drop constraint pulse_runs_client_id_scan_week_key;
create unique index pulse_run_canonical_week on public.pulse_runs(client_id,scan_week) where purpose='canonical';
create unique index pulse_run_retest_intent on public.pulse_runs(account_id,client_id,intent_key) where purpose='retest';
alter table public.pulse_runs add constraint pulse_retest_intent_required check(purpose<>'retest' or length(intent_key) between 8 and 128);
-- Append classification repair history for legacy rows without fabricating a collection manifest.
create table public.pulse_legacy_classification_attempts(
 id uuid primary key default gen_random_uuid(),account_id uuid not null,client_id uuid not null,
 observation_id uuid not null references public.pulse_metrics(id),intent_key text not null,
 answer_hash text not null,context jsonb not null,status text not null default 'started' check(status in ('started','classified','fallback','failed')),
 lease_token uuid not null,lease_until timestamptz not null,analysis jsonb,usage jsonb,
 created_at timestamptz not null default now(),finished_at timestamptz,
 unique(account_id,observation_id,intent_key),foreign key(client_id,account_id) references public.clients(id,account_id)
);
create index pulse_legacy_classification_scope on public.pulse_legacy_classification_attempts(account_id,client_id,observation_id);
grant select,insert,update on public.pulse_legacy_classification_attempts to aeo_app;
revoke delete on public.pulse_legacy_classification_attempts from aeo_app;
alter table public.pulse_classification_attempts add column usage jsonb;
grant update(usage) on public.pulse_classification_attempts to aeo_app;

-- Metadata on the compatibility writer. Historical unknowns stay NULL.
alter table public.pulse_metrics add column requested_model text,add column actual_model text,add column provider_request_id text,
 add column collected_at timestamptz,add column prompt_snapshot jsonb,add column brand_snapshot jsonb,add column provider_usage jsonb,add column provider_finish_reason text,add column source_schema_version text;
