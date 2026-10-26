import 'server-only'
import { db } from '@/lib/db'
import { resolveCommercialEntitlement,type CommercialAccount } from '@/lib/tier'
import type { OutcomeScope } from '@/lib/outcome-integrations/store'
import { validateVisibilityPage } from './page'
import { enqueueVisibilitySource,claimVisibilityJob,repairVisibilityLeases,finishWaitingVisibilityJob,saveVisibilityPageSnapshot,type VisibilityJobLease } from './jobs'
import { authorizeVisibilityJob,processVisibilityJob } from './worker'
import { readVisibilityRunEvidence } from './store'
import { compareVisibilityRuns } from './comparison'

/** Cron-only cross-account selection; all later reads/writes carry row scope. */
export async function loadVisibilityAutomationTargets() {
  const sql=db()
  return sql`select s.account_id,s.client_id,p.id as actor_id,c.domain,a.plan,a.status,a.stripe_subscription_id,a.trial_ends_at,a.override_plan,a.override_expires_at
    from visibility_settings s join clients c on c.id=s.client_id and c.account_id=s.account_id
    join profiles p on p.id=s.enabled_by and p.account_id=s.account_id and p.deactivated_at is null join accounts a on a.id=s.account_id
    where s.auto_retest and c.status='active' order by s.last_checked_at nulls first,s.account_id,s.client_id limit 10`
}
export async function discoverVisibilitySources(scope:OutcomeScope) {
  const sql=db()
  return sql`select source.id,source.kind from (
    select d.id,'deployment' as kind,d.deployed_at as source_at from outcome_deployments d join visibility_settings s on s.account_id=d.account_id and s.client_id=d.client_id
    where d.account_id=${scope.accountId}::uuid and d.client_id=${scope.clientId}::uuid and s.auto_retest and d.deployed_at>=s.updated_at and d.deployed_at<=clock_timestamp()
      and not exists(select 1 from visibility_revalidations j where j.account_id=d.account_id and j.client_id=d.client_id and j.source_kind='deployment' and j.source_id=d.id)
    union all
    select e.id,'work_completion',e.completed_at from visibility_completion_events e join visibility_settings s on s.account_id=e.account_id and s.client_id=e.client_id
    where e.account_id=${scope.accountId}::uuid and e.client_id=${scope.clientId}::uuid and s.auto_retest and e.completed_at>=s.updated_at
      and not exists(select 1 from visibility_revalidations j where j.account_id=e.account_id and j.client_id=e.client_id and j.source_kind='work_completion' and j.source_id=e.id)
    ) source order by source.source_at,source.id limit 10`
}
/** Cron-only. Pending jobs retain their original tenant and requester. */
export async function loadDueVisibilityJobs() {
  const sql=db()
  return sql`select j.*,j.source_at::text as source_at,c.domain from visibility_revalidations j join clients c on c.id=j.client_id and c.account_id=j.account_id
    where c.status='active' and j.next_at<=clock_timestamp() and (j.status='waiting' or (j.status in ('queued','failed','unknown') and j.attempt_count<3))
    order by j.next_at,j.created_at,j.id limit 20`
}
export async function pollWaitingVisibilityJob(row:Record<string,unknown>) {
  const scope={accountId:String(row.account_id),clientId:String(row.client_id)},retest=String(row.retest_run_id)
  const job:VisibilityJobLease={...scope,id:String(row.id),token:'',attempt:Number(row.attempt_count),domain:String(row.domain),urls:row.urls as string[],baseline:row.baseline as Record<string,unknown>,
    sourceRunId:row.source_run_id?String(row.source_run_id):null,retestRunId:retest,requestedBy:row.requested_by?String(row.requested_by):null,sourceAt:String(row.source_at)}
  const access=await authorizeVisibilityJob(job),result=(row.result??{}) as Record<string,unknown>
  if(!access.allowed)return finishWaitingVisibilityJob(scope,job.id,retest,'blocked','AUTHORIZATION_CHANGED',{...result,ai:{comparable:false,reasons:['AUTHORIZATION_CHANGED']}})
  const [before,after]=await Promise.all([job.sourceRunId?readVisibilityRunEvidence(scope,job.sourceRunId):null,readVisibilityRunEvidence(scope,retest)])
  if(!before||!after)return finishWaitingVisibilityJob(scope,job.id,retest,'blocked','RUN_EVIDENCE_UNAVAILABLE',{...result,ai:{comparable:false,reasons:['RUN_EVIDENCE_UNAVAILABLE']}})
  const expected=Array.isArray(after.manifest.items)?after.manifest.items.length:0
  const complete=expected>0&&after.observations.length===expected&&after.observations.every(observation=>observation.answerPresence!==null)
  const expired=Date.now()-new Date(String(row.created_at)).getTime()>7*86400000
  if(!complete&&!['failed','blocked'].includes(after.status)&&!expired) {
    const sql=db()
    await sql`update visibility_revalidations set next_at=clock_timestamp()+interval '1 hour' where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid
      and id=${job.id}::uuid and status='waiting' and retest_run_id=${retest}::uuid`
    return false
  }
  const ai=compareVisibilityRuns(before,after)
  return finishWaitingVisibilityJob(scope,job.id,retest,expired&&!complete?'blocked':'completed',expired&&!complete?'PULSE_WINDOW_EXPIRED':ai.comparable?'COMPARISON_READY':'COMPARISON_LIMITED',{...result,ai})
}
async function captureRoutineBaselines(scope:OutcomeScope,domain:string,deadline:number) {
  if(Date.now()+7000>=deadline)return 0
  const sql=db()
  const targets=await sql`select q.monitoring->>'targetUrl' as url,max(p.observed_at) as last_checked from monitored_queries q
    left join visibility_page_snapshots p on p.account_id=q.account_id and p.client_id=q.client_id and p.url=q.monitoring->>'targetUrl'
    where q.account_id=${scope.accountId}::uuid and q.client_id=${scope.clientId}::uuid and q.is_active and q.context_current and q.monitoring->>'targetUrl' is not null
    group by q.monitoring->>'targetUrl' order by max(p.observed_at) nulls first,q.monitoring->>'targetUrl' limit 4`
  let captured=0
  const evidence=await Promise.allSettled(targets.map(target=>validateVisibilityPage(String(target.url),domain)))
  for(const page of evidence)if(page.status==='fulfilled'){await saveVisibilityPageSnapshot(scope,page.value,'routine');captured++}
  return captured
}
export async function runVisibilityRevalidations(deadline=Date.now()+45000) {
  const repaired=await repairVisibilityLeases(),targets=await loadVisibilityAutomationTargets(),active:typeof targets=[]
  let queued=0,processed=0,baselines=0,deferred=0
  const sql=db()
  for(const target of targets) {
    if(Date.now()+6000>=deadline){deferred++;continue}
    const scope={accountId:String(target.account_id),clientId:String(target.client_id)}
    if(resolveCommercialEntitlement(target as CommercialAccount).features.closed_loop_visibility) {
      active.push(target)
      for(const source of await discoverVisibilitySources(scope)) {
        if(Date.now()+6000>=deadline){deferred++;break}
        await enqueueVisibilitySource(scope,source.kind as 'deployment'|'work_completion',String(source.id));queued++
      }
    }
    await sql`update visibility_settings set last_checked_at=clock_timestamp() where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid`
  }
  for(const row of await loadDueVisibilityJobs()) {
    if(Date.now()+7000>=deadline){deferred++;continue}
    if(row.status==='waiting')await pollWaitingVisibilityJob(row)
    else {
      const lease=await claimVisibilityJob({accountId:String(row.account_id),clientId:String(row.client_id)},String(row.id))
      if(lease)await processVisibilityJob(lease,deadline)
    }
    processed++
  }
  for(const target of active)baselines+=await captureRoutineBaselines({accountId:String(target.account_id),clientId:String(target.client_id)},String(target.domain),deadline)
  return{repaired,queued,processed,baselines,deferred}
}
