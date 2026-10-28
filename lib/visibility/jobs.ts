import 'server-only'
import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import { canonicalOutcomeUrl,OutcomeError } from '@/lib/outcome-integrations/input'
import { outcomeHash,type OutcomeScope } from '@/lib/outcome-integrations/store'
import type { VisibilityPage } from './page'
const absent=():never=>{throw new OutcomeError('VISIBILITY_NOT_FOUND',404)}
const stamp=(value:unknown)=>value instanceof Date?value.toISOString():String(value)
export async function setVisibilityAutomation(scope:OutcomeScope,actor:string,enabled:boolean) {
  const sql=db()
  const [row]=await sql`insert into visibility_settings(account_id,client_id,auto_retest,enabled_by)
    select c.account_id,c.id,${enabled},p.id from clients c join profiles p on p.account_id=c.account_id
    where c.account_id=${scope.accountId}::uuid and c.id=${scope.clientId}::uuid and p.id=${actor}::uuid and p.deactivated_at is null
    on conflict(account_id,client_id) do update set auto_retest=excluded.auto_retest,enabled_by=excluded.enabled_by,
      updated_at=case when visibility_settings.auto_retest=excluded.auto_retest and visibility_settings.enabled_by=excluded.enabled_by then visibility_settings.updated_at else clock_timestamp() end
    returning auto_retest`
  if(!row)absent()
  return{autoRetest:row.auto_retest===true}
}
export async function saveVisibilityPageSnapshot(scope:OutcomeScope,evidence:VisibilityPage,provenance:'manual'|'closed_loop'|'routine',actor:string|null=null) {
  const sql=db()
  const [client]=await sql`select domain from clients where account_id=${scope.accountId}::uuid and id=${scope.clientId}::uuid`
  if(!client)absent()
  canonicalOutcomeUrl(evidence.url,String(client.domain))
  const [saved]=await sql`insert into visibility_page_snapshots(account_id,client_id,url,observed_at,evidence,provenance,created_by)
    select c.account_id,c.id,${evidence.url},${evidence.observedAt}::timestamptz,${JSON.stringify(evidence)}::jsonb,${provenance},${actor}::uuid
    from clients c where c.account_id=${scope.accountId}::uuid and c.id=${scope.clientId}::uuid
    and (${actor}::uuid is null or exists(select 1 from profiles p where p.account_id=c.account_id and p.id=${actor}::uuid and p.deactivated_at is null)) returning id`
  if(!saved)absent()
  return{id:String(saved.id)}
}
export async function enqueueVisibilitySource(scope:OutcomeScope,kind:'deployment'|'work_completion',id:string,requestedBy:string|null=null) {
  const sql=db()
  const rows=kind==='deployment'
    ? await sql`select d.id,d.deployed_at::text as source_at,d.urls,c.domain from outcome_deployments d join clients c on c.account_id=d.account_id and c.id=d.client_id
      where d.account_id=${scope.accountId}::uuid and d.client_id=${scope.clientId}::uuid and d.id=${id}::uuid`
    : await sql`select e.id,e.completed_at::text as source_at,jsonb_build_array(e.target_url) as urls,c.domain from visibility_completion_events e join clients c on c.account_id=e.account_id and c.id=e.client_id
      where e.account_id=${scope.accountId}::uuid and e.client_id=${scope.clientId}::uuid and e.id=${id}::uuid`
  const source=rows[0]
  if(!source)absent()
  const sourceAt=stamp(source.source_at)
  if(Date.parse(sourceAt)>Date.now())throw new OutcomeError('VISIBILITY_SOURCE_NOT_READY',409)
  let urls:string[]=[],status='queued',reason:string|null=null
  try {
    if(!Array.isArray(source.urls)||!source.urls.length||source.urls.length>20)throw new Error()
    urls=[...new Set(source.urls.map(url=>canonicalOutcomeUrl(url,String(source.domain))))]
    if(urls.some(url=>new URL(url).protocol!=='https:'))throw new Error()
  }catch{urls=[];status='blocked';reason='TARGET_URL_UNSUPPORTED'}
  const [runs,pages]=await Promise.all([
    sql`select r.id,r.manifest from pulse_runs r where r.account_id=${scope.accountId}::uuid and r.client_id=${scope.clientId}::uuid
      and r.status='completed' and created_at<${sourceAt}::timestamptz and manifest->>'version'='2026-10-26.v1' and manifest->'brand'->>'domain'=${String(source.domain)}
      and jsonb_array_length(manifest->'items')>0
      and not exists(select 1 from jsonb_array_elements(manifest->'items') item where (
        item->>'contextVersion'='2026-10-26.v1' and item->'monitoring'->>'locale'=item->>'language'
        and item->'monitoring'->>'market'=item->>'market' and item->'monitoring'->'sampling'->'temperature'='0.2'::jsonb
        and item->'monitoring'->'sampling'->'samplesPerRun'='1'::jsonb and item->'monitoring'->'sampling'->'seed'='null'::jsonb) is not true)
      and (select count(*) from pulse_run_items i where i.run_id=r.id and i.account_id=r.account_id and i.client_id=r.client_id)=jsonb_array_length(manifest->'items')
      and not exists(select 1 from pulse_run_items i left join pulse_item_attempts a on a.id=i.accepted_attempt_id and a.item_id=i.id and a.account_id=i.account_id and a.client_id=i.client_id
        where i.run_id=r.id and i.account_id=r.account_id and i.client_id=r.client_id and (a.finished_at is null or a.finished_at>=${sourceAt}::timestamptz or i.status<>'succeeded' or i.classification_status<>'classified' or a.actual_model is null or a.provider_citations is null or not a.accepted or (a.grounding='none' and a.search_evidence->>'requested'='none' and a.search_evidence->>'execution'='unknown' or a.grounding in('web','native') and a.search_evidence->>'requested'=a.grounding and a.search_evidence->>'execution'='confirmed' and a.search_evidence->>'basis'='provider-search-event') is not true))
      order by r.created_at desc,r.id desc limit 1`,
    sql`select distinct on(url) evidence from visibility_page_snapshots where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid
      and url=any(${urls}::text[]) and observed_at<${sourceAt}::timestamptz order by url,observed_at desc,id desc limit 20`,
  ])
  const baseline={sourceAt,sourceRunId:runs[0]?.id??null,manifestHash:runs[0]?outcomeHash(runs[0].manifest):null,pages:pages.map(page=>page.evidence)}
  const [saved]=await sql`insert into visibility_revalidations(account_id,client_id,source_kind,source_id,source_at,source_run_id,urls,baseline,status,reason,requested_by)
    select c.account_id,c.id,${kind},${id}::uuid,${sourceAt}::timestamptz,${runs[0]?.id??null}::uuid,${JSON.stringify(urls)}::jsonb,${JSON.stringify(baseline)}::jsonb,${status},${reason},${requestedBy}::uuid
    from clients c where c.account_id=${scope.accountId}::uuid and c.id=${scope.clientId}::uuid and (${requestedBy}::uuid is null or exists(select 1 from profiles p
      where p.account_id=c.account_id and p.id=${requestedBy}::uuid and p.deactivated_at is null))
    on conflict(account_id,client_id,source_kind,source_id) do nothing returning id,status`
  if(saved)return{id:String(saved.id),status:String(saved.status)}
  const [old]=await sql`select id,status from visibility_revalidations where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid and source_kind=${kind} and source_id=${id}::uuid`
  if(!old)absent()
  return{id:String(old.id),status:String(old.status)}
}
export type VisibilityJobLease=OutcomeScope & {id:string;token:string;attempt:number;domain:string;urls:string[];baseline:Record<string,unknown>;sourceRunId:string|null;retestRunId:string|null;requestedBy:string|null;sourceAt:string}
export async function claimVisibilityJob(scope:OutcomeScope,id:string):Promise<VisibilityJobLease|null> {
  const sql=db(),token=randomUUID()
  const [,rows]=await sql.transaction([
    sql`select id from clients where account_id=${scope.accountId}::uuid and id=${scope.clientId}::uuid for update`,
    sql`with claimed as(update visibility_revalidations set status='running',lease_token=${token}::uuid,lease_until=clock_timestamp()+interval '55 seconds',attempt_count=attempt_count+1
      where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid and id=${id}::uuid and status in ('queued','failed','unknown') and next_at<=clock_timestamp() and attempt_count<3 returning id,account_id,client_id,attempt_count,urls,baseline,source_run_id,retest_run_id,requested_by,source_at::text as source_at),
    started as(insert into visibility_revalidation_attempts(account_id,client_id,job_id,attempt_number,lease_token)
      select account_id,client_id,id,attempt_count,${token}::uuid from claimed returning job_id)
    select j.*,c.domain from claimed j join started a on a.job_id=j.id join clients c on c.id=j.client_id and c.account_id=j.account_id`,
  ])
  const row=rows[0]
  return row?{...scope,id:String(row.id),token,attempt:Number(row.attempt_count),domain:String(row.domain),urls:row.urls as string[],baseline:row.baseline as Record<string,unknown>,sourceRunId:row.source_run_id?String(row.source_run_id):null,retestRunId:row.retest_run_id?String(row.retest_run_id):null,requestedBy:row.requested_by?String(row.requested_by):null,sourceAt:stamp(row.source_at)}:null
}
export async function finishVisibilityJob(lease:VisibilityJobLease,status:'completed'|'waiting'|'blocked'|'failed'|'unknown',reason:string,result:Record<string,unknown>,retestId:string|null=null) {
  const sql=db()
  const rows=await sql`with finished as(update visibility_revalidations set status=${status},reason=${reason},result=${JSON.stringify(result)}::jsonb,
      retest_run_id=coalesce(${retestId}::uuid,retest_run_id),lease_token=null,lease_until=null,next_at=clock_timestamp()+interval '1 hour',
      finished_at=case when ${status}='waiting' then null else clock_timestamp() end
    where account_id=${lease.accountId}::uuid and client_id=${lease.clientId}::uuid and id=${lease.id}::uuid and lease_token=${lease.token}::uuid
      and status='running' and lease_until>clock_timestamp() returning id)
    update visibility_revalidation_attempts set status=${status==='waiting'?'completed':status},reason=${reason},finished_at=clock_timestamp()
    where account_id=${lease.accountId}::uuid and client_id=${lease.clientId}::uuid and job_id in(select id from finished) and lease_token=${lease.token}::uuid and status='started' returning id`
  return rows.length===1
}
/** Cron-only lease repair. External collection still belongs to Pulse; the
 * reservation intent is stable if a job was interrupted after reserving it. */
