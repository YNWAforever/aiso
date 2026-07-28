-- Immutable, tenant-owned client report snapshots and service-only mutation RPCs.

-- public_slug generation below calls public.gen_random_bytes(), which is part of
-- pgcrypto. No earlier migration enables it — this project's Supabase origin had
-- it on by default, but a fresh Neon database does not. `if not exists` makes
-- this safe to run whether or not some out-of-band process already enabled it.
create extension if not exists pgcrypto with schema public;

-- 021_local_trust_roi.sql already creates this constraint (its local_trust_*
-- tables reference clients(id, account_id)). Production has 021 applied and this
-- migration not yet applied; a fresh sequential run applies both. Either order
-- must work, so create it only when absent rather than unconditionally.
do $clients_tenant_unique$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clients_id_account_id_unique'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_id_account_id_unique unique (id, account_id);
  end if;
end
$clients_tenant_unique$;

alter table public.scans
  add constraint scans_id_account_id_unique unique (id, account_id);

alter table public.profiles
  add constraint profiles_id_account_id_unique unique (id, account_id);

create table public.account_report_branding (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  agency_name text not null,
  logo_url text,
  primary_color text not null default '#111827',
  contact_label text,
  contact_url text,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_report_branding_agency_name_check
    check (char_length(btrim(agency_name)) between 1 and 120),
  constraint account_report_branding_logo_url_check
    check (logo_url is null or char_length(logo_url) between 1 and 2048),
  constraint account_report_branding_primary_color_check
    check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint account_report_branding_contact_pair_check
    check (
      (contact_label is null and contact_url is null)
      or (
        contact_label is not null
        and contact_url is not null
        and char_length(btrim(contact_label)) between 1 and 80
        and char_length(contact_url) between 1 and 2048
      )
    ),
  constraint account_report_branding_updated_by_tenant_fkey
    foreign key (updated_by, account_id)
    references public.profiles (id, account_id)
    on delete set null (updated_by)
);

create table public.client_reports (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  client_id uuid not null,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'revoked')),
  public_slug text not null default pg_catalog.translate(
    pg_catalog.rtrim(pg_catalog.encode(public.gen_random_bytes(24), 'base64'), '='),
    '+/',
    '-_'
  ),
  share_version integer not null default 1 check (share_version > 0),
  latest_version_id uuid,
  published_version_id uuid,
  view_count bigint not null default 0 check (view_count >= 0),
  cta_click_count bigint not null default 0 check (cta_click_count >= 0),
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  published_at timestamptz,
  revoked_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_reports_public_slug_format_check
    check (public_slug ~ '^[A-Za-z0-9_-]{32}$'),
  constraint client_reports_client_tenant_fkey
    foreign key (client_id, account_id)
    references public.clients (id, account_id)
    on delete cascade,
  constraint client_reports_created_by_tenant_fkey
    foreign key (created_by, account_id)
    references public.profiles (id, account_id)
    on delete set null (created_by),
  unique (id, account_id, client_id)
);

create table public.client_report_versions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null,
  account_id uuid not null,
  client_id uuid not null,
  version_number integer not null check (version_number > 0),
  source_scan_id uuid,
  previous_scan_id uuid,
  locale text not null check (locale in ('en', 'zh-HK')),
  executive_summary text not null
    check (char_length(executive_summary) between 1 and 1200),
  snapshot_schema_version integer not null check (snapshot_schema_version = 1),
  snapshot jsonb not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint client_report_versions_report_tenant_fkey
    foreign key (report_id, account_id, client_id)
    references public.client_reports (id, account_id, client_id)
    on delete cascade,
  constraint client_report_versions_source_scan_tenant_fkey
    foreign key (source_scan_id, account_id)
    references public.scans (id, account_id)
    on delete set null (source_scan_id),
  constraint client_report_versions_previous_scan_tenant_fkey
    foreign key (previous_scan_id, account_id)
    references public.scans (id, account_id)
    on delete set null (previous_scan_id),
  constraint client_report_versions_created_by_tenant_fkey
    foreign key (created_by, account_id)
    references public.profiles (id, account_id)
    on delete set null (created_by),
  unique (report_id, version_number),
  unique (id, report_id)
);

alter table public.client_reports
  add constraint client_reports_latest_version_id_fkey
    foreign key (latest_version_id, id)
    references public.client_report_versions (id, report_id)
    deferrable initially deferred,
  add constraint client_reports_published_version_id_fkey
    foreign key (published_version_id, id)
    references public.client_report_versions (id, report_id)
    deferrable initially deferred;

