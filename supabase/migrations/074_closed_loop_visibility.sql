-- Extend the existing monitored question identity; do not duplicate prompt text.
alter table public.prompt_bank add column monitoring jsonb
  check(monitoring is null or (jsonb_typeof(monitoring)='object' and octet_length(monitoring::text)<=8192));
create view public.monitored_queries as
  select p.id,c.account_id,p.client_id,p.question,p.language as locale,p.market,p.is_active,p.monitoring,
    (p.monitoring->>'locale'=p.language and p.monitoring->>'market'=p.market) as context_current
  from public.prompt_bank p join public.clients c on c.id=p.client_id;

-- Accepted, tenant-matched raw attempts are the observation source of truth.
-- A view avoids a second answer store becoming inconsistent with the ledger.
create view public.ai_observations as
  select a.id,i.id as item_id,i.account_id,i.client_id,i.run_id,i.prompt_snapshot_id as prompt_id,
    i.platform,i.snapshot,i.classification_status,a.requested_model,a.actual_model,a.finished_at,
    a.raw_answer,a.provider_citations,a.classification,r.manifest->'brand' as brand,r.purpose,a.grounding,a.search_evidence
  from public.pulse_run_items i join public.pulse_item_attempts a
    on a.id=i.accepted_attempt_id and a.item_id=i.id and a.account_id=i.account_id and a.client_id=i.client_id
    join public.pulse_runs r on r.id=i.run_id and r.account_id=i.account_id and r.client_id=i.client_id
  where i.status='succeeded' and a.collection_status='succeeded' and a.accepted;

create table public.visibility_reviews (
  id uuid primary key default gen_random_uuid(),account_id uuid not null,client_id uuid not null,
  observation_id uuid not null,item_id uuid not null,created_by uuid not null,created_at timestamptz not null default clock_timestamp(),
  recommendation text not null check(recommendation in ('recommended','excluded','neutral','unknown')),
  accuracy text not null check(accuracy in ('accurate','inaccurate','unknown')),
  risk text not null check(risk in ('low','medium','high','unknown')),
  notes text not null check(char_length(notes) between 1 and 2000),
  foreign key(observation_id,item_id,client_id,account_id) references public.pulse_item_attempts(id,item_id,client_id,account_id),
  foreign key(created_by,account_id) references public.profiles(id,account_id),
  foreign key(client_id,account_id) references public.clients(id,account_id) on delete cascade
);
create index visibility_reviews_latest on public.visibility_reviews(account_id,client_id,observation_id,created_at desc);
create table public.visibility_drafts (
  id uuid primary key default gen_random_uuid(),account_id uuid not null,client_id uuid not null,
  observation_id uuid not null,item_id uuid not null,created_by uuid not null,
  kind text not null check(kind in ('brief','schema','technical_patch')),locale text not null check(locale in ('en','zh-HK')),
  evidence_hash text not null check(evidence_hash ~ '^[a-f0-9]{64}$'),evidence jsonb not null,
  artifact text not null check(octet_length(artifact) between 1 and 65536),
  state text not null default 'draft' check(state='draft'),created_at timestamptz not null default now(),
  unique(account_id,client_id,observation_id,kind,locale,evidence_hash),unique(id,account_id,client_id),
  foreign key(observation_id,item_id,client_id,account_id) references public.pulse_item_attempts(id,item_id,client_id,account_id),
  foreign key(created_by,account_id) references public.profiles(id,account_id),
  foreign key(client_id,account_id) references public.clients(id,account_id) on delete cascade
);
create table public.visibility_settings (
  account_id uuid not null,client_id uuid not null,auto_retest boolean not null default false,
  enabled_by uuid,updated_at timestamptz not null default now(),primary key(account_id,client_id),
  foreign key(enabled_by,account_id) references public.profiles(id,account_id),
  foreign key(client_id,account_id) references public.clients(id,account_id) on delete cascade
);
create table public.visibility_revalidations (
  id uuid primary key default gen_random_uuid(),account_id uuid not null,client_id uuid not null,
  source_kind text not null check(source_kind in ('deployment','work_completion')),source_id uuid not null,
  source_at timestamptz not null,source_run_id uuid,retest_run_id uuid,
  urls jsonb not null check(jsonb_typeof(urls)='array' and jsonb_array_length(urls) between 1 and 20),
  baseline jsonb not null,status text not null default 'queued' check(status in ('queued','running','completed','blocked','failed','unknown')),
  reason text check(reason is null or reason ~ '^[A-Z0-9_]{1,80}$'),
  attempt_count integer not null default 0 check(attempt_count between 0 and 3),next_at timestamptz not null default now(),
  lease_token uuid,lease_until timestamptz,result jsonb,created_at timestamptz not null default now(),finished_at timestamptz,
  unique(account_id,client_id,source_kind,source_id),unique(id,account_id,client_id),
  foreign key(source_run_id,client_id,account_id) references public.pulse_runs(id,client_id,account_id),
  foreign key(retest_run_id,client_id,account_id) references public.pulse_runs(id,client_id,account_id),
  foreign key(client_id,account_id) references public.clients(id,account_id) on delete cascade
);
create index visibility_revalidations_due on public.visibility_revalidations(status,next_at,created_at);
create table public.visibility_revalidation_attempts (
  id uuid primary key default gen_random_uuid(),account_id uuid not null,client_id uuid not null,job_id uuid not null,
  attempt_number integer not null check(attempt_number between 1 and 3),lease_token uuid not null,
  status text not null default 'started' check(status in ('started','completed','blocked','failed','unknown')),
  reason text check(reason is null or reason ~ '^[A-Z0-9_]{1,80}$'),started_at timestamptz not null default clock_timestamp(),finished_at timestamptz,
  unique(account_id,client_id,job_id,attempt_number),
  foreign key(job_id,account_id,client_id) references public.visibility_revalidations(id,account_id,client_id) on delete cascade
);
revoke all on public.monitored_queries,public.ai_observations,public.visibility_reviews,public.visibility_drafts,
  public.visibility_settings,public.visibility_revalidations,public.visibility_revalidation_attempts from public;
do $$ begin if to_regrole('aeo_app') is not null then
  revoke all on public.monitored_queries,public.ai_observations,public.visibility_reviews,public.visibility_drafts,
    public.visibility_settings,public.visibility_revalidations,public.visibility_revalidation_attempts from aeo_app;
  grant select on public.monitored_queries,public.ai_observations to aeo_app;
  grant select,insert on public.visibility_reviews,public.visibility_drafts to aeo_app;
  grant select,insert,update on public.visibility_settings,public.visibility_revalidations,public.visibility_revalidation_attempts to aeo_app;
end if; end $$;
