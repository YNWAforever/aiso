-- 054: Google connection + Search Console connector (Phase 2, sub-project 1).
-- Spec: docs/superpowers/specs/2026-09-24-search-console-connector-design.md
--
-- Tenancy is carried by composite foreign keys, per 041-046: a binding can never
-- pair one account's brand with another account's connection, because the
-- database refuses it. No RLS (036); every query filters by account.

create table public.google_connections (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  google_subject text not null,
  google_email text,
  scopes text[] not null,
  -- AES-256-GCM output from lib/integrations/google/vault.ts. Null once revoked:
  -- disconnecting deletes the credential, not the row explaining the history.
  token_ciphertext bytea,
  token_key_id text,
  status text not null default 'active',
  connected_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, google_subject),
  unique (id, account_id),
  constraint google_connections_status_check
    check (status in ('active', 'needs_reconnect', 'revoked')),
  -- A usable connection has a credential; a revoked one has none.
  constraint google_connections_token_check check ((
    (status = 'revoked' and token_ciphertext is null and token_key_id is null)
    or (status <> 'revoked' and token_ciphertext is not null and token_key_id is not null)
  ) is true),
  -- Provenance, so erasable. Column-list form: plain `set null` would also null
  -- account_id, which is NOT NULL — the 044/046 trap. 053 uses the same form.
  constraint google_connections_connected_by_fk
    foreign key (connected_by, account_id) references public.profiles (id, account_id)
    on delete set null (connected_by)
);

create table public.search_console_bindings (
  account_id uuid not null,
  client_id uuid not null,
  connection_id uuid not null,
  site_url text not null,
  permission_level text not null,
  -- The brand's domain when bound. If clients.domain changes the binding reads
  -- as mismatched and stops syncing — domain verification's (053) behaviour.
  bound_domain text not null,
  backfill_pending boolean not null default true,
  bound_by uuid,
  bound_at timestamptz not null default now(),
  primary key (account_id, client_id),
  constraint search_console_bindings_client_fk
    foreign key (client_id, account_id) references public.clients (id, account_id) on delete cascade,
  constraint search_console_bindings_connection_fk
    foreign key (connection_id, account_id) references public.google_connections (id, account_id) on delete cascade,
  constraint search_console_bindings_bound_by_fk
    foreign key (bound_by, account_id) references public.profiles (id, account_id)
    on delete set null (bound_by)
);

create table public.search_console_daily (
  account_id uuid not null,
  client_id uuid not null,
  date date not null,
  scope text not null,
  page_url text,
  clicks integer not null check (clicks >= 0),
  impressions integer not null check (impressions >= 0),
  ctr double precision not null check (ctr >= 0 and ctr <= 1),
  position double precision not null check (position >= 0),
  synced_at timestamptz not null default now(),
  constraint search_console_daily_client_fk
    foreign key (client_id, account_id) references public.clients (id, account_id) on delete cascade,
  constraint search_console_daily_scope_check check ((
    (scope = 'property' and page_url is null) or (scope = 'page' and page_url is not null)
  ) is true),
  -- NULLS NOT DISTINCT (PostgreSQL 15+): property rows share a null page_url, and
  -- a plain unique would let a re-sync insert them twice — pulse_metrics' defect.
  constraint search_console_daily_unique
    unique nulls not distinct (client_id, scope, page_url, date)
);

create table public.search_console_page_queries (
  account_id uuid not null,
  client_id uuid not null,
  page_url text not null,
  date date not null,
  query text not null,
  clicks integer not null check (clicks >= 0),
  impressions integer not null check (impressions >= 0),
  ctr double precision not null check (ctr >= 0 and ctr <= 1),
  position double precision not null check (position >= 0),
  constraint search_console_page_queries_client_fk
    foreign key (client_id, account_id) references public.clients (id, account_id) on delete cascade,
  constraint search_console_page_queries_unique unique (client_id, page_url, date, query)
);

create table public.search_console_sync_runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  client_id uuid not null,
  ran_at timestamptz not null default now(),
  outcome text not null,
  rows_written integer not null default 0 check (rows_written >= 0),
  data_through date,
  constraint search_console_sync_runs_client_fk
    foreign key (client_id, account_id) references public.clients (id, account_id) on delete cascade,
  -- Closed vocabulary, mirrored by SYNC_OUTCOMES in lib/integrations/search-console/state.ts.
  constraint search_console_sync_runs_outcome_check check (outcome in (
    'ok', 'revoked', 'access_lost', 'google_unavailable', 'quota',
    'domain_mismatch', 'not_entitled', 'vault_error', 'config_error'
  ))
);

create index search_console_sync_runs_latest_idx
  on public.search_console_sync_runs (account_id, client_id, ran_at desc);
create index search_console_daily_read_idx
  on public.search_console_daily (account_id, client_id, date desc);

revoke all on public.google_connections, public.search_console_bindings, public.search_console_daily,
  public.search_console_page_queries, public.search_console_sync_runs from public;

do $$ begin
  if to_regrole('aeo_app') is not null then
    revoke all on public.google_connections, public.search_console_bindings, public.search_console_daily,
      public.search_console_page_queries, public.search_console_sync_runs from aeo_app;
    -- Bindings are configuration: unbinding and revoking delete them.
    grant select, insert, update, delete on public.search_console_bindings to aeo_app;
    grant select, insert, update on public.google_connections to aeo_app;
    -- History: no DELETE. Disconnecting removes the credential, not the record.
    grant select, insert, update on public.search_console_daily to aeo_app;
    grant select, insert, update on public.search_console_page_queries to aeo_app;
    grant select, insert, update on public.search_console_sync_runs to aeo_app;
  end if;
end $$;
