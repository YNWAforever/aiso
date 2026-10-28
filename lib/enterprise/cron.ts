import 'server-only'
import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import { isFeatureEnabled } from '@/lib/flags'
import { OutcomeError } from '@/lib/outcome-integrations/input'
import type { OutcomeScope } from '@/lib/outcome-integrations/store'
import { enterpriseWrite,readEnterpriseBranding } from './store'
import { buildExecutiveSnapshot } from './reports'
import { parsePortalConfig,parseExecutiveSchedule } from './input'
import { claimEnterpriseDelivery,deliverEnterpriseJob } from './delivery'
/** Existing daily UTC dispatch only. Advance the persisted watermark with the
 * period insert; downtime never silently discards a closed reporting period. */
export async function discoverEnterprisePeriods(deadline=Date.now()+45000){
 const sql=db(),due=await sql`select s.id,s.account_id,s.client_id from enterprise_schedules s join enterprise_artifacts a on a.id=s.artifact_id and a.account_id=s.account_id and a.client_id=s.client_id
 where exists(select 1 from clients c where c.id=s.client_id and c.account_id=s.account_id and c.status='active') and s.enabled and s.approved_at is not null and s.next_period_start is not null and enterprise_account_entitled(s.account_id) and enterprise_active_member_role(s.account_id,s.created_by)='manager'
 and s.next_period_start<date_trunc(case when a.payload->>'cadence'='weekly' then 'week' else 'month' end,clock_timestamp() at time zone 'UTC')::date
 order by s.next_period_start,s.id limit 20`
 const process=async(row:Record<string,unknown>)=>{const scope={accountId:String(row.account_id),clientId:String(row.client_id)},rows=await enterpriseWrite(scope,sql`with eligible as(select s.*,case when a.payload->>'cadence'='weekly' then s.next_period_start+7 else(s.next_period_start+interval '1 month')::date end as next_start
 from enterprise_schedules s join enterprise_artifacts a on a.id=s.artifact_id and a.account_id=s.account_id and a.client_id=s.client_id where s.account_id=${scope.accountId}::uuid and s.client_id=${scope.clientId}::uuid and s.id=${String(row.id)}::uuid and s.enabled and s.approved_at is not null
 and enterprise_active_member_role(s.account_id,s.created_by)='manager' and s.next_period_start<date_trunc(case when a.payload->>'cadence'='weekly' then 'week' else 'month' end,clock_timestamp() at time zone 'UTC')::date),
 inserted as(insert into enterprise_schedule_periods(account_id,client_id,schedule_id,period_start,period_end) select account_id,client_id,id,next_period_start,next_start-1 from eligible on conflict(account_id,client_id,schedule_id,period_start) do nothing returning id),
 advanced as(update enterprise_schedules s set next_period_start=e.next_start from eligible e where s.id=e.id and s.account_id=e.account_id and s.client_id=e.client_id and(exists(select 1 from inserted) or exists(select 1 from enterprise_schedule_periods p where p.account_id=e.account_id and p.client_id=e.client_id and p.schedule_id=e.id and p.period_start=e.next_period_start)) returning s.id)
 select id from inserted`);return rows.length}
 let queued=0,deferred=0
 for(let offset=0;offset<due.length;offset+=4){if(Date.now()+3000>=deadline){deferred+=due.length-offset;break}const results=await Promise.allSettled(due.slice(offset,offset+4).map(process));for(const result of results)if(result.status==='fulfilled')queued+=result.value;else deferred++}
 return{queued,deferred}
}
export type EnterprisePeriod=OutcomeScope&{id:string;token:string;attempt:number;scheduleId:string;actor:string;configuration:Record<string,unknown>;start:string;end:string}
export async function claimEnterprisePeriod(scope:OutcomeScope,id:string):Promise<EnterprisePeriod|null>{
 const sql=db(),token=randomUUID(),rows=await enterpriseWrite(scope,sql`with claimed as(update enterprise_schedule_periods set status='running',attempt_count=attempt_count+1,lease_token=${token}::uuid,lease_until=clock_timestamp()+interval '2 minutes'
 where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid and id=${id}::uuid and status in('queued','failed') and attempt_count<3 and next_at<=clock_timestamp() returning *),
 attempt as(insert into enterprise_attempts(account_id,client_id,job_id,job_kind,number,lease_token) select account_id,client_id,id,'schedule',attempt_count,lease_token from claimed returning id)
 select p.id,p.schedule_id,p.attempt_count,p.period_start::text as period_start,p.period_end::text as period_end,s.created_by,a.payload
 from claimed p join enterprise_schedules s on s.id=p.schedule_id and s.account_id=p.account_id and s.client_id=p.client_id join enterprise_artifacts a on a.id=s.artifact_id and a.account_id=s.account_id and a.client_id=s.client_id`)
 const row=rows[0];return row?{...scope,id:String(row.id),scheduleId:String(row.schedule_id),token,attempt:Number(row.attempt_count),actor:String(row.created_by),configuration:row.payload as Record<string,unknown>,start:String(row.period_start),end:String(row.period_end)}:null
}
export async function finishEnterprisePeriod(job:EnterprisePeriod,status:'failed'|'blocked',reason:string){
 const sql=db(),rows=await enterpriseWrite(job,sql`with changed as(update enterprise_schedule_periods set status=${status},reason=${reason},lease_until=null,next_at=clock_timestamp()+interval '20 hours',finished_at=clock_timestamp()
 where account_id=${job.accountId}::uuid and client_id=${job.clientId}::uuid and id=${job.id}::uuid and status='running' and lease_token=${job.token}::uuid and lease_until>clock_timestamp() returning id),
 attempt as(update enterprise_attempts set status=${status},reason=${reason},finished_at=clock_timestamp() where account_id=${job.accountId}::uuid and client_id=${job.clientId}::uuid and job_id=${job.id}::uuid and job_kind='schedule' and lease_token=${job.token}::uuid and status='started' and exists(select 1 from changed) returning id)
 select id from attempt`);return!!rows.length
}
export async function generateEnterprisePeriod(job:EnterprisePeriod){
 const config=job.configuration,schedule=parseExecutiveSchedule({name:config.name,cadence:config.cadence,locale:config.locale,recipientIds:config.recipientIds,enabled:config.enabled}),branding=config.branding?parsePortalConfig(config.branding):await readEnterpriseBranding(job,schedule.locale)
 const snapshot=await buildExecutiveSnapshot(job,{start:job.start,end:job.end},{...branding,locale:schedule.locale});if(!snapshot)throw new OutcomeError('ENTERPRISE_NOT_FOUND',404)
 const sql=db(),artifactId=randomUUID(),eventId=randomUUID(),rows=await enterpriseWrite(job,sql`with eligible as(select p.id,s.created_by from enterprise_schedule_periods p join enterprise_schedules s on s.id=p.schedule_id and s.account_id=p.account_id and s.client_id=p.client_id
 where p.account_id=${job.accountId}::uuid and p.client_id=${job.clientId}::uuid and p.id=${job.id}::uuid and p.status='running' and p.lease_token=${job.token}::uuid and p.lease_until>clock_timestamp()
 and exists(select 1 from clients c where c.id=s.client_id and c.account_id=s.account_id and c.status='active') and s.enabled and s.approved_at is not null and enterprise_active_member_role(s.account_id,s.created_by)='manager'),
 artifact as(insert into enterprise_artifacts(id,account_id,client_id,kind,source_id,created_by,payload)
 select ${artifactId}::uuid,${job.accountId}::uuid,${job.clientId}::uuid,'executive_report',id,created_by,${JSON.stringify(snapshot)}::jsonb from eligible returning id,created_by,content_hash),
 event as(insert into enterprise_events(id,account_id,client_id,type,source_id,payload) select ${eventId}::uuid,${job.accountId}::uuid,${job.clientId}::uuid,'executive_report.ready',id,jsonb_build_object('artifactId',id,'issuerId',created_by,'locale',${schedule.locale}::text,'scheduleId',${job.scheduleId}::uuid) from artifact returning id),
 deliveries as(insert into enterprise_deliveries(account_id,client_id,event_id,kind,target_id,recipient_id,status,reason)
 select ${job.accountId}::uuid,${job.clientId}::uuid,e.id,'email',p.id,p.id,case when p.deactivated_at is null then 'queued' else 'blocked' end,case when p.deactivated_at is null then null else 'RECIPIENT_INACTIVE' end
 from event e cross join profiles p where p.account_id=${job.accountId}::uuid and p.id=any(${schedule.recipientIds}::uuid[]) returning id),
 finished as(update enterprise_schedule_periods set status='completed',artifact_id=${artifactId}::uuid,lease_until=null,finished_at=clock_timestamp(),
 reason=case when(select count(*) from deliveries)<${schedule.recipientIds.length} then 'REPORT_READY_RECIPIENTS_UNAVAILABLE' else 'REPORT_READY' end,
 result=jsonb_build_object('requestedRecipients',${schedule.recipientIds.length}::int,'deliveryReceipts',(select count(*) from deliveries))
 where account_id=${job.accountId}::uuid and client_id=${job.clientId}::uuid and id=${job.id}::uuid and exists(select 1 from artifact) returning id),
 attempt as(update enterprise_attempts set status='succeeded',reason='REPORT_READY',finished_at=clock_timestamp() where account_id=${job.accountId}::uuid and client_id=${job.clientId}::uuid and job_id=${job.id}::uuid and job_kind='schedule' and lease_token=${job.token}::uuid and status='started' and exists(select 1 from finished) returning id),
 logged as(insert into enterprise_audit(account_id,client_id,actor_id,action,target_id,metadata) select ${job.accountId}::uuid,${job.clientId}::uuid,created_by,'report.generated',id,jsonb_build_object('periodId',${job.id}::uuid,'contentHash',content_hash) from artifact returning id)
 select id from attempt`)
 if(!rows.length)throw new OutcomeError('ENTERPRISE_LEASE_LOST',409)
 return{artifactId}
}
/** Replayable discovery from immutable business ledgers: a crash between the
 * business write and event creation cannot lose a notification permanently. */
