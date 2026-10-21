-- An immutable acknowledgement, committed atomically with a report save.
-- The application must still derive account/actor from authenticatedProfile().
create table public.report_save_receipts (
  account_id uuid not null,
  client_id uuid not null,
  actor_id uuid not null,
  request_id uuid not null,
  report_id uuid not null,
  version_id uuid not null,
  request_payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (account_id, actor_id, request_id),
  foreign key (client_id, account_id) references public.clients(id, account_id) on delete cascade,
  foreign key (actor_id, account_id) references public.profiles(id, account_id) on delete cascade,
  foreign key (report_id, account_id, client_id)
    references public.client_reports(id, account_id, client_id) on delete cascade,
  foreign key (version_id, report_id)
    references public.client_report_versions(id, report_id) on delete cascade
);
create index report_save_receipts_client_idx on public.report_save_receipts(client_id, account_id);
create index report_save_receipts_actor_idx on public.report_save_receipts(actor_id, account_id);
create index report_save_receipts_report_idx on public.report_save_receipts(report_id, account_id, client_id);
create index report_save_receipts_version_idx on public.report_save_receipts(version_id, report_id);
alter table public.report_save_receipts enable row level security;
revoke all on table public.report_save_receipts from public;
-- 037 grants table DML by default. Remove it: only the transaction below writes.
revoke all on table public.report_save_receipts from aeo_app;
grant select on table public.report_save_receipts to aeo_app;

create function public.save_client_report_draft_request(
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
  p_created_by uuid
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  payload jsonb;
  saved public.report_save_receipts;
  mutation jsonb;
begin
  if p_request_id is null or p_created_by is null or p_source_scan_id is null
    or p_locale is null or p_locale not in ('en','zh-HK')
    or p_executive_summary is null
    or char_length(btrim(p_executive_summary)) not between 40 and 1200 then
    raise exception 'CLIENT_REPORT_SAVE_INVALID';
  end if;
  payload := pg_catalog.jsonb_build_object(
    'reportId',p_report_id,'scanId',p_source_scan_id,
    'locale',p_locale,'executiveSummary',p_executive_summary);
  -- Transaction lock also serializes a retry while the first save is still
  -- uncommitted. A read finding no receipt is not evidence of a failed write.
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
revoke all on function public.save_client_report_draft_request(
  uuid,uuid,uuid,uuid,uuid,uuid,text,text,integer,jsonb,uuid) from public;
grant execute on function public.save_client_report_draft_request(
  uuid,uuid,uuid,uuid,uuid,uuid,text,text,integer,jsonb,uuid) to aeo_app;
