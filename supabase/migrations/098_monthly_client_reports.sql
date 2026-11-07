-- 098: Retainer OS Slice C1 — the monthly deliverables report, as a second KIND
-- of client report (brief: docs/superpowers/plans/2026-11-06-aiso-brief-retainer-os.md,
-- §2 Slice C). It reuses client_reports / client_report_versions (versions,
-- branding, share links) instead of a second report system.
--
-- Isolation, not a union: every existing scan-report read filters `kind = 'scan'`
-- (lib/reports/store.ts), so a monthly report never reaches the scan flow's
-- list, detail, append, AI-summary or publish paths, and the public resolver
-- still serves only schema 1. Publishing a monthly report is Slice C2.
--
-- A monthly version (snapshot_schema_version 2) has no source scan: it is built
-- from the Brand Month (097) and the delivery rows. Its executive_summary is the
-- operator's narrative. Created and appended only through the two monthly RPCs
-- below, which lock the report and check kind, tenancy and month. No RLS
-- policies (036); EXECUTE granted to aeo_app as in 038.

alter table public.client_reports
  add column if not exists kind text not null default 'scan',
  add column if not exists report_month date;

alter table public.client_reports
  add constraint client_reports_kind_check check ((
    kind in ('scan', 'monthly')
    and (kind = 'monthly') = (report_month is not null)
    and (report_month is null or report_month = date_trunc('month', report_month)::date)
  ) is true);

-- One monthly report per brand per Hong Kong month; later drafts are versions of it.
create unique index if not exists client_reports_monthly_unique_idx
  on public.client_reports (account_id, client_id, report_month) where kind = 'monthly';

alter table public.client_report_versions
  drop constraint if exists client_report_versions_snapshot_schema_version_check;
alter table public.client_report_versions
  add constraint client_report_versions_snapshot_schema_version_check
  check (snapshot_schema_version in (1, 2));

-- A monthly version: schema 2, no scans, a JSON object of bounded size (MONTHLY_SNAPSHOT_MAX_BYTES).
alter table public.client_report_versions
  add constraint client_report_versions_monthly_shape_check check ((
    snapshot_schema_version <> 2 or (
      source_scan_id is null and previous_scan_id is null
      and jsonb_typeof(snapshot) = 'object'
      -- 256 KiB: the builder's own caps (50 + 50 deliveries, 20 open items, 160-character titles,
      -- a 1,200-character narrative) stay far inside it even in Traditional Chinese.
      and octet_length(snapshot::text) <= 262144
    )
  ) is true);

create or replace function public.create_monthly_client_report_with_version(
  p_account_id uuid,
  p_client_id uuid,
  p_report_month date,
  p_locale text,
  p_executive_summary text,
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
begin
  if not exists (
    select 1 from public.clients
    where clients.id = p_client_id and clients.account_id = p_account_id
  ) then
    raise exception 'CLIENT_REPORT_NOT_FOUND';
  end if;

  if p_report_month is null or p_report_month <> pg_catalog.date_trunc('month', p_report_month)::date then
    raise exception 'CLIENT_REPORT_MONTH_INVALID';
  end if;

  if exists (
    select 1 from public.client_reports
    where client_reports.account_id = p_account_id and client_reports.client_id = p_client_id
      and client_reports.kind = 'monthly' and client_reports.report_month = p_report_month
  ) then
    raise exception 'CLIENT_REPORT_MONTH_EXISTS';
  end if;

  insert into public.client_reports (account_id, client_id, created_by, kind, report_month)
  values (p_account_id, p_client_id, p_created_by, 'monthly', p_report_month)
  returning * into new_report;

  insert into public.client_report_versions (
    report_id, account_id, client_id, version_number, source_scan_id, previous_scan_id,
    locale, executive_summary, snapshot_schema_version, snapshot, created_by
  ) values (
    new_report.id, p_account_id, p_client_id, 1, null, null,
    p_locale, p_executive_summary, 2, p_snapshot, p_created_by
  )
  returning * into new_version;

  update public.client_reports
  set latest_version_id = new_version.id, updated_at = pg_catalog.now()
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

create or replace function public.append_monthly_client_report_version(
  p_report_id uuid,
  p_account_id uuid,
  p_client_id uuid,
  p_locale text,
  p_executive_summary text,
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
  new_version_number integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_report_id::text, 0));

  select client_reports.* into locked_report
  from public.client_reports
  where client_reports.id = p_report_id
    and client_reports.account_id = p_account_id
    and client_reports.client_id = p_client_id
    and client_reports.kind = 'monthly'
  for update;

  if not found then
    raise exception 'CLIENT_REPORT_NOT_FOUND';
  end if;

  select coalesce(max(v.version_number), 0) + 1 into new_version_number
  from public.client_report_versions v
  where v.report_id = p_report_id and v.account_id = p_account_id;

  insert into public.client_report_versions (
    report_id, account_id, client_id, version_number, source_scan_id, previous_scan_id,
    locale, executive_summary, snapshot_schema_version, snapshot, created_by
  ) values (
    p_report_id, p_account_id, p_client_id, new_version_number, null, null,
    p_locale, p_executive_summary, 2, p_snapshot, p_created_by
  )
  returning * into new_version;

  update public.client_reports
  set latest_version_id = new_version.id, updated_at = pg_catalog.now()
  where client_reports.id = p_report_id
    and client_reports.account_id = p_account_id
    and client_reports.client_id = p_client_id
  returning * into locked_report;

  return pg_catalog.jsonb_build_object(
    'report', pg_catalog.to_jsonb(locked_report),
    'version', pg_catalog.to_jsonb(new_version)
  );
end;
$function$;

revoke execute on function public.create_monthly_client_report_with_version(uuid, uuid, date, text, text, jsonb, uuid) from public;
revoke execute on function public.append_monthly_client_report_version(uuid, uuid, uuid, text, text, jsonb, uuid) from public;

do $acl$
begin
  if to_regrole('aeo_app') is not null then
    grant execute on function public.create_monthly_client_report_with_version(uuid, uuid, date, text, text, jsonb, uuid) to aeo_app;
    grant execute on function public.append_monthly_client_report_version(uuid, uuid, uuid, text, text, jsonb, uuid) to aeo_app;
  end if;
end
$acl$;