create index account_report_branding_updated_by_idx
  on public.account_report_branding (updated_by);
create index client_reports_account_client_created_idx
  on public.client_reports (account_id, client_id, created_at desc);
create unique index client_reports_public_slug_idx
  on public.client_reports (public_slug);
create index client_reports_created_by_idx
  on public.client_reports (created_by);
create index client_report_versions_tenant_report_idx
  on public.client_report_versions (account_id, client_id, report_id, version_number desc);
create index client_report_versions_source_scan_idx
  on public.client_report_versions (source_scan_id, account_id);
create index client_report_versions_previous_scan_idx
  on public.client_report_versions (previous_scan_id, account_id);
create index client_report_versions_created_by_idx
  on public.client_report_versions (created_by);
create index scans_account_domain_created_idx
  on public.scans (account_id, domain, created_at desc);

alter table public.account_report_branding enable row level security;
alter table public.client_reports enable row level security;
alter table public.client_report_versions enable row level security;

-- RLS is enabled above but deliberately carries NO policies. RLS with zero
-- policies is default-deny, which is the safest posture available here.
--
-- This migration was written for Supabase and originally created six
-- `to authenticated` policies scoped by `(select auth.uid())`. Neither half of
-- that survives the move to Neon:
--
--  * The `authenticated` role does not exist, so `to authenticated` cannot even
--    be parsed. Dropping the role clause would make each policy apply to PUBLIC
--    instead — a strict broadening. It would then also bind neondb_owner the
--    moment anyone sets FORCE ROW LEVEL SECURITY, which `to authenticated`
--    never would have.
--  * `auth.uid()` is a leftover Supabase artifact
--    (`select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid`).
--    Neon Auth never sets that PostgREST GUC, so it returns NULL and every
--    policy matches nothing. Depending on it would also make this migration
--    un-appliable the moment the dead `auth` schema is cleaned up — see the RLS
--    section of CLAUDE.md, which calls for exactly that cleanup. This migration
--    is still pending, so that ordering is a live risk, not a hypothetical.
--
-- Default-deny is behaviourally identical to a policy that never matches, minus
-- the false signal that tenant isolation is enforced in the database. It is not:
-- every query must filter by account_id explicitly, and the RPCs below are
-- SECURITY DEFINER with their own explicit account_id/client_id predicates.
-- Reintroduce policies here only alongside a real least-privilege role and a
-- tenant-identity function that actually resolves under Neon Auth.

-- Supabase's anon/authenticated/service_role roles do not exist under Neon.
-- Guard every grant/revoke that names them, matching the do $acl$ pattern used
-- in 023-026 and 028, so the privilege lockdown still takes effect if those
-- roles are ever created (e.g. a future least-privilege application role).
revoke all on table public.account_report_branding from public;
do $acl$
begin
  if to_regrole('anon') is not null then
    execute 'revoke all on table public.account_report_branding from anon';
  end if;
  if to_regrole('authenticated') is not null then
    execute 'revoke all on table public.account_report_branding from authenticated';
    execute 'grant select, insert, update, delete on table public.account_report_branding to authenticated';
  end if;
  if to_regrole('service_role') is not null then
    execute 'grant select, insert, update, delete on table public.account_report_branding to service_role';
  end if;
end
$acl$;

revoke all on table public.client_reports from public;
do $acl$
begin
  if to_regrole('anon') is not null then
    execute 'revoke all on table public.client_reports from anon';
  end if;
  if to_regrole('authenticated') is not null then
    execute 'revoke all on table public.client_reports from authenticated';
    execute 'grant select on table public.client_reports to authenticated';
  end if;
  if to_regrole('service_role') is not null then
    execute 'revoke all on table public.client_reports from service_role';
    execute 'grant select on table public.client_reports to service_role';
  end if;
end
$acl$;

revoke all on table public.client_report_versions from public;
do $acl$
begin
  if to_regrole('anon') is not null then
    execute 'revoke all on table public.client_report_versions from anon';
  end if;
  if to_regrole('authenticated') is not null then
    execute 'revoke all on table public.client_report_versions from authenticated';
    execute 'grant select on table public.client_report_versions to authenticated';
  end if;
  if to_regrole('service_role') is not null then
    execute 'revoke all on table public.client_report_versions from service_role';
    execute 'grant select on table public.client_report_versions to service_role';
    execute 'revoke update, delete on table public.client_report_versions from service_role';
  end if;
end
$acl$;

