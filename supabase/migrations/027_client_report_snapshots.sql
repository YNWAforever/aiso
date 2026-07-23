-- Immutable, tenant-owned client report snapshots and service-only mutation RPCs.

alter table public.clients
  add constraint clients_id_account_id_unique unique (id, account_id);

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
    pg_catalog.rtrim(pg_catalog.encode(extensions.gen_random_bytes(24), 'base64'), '='),
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

create policy account_report_branding_select_own
  on public.account_report_branding
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.account_id = account_report_branding.account_id
    )
  );

create policy account_report_branding_insert_own
  on public.account_report_branding
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.account_id = account_report_branding.account_id
    )
  );

create policy account_report_branding_update_own
  on public.account_report_branding
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.account_id = account_report_branding.account_id
    )
  )
  with check (
    exists (
      select 1
      from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.account_id = account_report_branding.account_id
    )
  );

create policy account_report_branding_delete_own
  on public.account_report_branding
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.account_id = account_report_branding.account_id
    )
  );

create policy client_reports_select_own
  on public.client_reports
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.account_id = client_reports.account_id
    )
  );

create policy client_report_versions_select_own
  on public.client_report_versions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.account_id = client_report_versions.account_id
    )
  );

revoke all on table public.account_report_branding from public, anon, authenticated;
grant select, insert, update, delete on table public.account_report_branding to authenticated;
grant select, insert, update, delete on table public.account_report_branding to service_role;

revoke all on table public.client_reports from public;
revoke all on table public.client_reports from anon, authenticated;
revoke all on table public.client_reports from service_role;
grant select on table public.client_reports to authenticated;
grant select on table public.client_reports to service_role;

revoke all on table public.client_report_versions from public;
revoke all on table public.client_report_versions from anon, authenticated;
revoke all on table public.client_report_versions from service_role;
grant select on table public.client_report_versions to authenticated;
grant select on table public.client_report_versions to service_role;
revoke update, delete on table public.client_report_versions from service_role;

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

  select pg_catalog.coalesce(
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
  p_client_id uuid
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

  update public.client_reports
  set published_version_id = locked_report.latest_version_id,
      status = 'published',
      public_slug = case when locked_report.status = 'revoked' then pg_catalog.translate(
        pg_catalog.rtrim(pg_catalog.encode(extensions.gen_random_bytes(24), 'base64'), '='),
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
        pg_catalog.rtrim(pg_catalog.encode(extensions.gen_random_bytes(24), 'base64'), '='),
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
        pg_catalog.rtrim(pg_catalog.encode(extensions.gen_random_bytes(24), 'base64'), '='),
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
      first_viewed_at = pg_catalog.coalesce(client_reports.first_viewed_at, pg_catalog.now()),
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
revoke execute on function public.create_client_report_with_version(uuid, uuid, uuid, uuid, text, text, integer, jsonb, uuid) from anon;
revoke execute on function public.create_client_report_with_version(uuid, uuid, uuid, uuid, text, text, integer, jsonb, uuid) from authenticated;
grant execute on function public.create_client_report_with_version(uuid, uuid, uuid, uuid, text, text, integer, jsonb, uuid) to service_role;

revoke execute on function public.append_client_report_version(uuid, uuid, uuid, uuid, uuid, text, text, integer, jsonb, uuid) from public;
revoke execute on function public.append_client_report_version(uuid, uuid, uuid, uuid, uuid, text, text, integer, jsonb, uuid) from anon;
revoke execute on function public.append_client_report_version(uuid, uuid, uuid, uuid, uuid, text, text, integer, jsonb, uuid) from authenticated;
grant execute on function public.append_client_report_version(uuid, uuid, uuid, uuid, uuid, text, text, integer, jsonb, uuid) to service_role;

revoke execute on function public.publish_client_report_latest(uuid, uuid, uuid) from public;
revoke execute on function public.publish_client_report_latest(uuid, uuid, uuid) from anon;
revoke execute on function public.publish_client_report_latest(uuid, uuid, uuid) from authenticated;
grant execute on function public.publish_client_report_latest(uuid, uuid, uuid) to service_role;

revoke execute on function public.revoke_client_report(uuid, uuid, uuid) from public;
revoke execute on function public.revoke_client_report(uuid, uuid, uuid) from anon;
revoke execute on function public.revoke_client_report(uuid, uuid, uuid) from authenticated;
grant execute on function public.revoke_client_report(uuid, uuid, uuid) to service_role;

revoke execute on function public.rotate_client_report_link(uuid, uuid, uuid) from public;
revoke execute on function public.rotate_client_report_link(uuid, uuid, uuid) from anon;
revoke execute on function public.rotate_client_report_link(uuid, uuid, uuid) from authenticated;
grant execute on function public.rotate_client_report_link(uuid, uuid, uuid) to service_role;

revoke execute on function public.increment_client_report_view(text, integer) from public;
revoke execute on function public.increment_client_report_view(text, integer) from anon;
revoke execute on function public.increment_client_report_view(text, integer) from authenticated;
grant execute on function public.increment_client_report_view(text, integer) to service_role;

revoke execute on function public.increment_client_report_cta_click(text, integer) from public;
revoke execute on function public.increment_client_report_cta_click(text, integer) from anon;
revoke execute on function public.increment_client_report_cta_click(text, integer) from authenticated;
grant execute on function public.increment_client_report_cta_click(text, integer) to service_role;
