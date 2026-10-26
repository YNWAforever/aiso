import 'server-only'
import { db } from '@/lib/db'
import { isFeatureEnabled } from '@/lib/flags'
import { resolveCommercialEntitlement,type CommercialAccount } from '@/lib/tier'
import { canonicalOutcomeUrl,OutcomeError } from '@/lib/outcome-integrations/input'
import type { OutcomeScope } from '@/lib/outcome-integrations/store'
import { startOrResumeUserPulse } from '@/lib/pulse/runs/user-dispatch'
import type { PulseIntent } from '@/lib/pulse/runs/schema'
import { finishVisibilityJob,saveVisibilityPageSnapshot,type VisibilityJobLease } from './jobs'
import { validateVisibilityPage,type VisibilityPage } from './page'
export async function authorizeVisibilityJob(job:VisibilityJobLease) {
  const sql=db()
  const [row]=await sql`select c.domain,c.status as client_status,a.plan,a.status,a.stripe_subscription_id,a.trial_ends_at,a.override_plan,a.override_expires_at,
    s.auto_retest,(${job.sourceAt}::timestamptz>=s.updated_at) as since_opt_in,p.id as automation_actor,requester.id as requesting_actor from clients c join accounts a on a.id=c.account_id
    left join visibility_settings s on s.account_id=c.account_id and s.client_id=c.id
    left join profiles p on p.id=s.enabled_by and p.account_id=c.account_id and p.deactivated_at is null
    left join profiles requester on requester.id=${job.requestedBy}::uuid and requester.account_id=c.account_id and requester.deactivated_at is null
    where c.account_id=${job.accountId}::uuid and c.id=${job.clientId}::uuid`
  const authorized=row&&isFeatureEnabled('closed_loop_visibility')&&row.client_status==='active'&&resolveCommercialEntitlement(row as CommercialAccount).features.closed_loop_visibility
    &&(job.requestedBy?!!row.requesting_actor:row.auto_retest===true&&!!row.automation_actor&&row.since_opt_in===true)
  return{allowed:!!authorized,reason:authorized?'AUTHORIZED':'AUTHORIZATION_CHANGED',domain:row?String(row.domain):''}
}
type Ports={authorize:typeof authorizeVisibilityJob;check:typeof validateVisibilityPage;snapshot:typeof saveVisibilityPageSnapshot;
  start(scope:OutcomeScope,intent:PulseIntent):Promise<{run:{id:string}}>;
  finish:typeof finishVisibilityJob}
const ports:Ports={authorize:authorizeVisibilityJob,check:validateVisibilityPage,snapshot:saveVisibilityPageSnapshot,start:startOrResumeUserPulse,finish:finishVisibilityJob}
function pageComparisons(baseline:Record<string,unknown>,pages:VisibilityPage[]) {
  const old=Array.isArray(baseline.pages)?baseline.pages as VisibilityPage[]:[]
  return pages.map(after=>{
    const before=old.find(page=>page.url===after.url)
    const comparable=!!before&&before.collection==='complete'&&after.collection==='complete'&&before.method===after.method
      &&Date.parse(before.observedAt)<=Date.parse(after.observedAt)
    return{url:after.url,comparable,before:before??null,after,contentChanged:comparable?before!.contentHash!==after.contentHash:null,claim:'observed_difference_only'}
  })
}
/** This worker never sends an LLM request. It durably reserves a normal Pulse
 * retest, whose existing worker and quota ledger own collection and repair. */
export async function processVisibilityJob(job:VisibilityJobLease,deadline:number,deps:Ports=ports) {
  const scope={accountId:job.accountId,clientId:job.clientId}
  async function finish(status:Parameters<Ports['finish']>[1],reason:string,result:Record<string,unknown>,retest:string|null=null) {
    if(!await deps.finish(job,status,reason,result,retest))throw new OutcomeError('VISIBILITY_LEASE_LOST',409)
  }
  const access=await deps.authorize(job)
  if(!access.allowed)return finish('blocked',access.reason,{},null)
  try {for(const url of job.urls)if(new URL(canonicalOutcomeUrl(url,access.domain)).protocol!=='https:')throw new Error()}
  catch{return finish('blocked','TARGET_URL_UNSUPPORTED',{},null)}
  const pages:VisibilityPage[]=[]
  try {
    for(let offset=0;offset<job.urls.length;offset+=4) {
      if(Date.now()+6000>=deadline)return finish('failed','TIME_BUDGET_EXHAUSTED',{pages},null)
      const checked=await Promise.all(job.urls.slice(offset,offset+4).map(url=>deps.check(url,access.domain)))
      for(const page of checked){await deps.snapshot(scope,page,'closed_loop',job.requestedBy);pages.push(page)}
    }
  }catch{return finish('failed','PAGE_COLLECTION_UNAVAILABLE',{pages},null)}
  const result={pages,pageComparisons:pageComparisons(job.baseline,pages),baseline:job.baseline,claim:'observed_difference_only'}
  if(!job.sourceRunId)return finish('completed','AI_BASELINE_UNAVAILABLE',{...result,ai:{comparable:false,reasons:['AI_BASELINE_UNAVAILABLE']}},null)
  let runId:string
  try {
    const retest=await deps.start(scope,{kind:'retest',intentKey:`closed-loop:${job.id}`,sourceRunId:job.sourceRunId})
    runId=retest.run.id
  }catch(error){
    const code=error instanceof Error?error.message:''
    const reason=code==='PULSE_QUOTA_EXCEEDED'?'PULSE_QUOTA_EXCEEDED':code==='PULSE_WORKER_DISABLED'?'PULSE_WORKER_DISABLED':code==='PULSE_ENTITLEMENT_CHANGED'?'AUTHORIZATION_CHANGED':'RETEST_RESERVATION_UNAVAILABLE'
    return finish(reason==='RETEST_RESERVATION_UNAVAILABLE'?'unknown':'blocked',reason,result,null)
  }
  return finish('waiting','PULSE_PENDING',{...result,ai:{comparable:false,reasons:['PULSE_PENDING']}},runId)
}
