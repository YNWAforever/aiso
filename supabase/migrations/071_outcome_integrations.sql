-- Additive outcome evidence. No production binding, role identity or RLS policy changes.
create table public.outcome_integration_settings (
  account_id uuid not null,
  client_id uuid not null,
  indexnow_key text check (indexnow_key is null or indexnow_key ~ '^[a-zA-Z0-9-]{8,128}$'),
  bound_domain text,
  score_drop_points integer not null default 10 check(score_drop_points between 1 and 100),
  outcome_drop_percent integer not null default 30 check(outcome_drop_percent between 1 and 100),
  minimum_samples integer not null default 25 check(minimum_samples between 1 and 100000),
  updated_at timestamptz not null default now(),
  primary key(account_id,client_id),
  foreign key(client_id,account_id) references public.clients(id,account_id) on delete cascade
);

create table public.outcome_ingest_credentials (
  id uuid primary key default gen_random_uuid(), account_id uuid not null, client_id uuid not null,
  created_by uuid not null,
  name text not null check(char_length(name) between 1 and 100),
  token_ciphertext bytea not null, token_key_id text not null,
  scopes text[] not null check(cardinality(scopes) between 1 and 3 and scopes <@ array['analytics','crawler','deployments']::text[]),
  created_at timestamptz not null default now(), revoked_at timestamptz,
  rate_window timestamptz, rate_count integer not null default 0 check(rate_count >= 0),
  foreign key(client_id,account_id) references public.clients(id,account_id) on delete cascade,
  foreign key(created_by,account_id) references public.profiles(id,account_id)
);
create index outcome_ingest_credentials_scope_idx on public.outcome_ingest_credentials(account_id,client_id,created_at);

create table public.outcome_query_clusters (
  id uuid primary key default gen_random_uuid(), account_id uuid not null, client_id uuid not null,
  name text not null check(char_length(name) between 1 and 100),
  keywords text[] not null check(cardinality(keywords) between 1 and 20),
  target_url text not null check(char_length(target_url) <= 2048),
  created_at timestamptz not null default now(),
  unique(id,account_id,client_id), unique(account_id,client_id,name),
  foreign key(client_id,account_id) references public.clients(id,account_id) on delete cascade
);

create table public.outcome_events (
  id uuid primary key default gen_random_uuid(), account_id uuid not null, client_id uuid not null,
  event_key text not null check(char_length(event_key) between 8 and 128),
  payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
  kind text not null check(kind in ('analytics','crawler')),
  occurred_at timestamptz not null, recorded_at timestamptz not null default now(),
  page_url text not null check(char_length(page_url) <= 2048),
  sessions integer not null default 0 check(sessions between 0 and 1000000000),
  conversions integer not null default 0 check(conversions between 0 and 1000000000),
  revenue_minor bigint not null default 0 check(revenue_minor between 0 and 1000000000),
  currency text check(currency is null or currency ~ '^[A-Z]{3}$'),
  crawler text check(crawler is null or char_length(crawler) <= 80),
  retrieval_verification text check(retrieval_verification is null or retrieval_verification in ('provider_ip_match','unverified','verification_unavailable')),
  verification_version text,
  unique(account_id,client_id,event_key),
  foreign key(client_id,account_id) references public.clients(id,account_id) on delete cascade,
  check((kind='analytics' and currency is not null and crawler is null and retrieval_verification is null)
     or (kind='crawler' and currency is null and sessions=0 and conversions=0 and revenue_minor=0 and crawler is not null and retrieval_verification is not null))
);
create index outcome_events_window_idx on public.outcome_events(account_id,client_id,occurred_at,page_url);

create table public.outcome_deployments (
  id uuid primary key default gen_random_uuid(), account_id uuid not null, client_id uuid not null,
  intent_key text not null, external_id text not null check(char_length(external_id) between 1 and 128),
  request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
  deployed_at timestamptz not null, recorded_at timestamptz not null default now(),
  urls jsonb not null check(jsonb_typeof(urls)='array' and jsonb_array_length(urls) between 1 and 20),
  baseline_scan_id uuid, work_item_id uuid,
  baseline jsonb check(baseline is null or jsonb_typeof(baseline)='object'),
  unique(account_id,client_id,intent_key), unique(account_id,client_id,external_id), unique(id,account_id,client_id),
  foreign key(client_id,account_id) references public.clients(id,account_id) on delete cascade
);
create index outcome_deployments_due_idx on public.outcome_deployments(account_id,client_id,deployed_at);

create table public.outcome_attempts (
  id uuid primary key default gen_random_uuid(), account_id uuid not null, client_id uuid not null,
  kind text not null check(kind in ('indexnow','regression','search_sync','revalidation')),
  intent_key text not null check(char_length(intent_key) between 8 and 128),
  request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
  request jsonb not null check(jsonb_typeof(request)='object'),
  status text not null default 'running' check(status in ('running','succeeded','failed','unknown','blocked','partial','skipped')),
  reason text check(reason is null or reason ~ '^[A-Z0-9_]{1,80}$'),
  http_status integer check(http_status is null or http_status between 100 and 599),
  started_at timestamptz not null default clock_timestamp(), finished_at timestamptz,
  unique(account_id,client_id,kind,intent_key), unique(id,account_id,client_id),
  foreign key(client_id,account_id) references public.clients(id,account_id) on delete cascade
);
create index outcome_attempts_scope_idx on public.outcome_attempts(account_id,client_id,started_at desc);

create table public.outcome_attempt_receipts (
  id uuid primary key default gen_random_uuid(), account_id uuid not null, client_id uuid not null,
  attempt_id uuid not null, status text not null check(status in ('succeeded','failed','unknown','blocked','partial','skipped')),
  reason text not null check(reason ~ '^[A-Z0-9_]{1,80}$'),
  recorded_at timestamptz not null default clock_timestamp(), unique(account_id,client_id,attempt_id),
  foreign key(attempt_id,account_id,client_id) references public.outcome_attempts(id,account_id,client_id) on delete cascade
);

create table public.outcome_regressions (
  id uuid primary key default gen_random_uuid(), account_id uuid not null, client_id uuid not null,
  deployment_id uuid not null, window_end date not null,
  rule text not null check(rule in ('score_drop','search_click_drop','conversion_drop')),
  state text not null check(state in ('regressed','stable','insufficient_evidence','not_comparable')),
  evidence jsonb not null check(jsonb_typeof(evidence)='object'),
  created_at timestamptz not null default now(),
  unique(account_id,client_id,deployment_id,rule,window_end),
  foreign key(deployment_id,account_id,client_id) references public.outcome_deployments(id,account_id,client_id) on delete cascade
);

revoke all on public.outcome_integration_settings,public.outcome_ingest_credentials,public.outcome_query_clusters,
  public.outcome_events,public.outcome_deployments,public.outcome_attempts,public.outcome_attempt_receipts,public.outcome_regressions from public;
do $$ begin
  if to_regrole('aeo_app') is not null then
    -- 037 grants default DML on future tables; narrow those inherited rights.
    revoke all on public.outcome_integration_settings,public.outcome_ingest_credentials,public.outcome_query_clusters,
      public.outcome_events,public.outcome_deployments,public.outcome_attempts,public.outcome_attempt_receipts,public.outcome_regressions from aeo_app;
    grant select,insert,update on public.outcome_integration_settings,public.outcome_ingest_credentials to aeo_app;
    grant select,insert on public.outcome_query_clusters,public.outcome_events,public.outcome_deployments,public.outcome_attempt_receipts,public.outcome_regressions to aeo_app;
    grant select,insert,update on public.outcome_attempts to aeo_app;
  end if;
end $$;