create or replace function public.create_client_report_with_version(
  p_account_id uuid,
  p_client_id uuid,
  p_source_scan_id uuid,
  p_previous_scan_id uuid,
  p_locale text,
  p_executive_summary text,
  p_snapshot_schema_version integer,
  p_snapshot jsonb,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  new_report public.client_reports;
  new_version public.client_report_versions;
  client_domain text;
  source_domain text;
  source_created_at timestamptz;
  previous_domain text;
  previous_created_at timestamptz;
begin
  select clients.domain
  into client_domain
  from public.clients
  where clients.id = p_client_id
    and clients.account_id = p_account_id;

  if not found
    or client_domain is null
    or pg_catalog.btrim(client_domain) = ''
    or pg_catalog.strpos(client_domain, '://') > 0
    or pg_catalog.strpos(client_domain, '/') > 0
    or pg_catalog.strpos(client_domain, '?') > 0
    or pg_catalog.strpos(client_domain, '#') > 0
  then
    raise exception 'CLIENT_REPORT_NOT_FOUND';
  end if;

  select scans.domain, scans.created_at
  into source_domain, source_created_at
  from public.scans
  where scans.id = p_source_scan_id
    and scans.account_id = p_account_id;

  if not found
    or source_domain is null
    or source_created_at is null
    or pg_catalog.strpos(source_domain, '://') > 0
    or pg_catalog.strpos(source_domain, '/') > 0
    or pg_catalog.strpos(source_domain, '?') > 0
    or pg_catalog.strpos(source_domain, '#') > 0
    or pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(source_domain)), '^www\.', '')
      <> pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(client_domain)), '^www\.', '')
  then
    raise exception 'CLIENT_REPORT_SCAN_NOT_FOUND';
  end if;

  if p_previous_scan_id is not null then
    select scans.domain, scans.created_at
    into previous_domain, previous_created_at
    from public.scans
    where scans.id = p_previous_scan_id
      and scans.account_id = p_account_id;

    if not found
      or previous_domain is null
      or previous_created_at is null
      or previous_created_at >= source_created_at
      or pg_catalog.strpos(previous_domain, '://') > 0
      or pg_catalog.strpos(previous_domain, '/') > 0
      or pg_catalog.strpos(previous_domain, '?') > 0
      or pg_catalog.strpos(previous_domain, '#') > 0
      or pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(previous_domain)), '^www\.', '')
        <> pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(client_domain)), '^www\.', '')
    then
      raise exception 'CLIENT_REPORT_PREVIOUS_SCAN_INVALID';
    end if;
  end if;

  insert into public.client_reports (account_id, client_id, created_by)
  values (p_account_id, p_client_id, p_created_by)
  returning * into new_report;

  insert into public.client_report_versions (
    report_id,
    account_id,
    client_id,
    version_number,
    source_scan_id,
    previous_scan_id,
    locale,
    executive_summary,
    snapshot_schema_version,
    snapshot,
    created_by
  ) values (
    new_report.id,
    p_account_id,
    p_client_id,
    1,
    p_source_scan_id,
    p_previous_scan_id,
    p_locale,
    p_executive_summary,
    p_snapshot_schema_version,
    p_snapshot,
    p_created_by
  )
  returning * into new_version;

  update public.client_reports
  set latest_version_id = new_version.id,
      updated_at = pg_catalog.now()
  where client_reports.id = new_report.id
    and client_reports.account_id = p_account_id
    and client_reports.client_id = p_client_id
  returning * into new_report;

  return pg_catalog.jsonb_build_object(
    'report', pg_catalog.to_jsonb(new_report),
    'version', pg_catalog.to_jsonb(new_version)
  );
end;
$function$;

