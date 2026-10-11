import 'server-only'
import {createHash} from 'node:crypto'
import {db} from '@/lib/db'
import {resolveCommercialEntitlement,type CommercialAccount} from '@/lib/tier'
import {isFeatureEnabled} from '@/lib/flags'
import {MAX_PROMPTS} from '@/lib/pulse/limits'
import {modelVariantsFor} from '@/lib/openrouter'
import {runtimePlatformsFor} from '@/lib/pulse/platforms'
import {isPromptLanguage,isPromptMarket} from '@/lib/prompts/context'
import {currentScanWeek} from '@/lib/pulse/schedule'
import {isoDate} from '@/lib/iso-date'
import {createOrResumeRun} from './store'
import {coverageFromCounts,type PulseScope,type PulseIntent,type RunCoverage} from './schema'
import {runPulseChunk} from './service'
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
export function parsePulseIntent(raw:unknown):PulseIntent {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('INVALID_PULSE_INTENT')
 const value=raw as Record<string,unknown>
 if(!['initial','repair','retest'].includes(String(value.kind))||typeof value.intentKey!=='string'||!/^[a-zA-Z0-9:_-]{8,128}$/.test(value.intentKey)||(value.sourceRunId!==undefined&&(typeof value.sourceRunId!=='string'||!uuid.test(value.sourceRunId)))||(value.kind!=='initial'&&!value.sourceRunId))throw new Error('INVALID_PULSE_INTENT')
 return {kind:value.kind as PulseIntent['kind'],intentKey:value.intentKey,...(typeof value.sourceRunId==='string'?{sourceRunId:value.sourceRunId}:{})}
}
/** An operational answer-workload ceiling, separate from currency or a marketing plan quota. */
export function userPulseBudget(maxBrands:number,variants:number):number {
 const raw=process.env.PULSE_USER_ANSWERS_PER_WEEK
 if(raw!==undefined){if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw)))throw new Error('PULSE_BUDGET_UNAVAILABLE');return Number(raw)}
 return Math.max(1,maxBrands)*MAX_PROMPTS*variants*2
}
export type UserPulseRun={id:string;week:string;purpose:'canonical'|'retest';sourceRunId:string|null;coverage:RunCoverage;reasons:string[];retryable:boolean;observedAt:string|null}
export type PulseStartResult={run:UserPulseRun;coverage:RunCoverage}
export async function readUserPulseRun(scope:PulseScope,runId:string):Promise<UserPulseRun|null>{
 const [row]=await db()`select r.id,r.scan_week,r.purpose,r.source_run_id,r.updated_at,jsonb_array_length(r.manifest->'items') as manifest_expected,
  count(i.id)::int as expected,count(i.id) filter(where i.status='running')::int as running,count(i.id) filter(where i.status='succeeded')::int as succeeded,
  count(i.id) filter(where i.status='failed')::int as failed,count(i.id) filter(where i.status in ('queued','running','retry_wait'))::int as pending,
  count(i.id) filter(where i.status='blocked')::int as blocked,count(i.id) filter(where i.status='succeeded' and i.classification_status='classified')::int as classified,
  count(i.id) filter(where i.status='succeeded' and i.classification_status='classified' and (a.classification->>'brandMentioned')::boolean)::int as mentioned,
  coalesce(array_agg(distinct a.error_code) filter(where a.error_code is not null and i.status<>'succeeded'),'{}'::text[]) as errors,
  bool_or((i.status in ('queued','retry_wait') and i.attempt_count<3) or (i.status='succeeded' and i.classification_status<>'classified' and i.classification_attempt_count<3)
   or (i.status='blocked' and i.attempt_count<3 and a.error_code in ('PROVIDER_NOT_CONFIGURED','PLAN_HAS_NO_PLATFORMS'))) as retryable
  from pulse_runs r join clients c on c.id=r.client_id and c.account_id=r.account_id
  left join pulse_run_items i on i.run_id=r.id and i.account_id=r.account_id and i.client_id=r.client_id
  left join pulse_item_attempts a on a.item_id=i.id and a.account_id=r.account_id and a.attempt_number=i.attempt_count
  where r.id=${runId}::uuid and r.account_id=${scope.accountId} and r.client_id=${scope.clientId}::uuid group by r.id`
 if(!row)return null
 if(Number(row.expected)!==Number(row.manifest_expected))throw new Error('PULSE_STATUS_UNAVAILABLE')
 const coverage=coverageFromCounts({expected:Number(row.expected),succeeded:Number(row.succeeded),failed:Number(row.failed),pending:Number(row.pending),blocked:Number(row.blocked),classified:Number(row.classified),mentioned:Number(row.mentioned)})
 if(coverage.status==='queued'&&Number(row.running)>0)coverage.status='running'
 // Safe categories only: never expose provider bodies, request IDs, credentials or arbitrary error strings.
 const codes=row.errors as string[]
 const reasons:string[]=[...new Set(codes.map(code=>code.includes('OUTCOME_UNKNOWN')?'outcome_unknown':code==='PROVIDER_NOT_CONFIGURED'?'provider_not_configured':code==='PLAN_HAS_NO_PLATFORMS'?'entitlement_changed':'collection_failed'))]
 if(coverage.classified<coverage.succeeded)reasons.push('classification_pending')
 return{id:String(row.id),week:isoDate(row.scan_week as string|Date,''),purpose:row.purpose as 'canonical'|'retest',sourceRunId:row.source_run_id as string|null,coverage,reasons,retryable:row.retryable===true,observedAt:row.updated_at instanceof Date?row.updated_at.toISOString():typeof row.updated_at==='string'?row.updated_at:null}
}
export async function readUserPulseOptions(scope:PulseScope){
 const sql=db();const [client]=await sql`select a.plan,a.status,a.stripe_subscription_id,a.trial_ends_at,a.override_plan,a.override_expires_at from clients c join accounts a on a.id=c.account_id where c.id=${scope.clientId}::uuid and c.account_id=${scope.accountId} and c.status='active'`
 if(!client)throw new Error('PULSE_RUN_NOT_FOUND')
 const entitlement=resolveCommercialEntitlement(client as CommercialAccount),variants=modelVariantsFor(runtimePlatformsFor(entitlement.features.platform_access))
 const prompts=await sql`select language,market from prompt_bank p join clients c on c.id=p.client_id where c.id=${scope.clientId}::uuid and c.account_id=${scope.accountId} and p.is_active order by p.id limit ${MAX_PROMPTS+1}`
 const week=currentScanWeek(),cap=userPulseBudget(entitlement.features.max_brands,variants.length)
 const [budget]=await sql`select (coalesce((select sum(reserved_units) from pulse_run_reservations where account_id=${scope.accountId} and scan_week=${week}::date),0)+coalesce((select sum(jsonb_array_length(r.manifest->'items')) from pulse_runs r where r.account_id=${scope.accountId} and r.scan_week=${week}::date and not exists(select 1 from pulse_run_reservations z where z.run_id=r.id and z.account_id=r.account_id)),0))::int as reserved`
 if(!Number.isSafeInteger(Number(budget?.reserved))||Number(budget.reserved)<0)throw new Error('PULSE_BUDGET_UNAVAILABLE')
 const runs=await sql`select id,scan_week,purpose from pulse_runs where account_id=${scope.accountId} and client_id=${scope.clientId}::uuid order by created_at desc,id desc limit 10`
 const [canonical]=await sql`select id from pulse_runs where account_id=${scope.accountId} and client_id=${scope.clientId}::uuid and purpose='canonical' and scan_week=${week}::date`;const currentCanonicalId=canonical?.id??null
 const latest=runs[0]?await readUserPulseRun(scope,String(runs[0].id)):null
 const [legacy]=await sql`select exists(select 1 from pulse_metrics m join clients c on c.id=m.client_id where c.id=${scope.clientId}::uuid and c.account_id=${scope.accountId} and m.run_item_id is null and m.scan_week=${week}::date and m.raw_answer ~ '[^[:space:]]') as present`
 const legacyRows=await sql`select m.id from pulse_metrics m join clients c on c.id=m.client_id where c.id=${scope.clientId}::uuid and c.account_id=${scope.accountId} and m.run_item_id is null and m.scan_week=${week}::date and m.raw_answer ~ '[^[:space:]]' and m.classification_status<>'classified' order by m.created_at,m.id limit 50`
 return{currentCanonicalId,legacyObservationIds:legacyRows.map(row=>String(row.id)),prompts:prompts.length,variants:variants.length,models:variants,expected:prompts.length*variants.length,contextConfirmed:prompts.length<=MAX_PROMPTS&&prompts.every(p=>isPromptLanguage(p.language)&&isPromptMarket(p.market)),remaining:Math.max(0,cap-Number(budget.reserved)),cap,week,latest,legacyCurrentWeek:legacy?.present===true,search:{requested:isFeatureEnabled('pulse_grounding')?'subject_to_allowance':'off',execution:'unknown',nativeVariants:variants.filter(v=>v.platform.startsWith('perplexity')).length},costEstimateUsd:null,nextDueAt:null,scheduleState:'unknown' as const,enabled:isFeatureEnabled('pulse_attempts')}
}
export async function startOrResumeUserPulse(scope:PulseScope,intent:PulseIntent):Promise<PulseStartResult>{
 const options=await readUserPulseOptions(scope)
 if(!options.enabled)throw new Error('PULSE_WORKER_DISABLED')
 if(!options.variants)throw new Error('PULSE_ENTITLEMENT_CHANGED')
 // An initial click with historical raw evidence must lead to classification-only repair, never recollection.
 if(intent.kind==='initial'&&options.legacyCurrentWeek&&!options.currentCanonicalId)throw new Error('PULSE_LEGACY_REPAIR_REQUIRED')
 const source=intent.sourceRunId?await readUserPulseRun(scope,intent.sourceRunId):null
 if(intent.sourceRunId&&!source)throw new Error('PULSE_RUN_NOT_FOUND')
 const requestHash=createHash('sha256').update(JSON.stringify(intent)).digest('hex')
 const run=await createOrResumeRun(scope,{scanWeek:intent.kind==='repair'?source!.week:options.week,manifest:options.models,intent,dispatch:{requestHash,reservationCap:options.cap}})
 if(!run)throw new Error('PULSE_RUN_NOT_FOUND')
 const result=await readUserPulseRun(scope,run.id)
 if(!result)throw new Error('PULSE_STATUS_UNAVAILABLE')
 return{run:result,coverage:result.coverage}
}
/** Wake only. The persisted run is independently discoverable by the existing repair inventory. */
export async function wakeUserPulse(scope:PulseScope,result:PulseStartResult){
 const target=await readUserPulseOptions(scope)
 if(!target.enabled||!target.variants||result.coverage.status==='completed')return
 try{await runPulseChunk(scope,{runId:result.run.id,scanWeek:result.run.week,platforms:target.models.map(v=>v.platform),limit:5,deadlineAt:Date.now()+45000})}catch{console.error('[pulse/user] wake failed; durable run retained for repair')}
}