export async function repairVisibilityLeases() {
  const sql=db()
  const rows=await sql`with expired as(select id,account_id,client_id,lease_token from visibility_revalidations where status='running' and lease_until<clock_timestamp() order by lease_until limit 50),
    repaired as(update visibility_revalidations j set status=case when attempt_count<3 then 'queued' else 'unknown' end,reason='ATTEMPT_INTERRUPTED',lease_token=null,lease_until=null,next_at=clock_timestamp()
      from expired e where j.id=e.id and j.account_id=e.account_id and j.client_id=e.client_id and j.lease_token=e.lease_token and j.status='running' returning j.id,j.account_id,j.client_id,e.lease_token)
    update visibility_revalidation_attempts a set status='unknown',reason='ATTEMPT_INTERRUPTED',finished_at=clock_timestamp() from repaired r
      where a.job_id=r.id and a.account_id=r.account_id and a.client_id=r.client_id and a.lease_token=r.lease_token and a.status='started' returning a.id`
  return rows.length
}
export async function finishWaitingVisibilityJob(scope:OutcomeScope,id:string,retestId:string,status:'completed'|'blocked',reason:string,result:Record<string,unknown>) {
  const sql=db()
  const rows=await sql`update visibility_revalidations set status=${status},reason=${reason},result=${JSON.stringify(result)}::jsonb,finished_at=clock_timestamp()
    where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid and id=${id}::uuid and retest_run_id=${retestId}::uuid and status='waiting' returning id`
  return rows.length===1
}
export async function retryVisibilityJob(scope:OutcomeScope,id:string,actor:string) {
  const sql=db()
  const [row]=await sql`update visibility_revalidations j set status='queued',reason=null,next_at=clock_timestamp(),requested_by=${actor}::uuid
    where j.account_id=${scope.accountId}::uuid and j.client_id=${scope.clientId}::uuid and j.id=${id}::uuid and j.status in ('failed','blocked','unknown') and attempt_count<3
    and jsonb_array_length(urls)>0 and exists(select 1 from profiles p where p.id=${actor}::uuid and p.account_id=j.account_id and p.deactivated_at is null) returning id`
  if(!row)throw new OutcomeError('VISIBILITY_RETRY_UNAVAILABLE',409)
  return{id:String(row.id)}
}