export async function discoverEnterpriseEvents(){
 const sql=db(),events=await sql`with sources as(
 select a.id,a.account_id,a.client_id,a.created_at,'executive_report.ready' as type,jsonb_build_object('artifactId',a.id,'issuerId',a.created_by,'locale',a.payload->>'locale') as payload from enterprise_artifacts a where a.kind='executive_report'
 union all select d.id,d.account_id,d.client_id,d.created_at,'workflow.decided',jsonb_build_object('artifactId',d.artifact_id,'decision',d.decision,'contentHash',d.content_hash) from enterprise_decisions d
 union all select o.id,o.account_id,o.client_id,o.received_at,'adapter.observation',jsonb_build_object('observationId',o.id,'runId',o.run_id,'provenance',o.provenance) from enterprise_adapter_observations o),due as(
 select s.* from sources s join clients c on c.id=s.client_id and c.account_id=s.account_id where c.status='active' and enterprise_account_entitled(s.account_id)
 and not exists(select 1 from enterprise_events e where e.account_id=s.account_id and e.client_id=s.client_id and e.type=s.type and e.source_id=s.id)
 order by s.created_at,s.id limit 50)
 insert into enterprise_events(account_id,client_id,type,source_id,payload,created_at) select account_id,client_id,type,id,payload,created_at from due on conflict(account_id,client_id,type,source_id) do nothing returning id`
 await sql`with due as(select e.id,e.account_id,e.client_id,w.id as endpoint_id from enterprise_events e join enterprise_webhooks w on w.account_id=e.account_id and w.client_id=e.client_id and w.revoked_at is null and e.type=any(w.events) and w.created_at<=e.created_at
 where exists(select 1 from clients c where c.id=w.client_id and c.account_id=w.account_id and c.status='active') and enterprise_active_member_role(w.account_id,w.created_by)='manager' and not exists(select 1 from enterprise_deliveries d where d.account_id=e.account_id and d.client_id=e.client_id and d.event_id=e.id and d.kind='webhook' and d.target_id=w.id)
 order by e.created_at,e.id,w.id limit 200)
 insert into enterprise_deliveries(account_id,client_id,event_id,kind,target_id,endpoint_id) select account_id,client_id,id,'webhook',endpoint_id,endpoint_id from due on conflict(account_id,client_id,event_id,kind,target_id) do nothing`
 return events.length
}
export async function repairEnterpriseLeases(){
 const sql=db();const[periods,deliveries]=await sql.transaction([
 sql`with repaired as(update enterprise_schedule_periods set status=case when attempt_count<3 then 'queued' else 'unknown' end,reason='LEASE_EXPIRED',lease_until=null,next_at=clock_timestamp()
 where status='running' and lease_until<clock_timestamp() returning *),attempts as(update enterprise_attempts a set status='unknown',reason='LEASE_EXPIRED',finished_at=clock_timestamp() from repaired r
 where a.account_id=r.account_id and a.client_id=r.client_id and a.job_id=r.id and a.job_kind='schedule' and a.lease_token=r.lease_token and a.status='started' returning a.id) select id from repaired`,
 sql`with repaired as(update enterprise_deliveries set status='unknown',reason='LEASE_EXPIRED',lease_until=null,finished_at=clock_timestamp()
 where status='running' and lease_until<clock_timestamp() returning *),attempts as(update enterprise_attempts a set status='unknown',reason='LEASE_EXPIRED',finished_at=clock_timestamp() from repaired r
 where a.account_id=r.account_id and a.client_id=r.client_id and a.job_id=r.id and a.job_kind='delivery' and a.lease_token=r.lease_token and a.status='started' returning a.id) select id from repaired`
 ]);return periods.length+deliveries.length
}
export async function runEnterpriseAutomation(deadline=Date.now()+45000){
 if(!isFeatureEnabled('enterprise_os'))return{repaired:0,queued:0,reports:0,events:0,deliveries:0,deferred:0}
 const sql=db();let deferred=0,reports=0,deliveries=0
 const attempt=async<T>(task:()=>Promise<T>,fallback:T)=>{try{return await task()}catch{deferred++;return fallback}}
 const repaired=await attempt(repairEnterpriseLeases,0),discovery=await attempt(()=>discoverEnterprisePeriods(deadline),{queued:0,deferred:0}),queued=discovery.queued;deferred+=discovery.deferred
 const periods=await attempt(async()=>await sql`select id,account_id,client_id from enterprise_schedule_periods where status in('queued','failed') and attempt_count<3 and next_at<=clock_timestamp() and enterprise_account_entitled(account_id) order by next_at,id limit 20`,[])
 for(const row of periods){if(Date.now()+7000>=deadline){deferred++;break}await attempt(async()=>{const job=await claimEnterprisePeriod({accountId:String(row.account_id),clientId:String(row.client_id)},String(row.id));if(!job)return
  const[eligible]=await sql`select s.id from enterprise_schedules s where s.account_id=${job.accountId}::uuid and s.client_id=${job.clientId}::uuid and s.id=${job.scheduleId}::uuid and exists(select 1 from clients c where c.id=s.client_id and c.account_id=s.account_id and c.status='active') and s.enabled and s.approved_at is not null and enterprise_active_member_role(s.account_id,s.created_by)='manager'`
  if(!eligible){await finishEnterprisePeriod(job,'blocked','AUTHORIZATION_CHANGED');return}
  try{await generateEnterprisePeriod(job);reports++}catch{await finishEnterprisePeriod(job,'failed','REPORT_GENERATION_UNAVAILABLE');deferred++}
 },undefined)}
 const events=await attempt(discoverEnterpriseEvents,0),due=await attempt(async()=>await sql`select id,account_id,client_id from enterprise_deliveries where status='queued' and attempt_count<3 and next_at<=clock_timestamp() and enterprise_account_entitled(account_id) order by next_at,id limit 20`,[])
 for(let offset=0;offset<due.length;offset+=4){if(Date.now()+6000>=deadline){deferred+=due.length-offset;break}await Promise.all(due.slice(offset,offset+4).map(row=>attempt(async()=>{const job=await claimEnterpriseDelivery({accountId:String(row.account_id),clientId:String(row.client_id)},String(row.id));if(job){const receipt=await deliverEnterpriseJob(job,deadline);deliveries++;if(receipt.status==='unknown'||receipt.status==='failed')deferred++}},undefined)))}
 return{repaired,queued,reports,events,deliveries,deferred}
}
