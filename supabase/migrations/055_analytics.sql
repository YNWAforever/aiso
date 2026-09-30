-- 055: GA4 conversions connector (Phase 2, sub-project 2).
-- Spec: docs/superpowers/specs/2026-09-30-ga4-conversions-design.md (section 3.2)
--
-- Same tenancy rules as 054: composite (..., account_id) foreign keys, upsert keys
-- that lead with account_id, no RLS (036), and every query filters by account. A
-- binding can never pair one account's brand with another account's connection,
-- because the database refuses it.
--
-- EXECUTE on analytics_event_names_valid(): a CHECK constraint calls its function
-- as the role performing the INSERT or UPDATE, and PostgreSQL checks EXECUTE there,
-- so aeo_app must be able to run it or every write to analytics_bindings fails with
-- a permission error. What the earlier migrations establish:
--   * 037 sets default privileges for tables and sequences only, not functions.
--   * 038 added `alter default privileges in schema public grant execute on
--     functions to aeo_app`, but that only covers functions created by the role
--     that ran it (the migration owner), and says so itself.
--   * No later migration revokes PUBLIC's default EXECUTE on new functions, so the
--     function is executable by aeo_app today only by that PUBLIC default.
-- Rather than lean on either default, this migration revokes PUBLIC's EXECUTE (as
-- 024 and 027 do for their functions) and grants it to aeo_app explicitly, inside
-- the same to_regrole guard as the table grants.

-- A CHECK cannot contain a subquery, so per-element validation of key_events lives
-- in a function. IMMUTABLE: it reads nothing but its argument. A null element is
-- refused, not skipped: bool_and() over a null comparison yields null, so the
-- null case is stated outright.
create function public.analytics_event_names_valid(text[])
returns boolean
language sql
immutable
as $$
  select coalesce(bool_and(e is not null and char_length(e) between 1 and 40), true)
  from unnest($1) as e
$$;

create table public.analytics_bindings (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  client_id uuid not null,
  connection_id uuid not null,
  -- GA4 numeric identifiers, held as text. Only a WEB_DATA_STREAM binds.
  property_id text not null,
  stream_id text not null,
  -- The stream's host as Google reports it, raw. Compared to the brand's domain at
  -- bind time; the comparison is not stored.
  stream_host text not null,
  -- Exact, case-sensitive GA4 event names: Generate_Lead is not generate_lead.
  key_events text[] not null,
  events_chosen_at timestamptz not null default now(),
  -- Moves when a different stream is bound, not when the chosen events change:
  -- data for events that stay chosen remains valid.
  bound_at timestamptz not null default now(),
  backfill_pending boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint analytics_bindings_account_client_unique unique (account_id, client_id),
  constraint analytics_bindings_client_fk
    foreign key (client_id, account_id) references public.clients (id, account_id) on delete cascade,
  constraint analytics_bindings_connection_fk
    foreign key (connection_id, account_id) references public.google_connections (id, account_id) on delete cascade,
  constraint analytics_bindings_key_events_count_check
    check (cardinality(key_events) between 1 and 20),
  constraint analytics_bindings_key_events_names_check
    check (public.analytics_event_names_valid(key_events)),
  constraint analytics_bindings_property_id_check check (property_id ~ '^[0-9]+$'),
  constraint analytics_bindings_stream_id_check check (stream_id ~ '^[0-9]+$'),
  constraint analytics_bindings_stream_host_check check (char_length(stream_host) <= 253)
);

create index analytics_bindings_connection_idx
  on public.analytics_bindings (connection_id, account_id);

create table public.analytics_daily (
  account_id uuid not null,
  client_id uuid not null,
  date date not null,
  event_name text not null,
  -- The class is stored, not the raw referrer host. The AI-referrer list lives in
  -- code, so when it changes only the re-fetched window is reclassified; older
  -- history keeps the class it had (spec 3.2).
  source_class text not null,
  count bigint not null,
  synced_at timestamptz not null default now(),
  constraint analytics_daily_client_fk
    foreign key (client_id, account_id) references public.clients (id, account_id) on delete cascade,
  constraint analytics_daily_event_name_check
    check (char_length(event_name) between 1 and 40),
  constraint analytics_daily_source_class_check
    check (source_class in ('organic_search', 'ai_assistant', 'other')),
  constraint analytics_daily_count_check check (count >= 0),
  -- account_id leads for the reason search_console_daily_unique gives: a
  -- caller-supplied row with a mismatched account_id takes the INSERT path and the
  -- composite client FK rejects it, rather than overwriting another account's row.
  -- Every column is not null, so a plain unique suffices (no nulls-not-distinct).
  constraint analytics_daily_unique
    unique (account_id, client_id, date, event_name, source_class)
);

create table public.analytics_sync_runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  client_id uuid not null,
  -- The binding identity this run synced. Plain columns, deliberately no FK to
  -- google_connections: the ledger records what happened, and a later rebind or
  -- connection removal must not rewrite or cascade it away.
  connection_id uuid not null,
  property_id text not null,
  stream_id text not null,
  -- clock_timestamp(), not now(): now() is pinned to transaction start, so two
  -- runs recorded in one transaction would tie on ran_at.
  ran_at timestamptz not null default clock_timestamp(),
  outcome text not null,
  rows_written integer not null default 0 check (rows_written >= 0),
  data_through date,
  -- True when Google withheld or aggregated rows (thresholding, or rows folded
  -- into (other)) so the figures are known to be understated.
  data_withheld boolean not null default false,
  constraint analytics_sync_runs_client_fk
    foreign key (client_id, account_id) references public.clients (id, account_id) on delete cascade,
  -- Closed vocabulary, mirrored by ANALYTICS_SYNC_OUTCOMES in lib/integrations/analytics/state.ts.
  constraint analytics_sync_runs_outcome_check check (outcome in (
    'ok', 'revoked', 'access_lost', 'google_unavailable', 'quota',
    'domain_mismatch', 'not_entitled', 'vault_error', 'config_error', 'internal_error',
    'deferred', 'scope_missing', 'events_missing'
  ))
);

create index analytics_sync_runs_latest_idx
  on public.analytics_sync_runs (account_id, client_id, ran_at desc);

revoke all on public.analytics_bindings, public.analytics_daily, public.analytics_sync_runs from public;
revoke all on function public.analytics_event_names_valid(text[]) from public;

do $$ begin
  if to_regrole('aeo_app') is not null then
    revoke all on public.analytics_bindings, public.analytics_daily, public.analytics_sync_runs from aeo_app;
    -- Configuration: unbinding deletes it, and re-choosing events updates it.
    grant select, insert, update, delete on public.analytics_bindings to aeo_app;
    -- Each sync replaces the re-fetched window (delete then insert, one
    -- transaction), so a source that drops to zero does not keep a stale count.
    -- Nothing rewrites a row in place, so no UPDATE.
    grant select, insert, delete on public.analytics_daily to aeo_app;
    -- The ledger is insert-only: a run's row is never rewritten or removed, and
    -- the owner's state is the newest row.
    grant select, insert on public.analytics_sync_runs to aeo_app;
    -- The CHECK helper runs as the writing role; see the header.
    grant execute on function public.analytics_event_names_valid(text[]) to aeo_app;
  end if;
end $$;