create or replace function public.append_client_report_version(
  p_report_id uuid,
  p_account_id uuid,
  p_client_id uuid,
  p_source_scan_id uuid,
  p_previous_scan_id uuid,
  p_locale text,
  p_executive_summary text,
  p_snapshot_schema_version integer,
  p_snapshot jsonb,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  locked_report public.client_reports;
  new_version public.client_report_versions;
  published_version public.client_report_versions;
  published_version_id_before_append uuid;
  new_version_number integer;
  client_domain text;
  source_domain text;
  source_created_at timestamptz;
  previous_domain text;
  previous_created_at timestamptz;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_report_id::text, 0)
  );

  select client_reports.*
  into locked_report
  from public.client_reports
  where client_reports.id = p_report_id
    and client_reports.account_id = p_account_id
    and client_reports.client_id = p_client_id
  for update;

  if not found then
    raise exception 'CLIENT_REPORT_NOT_FOUND';
  end if;

  published_version_id_before_append := locked_report.published_version_id;

  select clients.domain
  into client_domain
  from public.clients
  where clients.id = p_client_id
    and clients.account_id = p_account_id;

  if not found
    or client_domain is null
    or pg_catalog.btrim(client_domain) = ''
    or pg_catalog.strpos(client_domain, '://') > 0
    or pg_catalog.strpos(client_domain, '/') > 0
    or pg_catalog.strpos(client_domain, '?') > 0
    or pg_catalog.strpos(client_domain, '#') > 0
  then
    raise exception 'CLIENT_REPORT_NOT_FOUND';
  end if;

  select scans.domain, scans.created_at
  into source_domain, source_created_at
  from public.scans
  where scans.id = p_source_scan_id
    and scans.account_id = p_account_id;

  if not found
    or source_domain is null
    or source_created_at is null
    or pg_catalog.strpos(source_domain, '://') > 0
    or pg_catalog.strpos(source_domain, '/') > 0
    or pg_catalog.strpos(source_domain, '?') > 0
    or pg_catalog.strpos(source_domain, '#') > 0
    or pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(source_domain)), '^www\.', '')
      <> pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(client_domain)), '^www\.', '')
  then
    raise exception 'CLIENT_REPORT_SCAN_NOT_FOUND';
  end if;

  if p_previous_scan_id is not null then
    select scans.domain, scans.created_at
    into previous_domain, previous_created_at
    from public.scans
    where scans.id = p_previous_scan_id
      and scans.account_id = p_account_id;

    if not found
      or previous_domain is null
      or previous_created_at is null
      or previous_created_at >= source_created_at
      or pg_catalog.strpos(previous_domain, '://') > 0
      or pg_catalog.strpos(previous_domain, '/') > 0
      or pg_catalog.strpos(previous_domain, '?') > 0
      or pg_catalog.strpos(previous_domain, '#') > 0
      or pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(previous_domain)), '^www\.', '')
        <> pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(client_domain)), '^www\.', '')
    then
      raise exception 'CLIENT_REPORT_PREVIOUS_SCAN_INVALID';
    end if;
  end if;

  select coalesce(
    pg_catalog.max(client_report_versions.version_number) + 1,
    1
  )
  into new_version_number
  from public.client_report_versions
  where client_report_versions.report_id = p_report_id
    and client_report_versions.account_id = p_account_id
    and client_report_versions.client_id = p_client_id;

  insert into public.client_report_versions (
    report_id,
    account_id,
    client_id,
    version_number,
    source_scan_id,
    previous_scan_id,
    locale,
    executive_summary,
    snapshot_schema_version,
    snapshot,
    created_by
  ) values (
    p_report_id,
    p_account_id,
    p_client_id,
    new_version_number,
    p_source_scan_id,
    p_previous_scan_id,
    p_locale,
    p_executive_summary,
    p_snapshot_schema_version,
    p_snapshot,
    p_created_by
  )
  returning * into new_version;

  update public.client_reports
  set latest_version_id = new_version.id,
      updated_at = pg_catalog.now()
  where client_reports.id = p_report_id
    and client_reports.account_id = p_account_id
    and client_reports.client_id = p_client_id
  returning * into locked_report;

  if locked_report.published_version_id is distinct from published_version_id_before_append then
    raise exception 'CLIENT_REPORT_NOT_FOUND';
  end if;

  if locked_report.published_version_id is not null then
    select client_report_versions.*
    into published_version
    from public.client_report_versions
    where client_report_versions.id = locked_report.published_version_id
      and client_report_versions.report_id = locked_report.id
      and client_report_versions.account_id = locked_report.account_id
      and client_report_versions.client_id = locked_report.client_id;

    if not found then
      raise exception 'CLIENT_REPORT_NOT_FOUND';
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'report', pg_catalog.to_jsonb(locked_report),
    'version', pg_catalog.to_jsonb(new_version),
    'previous_published_version_id', published_version_id_before_append,
    'published_version', pg_catalog.to_jsonb(published_version)
  );
end;
$function$;

