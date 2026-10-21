-- Optimistic append for report edits already loaded by an authenticated tab.
-- The legacy 071 RPC remains available for older clients and receipt replay.
create function public.save_client_report_draft_request_with_version(
  p_request_id uuid,
  p_report_id uuid,
  p_account_id uuid,
  p_client_id uuid,
  p_source_scan_id uuid,
  p_previous_scan_id uuid,
  p_locale text,
  p_executive_summary text,
  p_snapshot_schema_version integer,
  p_snapshot jsonb,
  p_created_by uuid,
  p_expected_latest_version_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  payload jsonb;
  saved public.report_save_receipts;
  mutation jsonb;
  current_latest_version_id uuid;
begin
  if p_request_id is null or p_created_by is null or p_source_scan_id is null
    or p_locale is null or p_locale not in ('en','zh-HK')
    or p_executive_summary is null
    or char_length(btrim(p_executive_summary)) not between 40 and 1200
    or (p_report_id is not null and p_expected_latest_version_id is null)
    or (p_report_id is null and p_expected_latest_version_id is not null) then
    raise exception 'CLIENT_REPORT_SAVE_INVALID';
  end if;

  payload := pg_catalog.jsonb_build_object(
    'reportId',p_report_id,
    'scanId',p_source_scan_id,
    'locale',p_locale,
    'executiveSummary',p_executive_summary,
    'expectedLatestVersionId',p_expected_latest_version_id
  );

  -- A same-request retry serializes before the CAS check so it can replay
  -- its immutable receipt even after another tab has saved a later version.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_account_id::text || ':' || p_created_by::text || ':' || p_request_id::text, 0));

  select * into saved from public.report_save_receipts
    where account_id=p_account_id and actor_id=p_created_by and request_id=p_request_id;
  if found then
    if saved.client_id is distinct from p_client_id or saved.request_payload is distinct from payload then
      raise exception 'CLIENT_REPORT_SAVE_CONFLICT';
    end if;
    return saved.result;
  end if;

  if p_report_id is null then
    mutation := public.create_client_report_with_version(
      p_account_id,p_client_id,p_source_scan_id,p_previous_scan_id,p_locale,
      p_executive_summary,p_snapshot_schema_version,p_snapshot,p_created_by);
  else
    -- Match append_client_report_version's advisory-then-row lock order.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(p_report_id::text, 0));
    select client_reports.latest_version_id
      into current_latest_version_id
      from public.client_reports
      where client_reports.id=p_report_id
        and client_reports.account_id=p_account_id
        and client_reports.client_id=p_client_id
      for update;
    if not found then
      raise exception 'CLIENT_REPORT_NOT_FOUND';
    end if;
    if current_latest_version_id is distinct from p_expected_latest_version_id then
      raise exception 'CLIENT_REPORT_SAVE_CONFLICT';
    end if;
    mutation := public.append_client_report_version(
      p_report_id,p_account_id,p_client_id,p_source_scan_id,p_previous_scan_id,p_locale,
      p_executive_summary,p_snapshot_schema_version,p_snapshot,p_created_by);
  end if;

  insert into public.report_save_receipts(
    account_id,client_id,actor_id,request_id,report_id,version_id,request_payload,result)
  values(p_account_id,p_client_id,p_created_by,p_request_id,
    (mutation->'report'->>'id')::uuid,(mutation->'version'->>'id')::uuid,payload,mutation);
  return mutation;
end
$function$;

revoke all on function public.save_client_report_draft_request_with_version(
  uuid,uuid,uuid,uuid,uuid,uuid,text,text,integer,jsonb,uuid,uuid) from public;
grant execute on function public.save_client_report_draft_request_with_version(
  uuid,uuid,uuid,uuid,uuid,uuid,text,text,integer,jsonb,uuid,uuid) to aeo_app;
