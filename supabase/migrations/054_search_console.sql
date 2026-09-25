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
  -- A usable connection has a credential; a revoked one has none. Folded in:
  -- a present token_key_id must be non-empty, not just non-null.
  constraint google_connections_token_check check ((
    (status = 'revoked' and token_ciphertext is null and token_key_id is null)
    or (status <> 'revoked' and token_ciphertext is not null and token_key_id is not null)
  ) is true and (token_key_id is null or token_key_id <> '')),
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
    on delete set null (bound_by),
  -- Mirrors client_domain_verifications_domain_check (053): already lowercase,
  -- trimmed, and dotted.
  constraint search_console_bindings_domain_check
    check ((bound_domain = lower(btrim(bound_domain)) and bound_domain like '%.%') is true),
  constraint search_console_bindings_permission_check
    check (permission_level in ('siteOwner', 'siteFullUser', 'siteRestrictedUser'))
);

create index search_console_bindings_connection_idx
  on public.search_console_bindings (connection_id, account_id);

create table public.search_console_daily (
  account_id uuid not null,
  client_id uuid not null,
  date date not null,
  scope text not null,
  page_url text,
  clicks integer not null check (clicks >= 0),
  impressions integer not null check (impressions >= 0),
  ctr double precision not null check (ctr >= 0 and ctr <= 1),
  -- NaN compares greater than everything in PostgreSQL, so bounding the top
  -- rejects it along with Infinity; missing metrics default to 0 in the client,
  -- so the floor stays 0, not 1.
  position double precision not null check (position >= 0 and position < 'Infinity'),
  synced_at timestamptz not null default now(),
  constraint search_console_daily_client_fk
    foreign key (client_id, account_id) references public.clients (id, account_id) on delete cascade,
  constraint search_console_daily_scope_check check ((
    (scope = 'property' and page_url is null) or (scope = 'page' and page_url is not null)
  ) is true),
  constraint search_console_daily_page_url_length_check
    check (page_url is null or char_length(page_url) <= 2048),
  -- NULLS NOT DISTINCT (PostgreSQL 15+): property rows share a null page_url, and
  -- a plain unique would let a re-sync insert them twice — pulse_metrics' defect.
  -- account_id leads so a caller-supplied row with a mismatched account_id takes
  -- the INSERT path (not a same-key UPDATE) and the composite client FK rejects
  -- it, rather than silently overwriting another account's metrics row. The same
  -- key serves the 28-day-by-client read, so no separate read index is needed.
  constraint search_console_daily_unique
    unique nulls not distinct (account_id, client_id, date, scope, page_url)
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
  position double precision not null check (position >= 0 and position < 'Infinity'),
  constraint search_console_page_queries_client_fk
    foreign key (client_id, account_id) references public.clients (id, account_id) on delete cascade,
  constraint search_console_page_queries_page_url_length_check
    check (char_length(page_url) <= 2048),
  constraint search_console_page_queries_query_length_check
    check (char_length(query) <= 512),
  -- account_id leads for the same reason as search_console_daily_unique above.
  constraint search_console_page_queries_unique
    unique (account_id, client_id, page_url, date, query)
);

create table public.search_console_sync_runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  client_id uuid not null,
  -- clock_timestamp(), not now(): now() is pinned to transaction start, so two
  -- runs recorded in one transaction would tie on ran_at.
  ran_at timestamptz not null default clock_timestamp(),
  outcome text not null,
  rows_written integer not null default 0 check (rows_written >= 0),
  data_through date,
  constraint search_console_sync_runs_client_fk
    foreign key (client_id, account_id) references public.clients (id, account_id) on delete cascade,
  -- Closed vocabulary, mirrored by SYNC_OUTCOMES in lib/integrations/search-console/state.ts.
  constraint search_console_sync_runs_outcome_check check (outcome in (
    'ok', 'revoked', 'access_lost', 'google_unavailable', 'quota',
    'domain_mismatch', 'not_entitled', 'vault_error', 'config_error', 'internal_error',
    'deferred'
  ))
);

create index search_console_sync_runs_latest_idx
  on public.search_console_sync_runs (account_id, client_id, ran_at desc);
-- Serves "what's the last successful sync" without scanning failed/retried runs.
create index search_console_sync_runs_last_good_idx
  on public.search_console_sync_runs (account_id, client_id, data_through desc)
  where outcome = 'ok';

-- Retention is deliberately unbounded for now: nothing here prunes old daily
-- rows, page/query rows, or sync-run history. Bounding it later is an
-- owner-role job (aeo_app has no DELETE on two of these three tables anyway),
-- not a change to this migration.

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
    -- Query rows are the one exception: sync replaces a page's re-fetched query
    -- window (delete then insert, one transaction) each run. Replacing a window
    -- Google itself revised is not deleting history; daily metrics and the
    -- ledger stay no-DELETE.
    grant select, insert, update, delete on public.search_console_page_queries to aeo_app;
    grant select, insert, update on public.search_console_sync_runs to aeo_app;
  end if;
end $$;