create or replace function public.publish_client_report_latest(
  p_report_id uuid,
  p_account_id uuid,
  p_client_id uuid,
  p_reviewed_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  locked_report public.client_reports;
  published_version public.client_report_versions;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_report_id::text, 0)
  );

  select client_reports.*
  into locked_report
  from public.client_reports
  where client_reports.id = p_report_id
    and client_reports.account_id = p_account_id
    and client_reports.client_id = p_client_id
  for update;

  if not found or locked_report.latest_version_id is null then
    raise exception 'CLIENT_REPORT_NOT_FOUND';
  end if;

  if locked_report.latest_version_id is distinct from p_reviewed_version_id then
    raise exception 'reviewed version is stale';
  end if;

  update public.client_reports
  set published_version_id = locked_report.latest_version_id,
      status = 'published',
      public_slug = case when locked_report.status = 'revoked' then pg_catalog.translate(
        pg_catalog.rtrim(pg_catalog.encode(public.gen_random_bytes(24), 'base64'), '='),
        '+/',
        '-_'
      ) else locked_report.public_slug end,
      share_version = case when locked_report.status = 'revoked' then locked_report.share_version + 1 else locked_report.share_version end,
      published_at = pg_catalog.now(),
      revoked_at = null,
      updated_at = pg_catalog.now()
  where client_reports.id = p_report_id
    and client_reports.account_id = p_account_id
    and client_reports.client_id = p_client_id
  returning * into locked_report;

  select client_report_versions.*
  into published_version
  from public.client_report_versions
  where client_report_versions.id = locked_report.published_version_id
    and client_report_versions.report_id = locked_report.id
    and client_report_versions.account_id = locked_report.account_id
    and client_report_versions.client_id = locked_report.client_id;

  if not found then
    raise exception 'CLIENT_REPORT_NOT_FOUND';
  end if;

  return pg_catalog.jsonb_build_object(
    'report', pg_catalog.to_jsonb(locked_report),
    'published_version', pg_catalog.to_jsonb(published_version),
    'latest_version', pg_catalog.to_jsonb(published_version)
  );
end;
$function$;

create or replace function public.revoke_client_report(
  p_report_id uuid,
  p_account_id uuid,
  p_client_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  locked_report public.client_reports;
  latest_version public.client_report_versions;
  published_version public.client_report_versions;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_report_id::text, 0)
  );

  select client_reports.*
  into locked_report
  from public.client_reports
  where client_reports.id = p_report_id
    and client_reports.account_id = p_account_id
    and client_reports.client_id = p_client_id
  for update;

  if not found then
    raise exception 'CLIENT_REPORT_NOT_FOUND';
  end if;

  update public.client_reports
  set status = 'revoked',
      share_version = locked_report.share_version + 1,
      public_slug = pg_catalog.translate(
        pg_catalog.rtrim(pg_catalog.encode(public.gen_random_bytes(24), 'base64'), '='),
        '+/',
        '-_'
      ),
      revoked_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where client_reports.id = p_report_id
    and client_reports.account_id = p_account_id
    and client_reports.client_id = p_client_id
  returning * into locked_report;

  select client_report_versions.*
  into latest_version
  from public.client_report_versions
  where client_report_versions.id = locked_report.latest_version_id
    and client_report_versions.report_id = locked_report.id
    and client_report_versions.account_id = locked_report.account_id
    and client_report_versions.client_id = locked_report.client_id;

  if not found then
    raise exception 'CLIENT_REPORT_NOT_FOUND';
  end if;

  if locked_report.published_version_id is not null then
    select client_report_versions.*
    into published_version
    from public.client_report_versions
    where client_report_versions.id = locked_report.published_version_id
      and client_report_versions.report_id = locked_report.id
      and client_report_versions.account_id = locked_report.account_id
      and client_report_versions.client_id = locked_report.client_id;

    if not found then
      raise exception 'CLIENT_REPORT_NOT_FOUND';
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'report', pg_catalog.to_jsonb(locked_report),
    'latest_version', pg_catalog.to_jsonb(latest_version),
    'published_version', pg_catalog.to_jsonb(published_version)
  );
end;
$function$;

create or replace function public.rotate_client_report_link(
  p_report_id uuid,
  p_account_id uuid,
  p_client_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  locked_report public.client_reports;
  latest_version public.client_report_versions;
  published_version public.client_report_versions;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_report_id::text, 0)
  );

  select client_reports.*
  into locked_report
  from public.client_reports
  where client_reports.id = p_report_id
    and client_reports.account_id = p_account_id
    and client_reports.client_id = p_client_id
  for update;

  if not found
    or locked_report.status <> 'published'
    or locked_report.published_version_id is null
  then
    raise exception 'CLIENT_REPORT_NOT_FOUND';
  end if;

  update public.client_reports
  set share_version = locked_report.share_version + 1,
      public_slug = pg_catalog.translate(
        pg_catalog.rtrim(pg_catalog.encode(public.gen_random_bytes(24), 'base64'), '='),
        '+/',
        '-_'
      ),
      updated_at = pg_catalog.now()
  where client_reports.id = p_report_id
    and client_reports.account_id = p_account_id
    and client_reports.client_id = p_client_id
  returning * into locked_report;

  select client_report_versions.*
  into latest_version
  from public.client_report_versions
  where client_report_versions.id = locked_report.latest_version_id
    and client_report_versions.report_id = locked_report.id
    and client_report_versions.account_id = locked_report.account_id
    and client_report_versions.client_id = locked_report.client_id;

  if not found then
    raise exception 'CLIENT_REPORT_NOT_FOUND';
  end if;

  select client_report_versions.*
  into published_version
  from public.client_report_versions
  where client_report_versions.id = locked_report.published_version_id
    and client_report_versions.report_id = locked_report.id
    and client_report_versions.account_id = locked_report.account_id
    and client_report_versions.client_id = locked_report.client_id;

  if not found then
    raise exception 'CLIENT_REPORT_NOT_FOUND';
  end if;

  return pg_catalog.jsonb_build_object(
    'report', pg_catalog.to_jsonb(locked_report),
    'published_version', pg_catalog.to_jsonb(published_version),
    'latest_version', pg_catalog.to_jsonb(latest_version)
  );
end;
$function$;

create or replace function public.increment_client_report_view(
  p_public_slug text,
  p_share_version integer
)
returns table (
  view_count bigint,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  return query
  update public.client_reports
  set view_count = client_reports.view_count + 1,
      first_viewed_at = coalesce(client_reports.first_viewed_at, pg_catalog.now()),
      last_viewed_at = pg_catalog.now()
  where client_reports.public_slug = p_public_slug
    and client_reports.share_version = p_share_version
    and client_reports.status = 'published'
    and client_reports.published_version_id is not null
  returning client_reports.view_count,
            client_reports.first_viewed_at,
            client_reports.last_viewed_at;
end;
$function$;

create or replace function public.increment_client_report_cta_click(
  p_public_slug text,
  p_share_version integer
)
returns table (cta_click_count bigint)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  return query
  update public.client_reports
  set cta_click_count = client_reports.cta_click_count + 1
  where client_reports.public_slug = p_public_slug
    and client_reports.share_version = p_share_version
    and client_reports.status = 'published'
    and client_reports.published_version_id is not null
  returning client_reports.cta_click_count;
end;
$function$;

revoke execute on function public.create_client_report_with_version(uuid, uuid, uuid, uuid, text, text, integer, jsonb, uuid) from public;
revoke execute on function public.append_client_report_version(uuid, uuid, uuid, uuid, uuid, text, text, integer, jsonb, uuid) from public;
revoke execute on function public.publish_client_report_latest(uuid, uuid, uuid, uuid) from public;
revoke execute on function public.revoke_client_report(uuid, uuid, uuid) from public;
revoke execute on function public.rotate_client_report_link(uuid, uuid, uuid) from public;
revoke execute on function public.increment_client_report_view(text, integer) from public;
revoke execute on function public.increment_client_report_cta_click(text, integer) from public;

-- Supabase's anon/authenticated/service_role roles do not exist under Neon.
-- Guard the role-specific execute grants, matching the do $acl$ pattern used
-- elsewhere in this migration and in 023-026 and 028.
do $acl$
declare
  fn text;
begin
  foreach fn in array array[
    'public.create_client_report_with_version(uuid, uuid, uuid, uuid, text, text, integer, jsonb, uuid)',
    'public.append_client_report_version(uuid, uuid, uuid, uuid, uuid, text, text, integer, jsonb, uuid)',
    'public.publish_client_report_latest(uuid, uuid, uuid, uuid)',
    'public.revoke_client_report(uuid, uuid, uuid)',
    'public.rotate_client_report_link(uuid, uuid, uuid)',
    'public.increment_client_report_view(text, integer)',
    'public.increment_client_report_cta_click(text, integer)'
  ]
  loop
    if to_regrole('anon') is not null then
      execute pg_catalog.format('revoke execute on function %s from anon', fn);
    end if;
    if to_regrole('authenticated') is not null then
      execute pg_catalog.format('revoke execute on function %s from authenticated', fn);
    end if;
    if to_regrole('service_role') is not null then
      execute pg_catalog.format('grant execute on function %s to service_role', fn);
    end if;
  end loop;
end
$acl$;
