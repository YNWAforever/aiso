import 'server-only'
import {createHash,randomUUID} from 'node:crypto'
import {db} from '@/lib/db'
import {analyseAnswer} from '@/lib/pulse/analysis'
import {ANALYSIS_VERSION,naiveAnalysis,type AnswerAnalysisV2} from '@/lib/pulse/analysis-fallback'
import {mergeCompetitorRefs} from '@/lib/competitors/schema'
import {computeWeeklySummary} from '@/lib/pulse/summary'
import {isoDate} from '@/lib/iso-date'
import {readRunCoverage} from './store'
import type {PulseScope} from './schema'
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
type Input={runId:string;observationIds:string[];intentKey:string;deadlineAt:number}

/** A new classifier version may assess a saved answer once. Collection receipts and the ordinary three attempts remain immutable. */
export async function repairSavedRunClassifications(scope:PulseScope,input:Input,classifier:typeof analyseAnswer=analyseAnswer){
 if(!uuid.test(input.runId)||input.observationIds.length>5||new Set(input.observationIds).size!==input.observationIds.length||input.observationIds.some(id=>!uuid.test(id))||!/^[a-zA-Z0-9:_-]{8,128}$/.test(input.intentKey)||!Number.isFinite(input.deadlineAt)||input.deadlineAt<=Date.now()||input.deadlineAt>Date.now()+120000)throw new Error('INVALID_LEGACY_REPAIR')
 if(!input.observationIds.length){await finalizeSavedRun(scope,input.runId,true);return{classified:0,unchanged:0,failed:0}}
 const sql=db()
 const rows=await sql`select m.id,i.id as item_id,i.accepted_attempt_id,i.classification_status,i.classification_attempt_count,i.classification_lease_until,
   a.raw_answer,a.classifier_version,r.manifest->'brand' as brand,r.scan_week,r.purpose
  from pulse_metrics m join pulse_run_items i on i.id=m.run_item_id and i.client_id=m.client_id
  join pulse_runs r on r.id=i.run_id and r.account_id=i.account_id and r.client_id=i.client_id
  join pulse_item_attempts a on a.id=i.accepted_attempt_id and a.item_id=i.id and a.account_id=i.account_id and a.client_id=i.client_id
  where r.id=${input.runId}::uuid and r.account_id=${scope.accountId} and r.client_id=${scope.clientId}::uuid
   and m.id=any(${input.observationIds}::uuid[]) and m.raw_answer=a.raw_answer and i.status='succeeded'`
 if(rows.length!==input.observationIds.length)throw new Error('LEGACY_REPAIR_NOT_FOUND')
 let classified=0,unchanged=0,failed=0
 for(const row of rows){
  if(row.classification_status==='classified'||Number(row.classification_attempt_count)<3||row.classifier_version===ANALYSIS_VERSION||(row.classification_lease_until&&new Date(row.classification_lease_until as string).getTime()>Date.now())){unchanged++;continue}
  if(classifier===analyseAnswer&&!process.env.OPENROUTER_API_KEY)throw new Error('PROVIDER_NOT_CONFIGURED')
  if(Date.now()+16000>=input.deadlineAt){failed++;continue}
  const brand=row.brand as {name?:unknown;competitors?:unknown[];competitorRefs?:{name?:unknown;aliases?:unknown}[]}
  if(typeof brand?.name!=='string'||!brand.name.trim()||typeof row.raw_answer!=='string'||!row.raw_answer.trim())throw new Error('LEGACY_REPAIR_NOT_FOUND')
  const answer=row.raw_answer,answerHash=createHash('sha256').update(answer).digest('hex'),token=randomUUID()
  const competitors=mergeCompetitorRefs(brand.competitors,brand.competitorRefs??[])
  const context={basis:'run-manifest',version:ANALYSIS_VERSION,runId:input.runId,acceptedAttemptId:row.accepted_attempt_id,name:brand.name,competitors}
  const [,claimed]=await sql.transaction([
   sql`select id from pulse_run_items where id=${row.item_id}::uuid and run_id=${input.runId}::uuid and account_id=${scope.accountId} and client_id=${scope.clientId}::uuid for update`,
   sql`insert into pulse_legacy_classification_attempts(account_id,client_id,observation_id,intent_key,answer_hash,context,lease_token,lease_until)
    select ${scope.accountId},${scope.clientId}::uuid,m.id,${input.intentKey},${answerHash},${JSON.stringify(context)}::jsonb,${token}::uuid,${new Date(input.deadlineAt).toISOString()}::timestamptz
    from pulse_metrics m join pulse_run_items i on i.id=m.run_item_id and i.client_id=m.client_id
    join pulse_item_attempts a on a.id=i.accepted_attempt_id and a.item_id=i.id and a.account_id=i.account_id and a.client_id=i.client_id
    where m.id=${row.id}::uuid and i.run_id=${input.runId}::uuid and i.account_id=${scope.accountId} and i.client_id=${scope.clientId}::uuid
     and i.status='succeeded' and i.classification_status<>'classified' and i.classification_attempt_count>=3
     and (i.classification_lease_until is null or i.classification_lease_until<now())
     and i.accepted_attempt_id=${row.accepted_attempt_id}::uuid and a.raw_answer=${answer} and m.raw_answer=${answer}
     and a.classifier_version is distinct from ${ANALYSIS_VERSION}
     and not exists(select 1 from pulse_legacy_classification_attempts j where j.account_id=${scope.accountId} and j.client_id=${scope.clientId}::uuid and j.observation_id=m.id and j.context->>'version'=${ANALYSIS_VERSION})
    on conflict(account_id,observation_id,intent_key) do nothing returning id`
  ])
  if(!claimed[0]){unchanged++;continue}
  let result:AnswerAnalysisV2,timer:ReturnType<typeof setTimeout>|undefined
  try{result=await Promise.race([classifier({answer,brandName:brand.name,competitors}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Classifier deadline')),15000)})])}
  catch{result={...naiveAnalysis(answer,brand.name,competitors),classificationStatus:'failed',method:'saved-repair-exception',version:ANALYSIS_VERSION}}
  finally{clearTimeout(timer)}
  if(result.version!==ANALYSIS_VERSION){
   await sql`update pulse_legacy_classification_attempts set status='failed',analysis=${JSON.stringify({diagnosticReason:'stale_classifier_version',version:ANALYSIS_VERSION})}::jsonb,finished_at=now()
    where id=${claimed[0].id}::uuid and account_id=${scope.accountId} and client_id=${scope.clientId}::uuid and lease_token=${token}::uuid and status='started'`
   failed++;continue
  }
  const serialized=JSON.stringify(result)
  const [,committed]=await sql.transaction([
   sql`select id from pulse_run_items where id=${row.item_id}::uuid and run_id=${input.runId}::uuid and account_id=${scope.accountId} and client_id=${scope.clientId}::uuid for update`,
   sql`with eligible as (
     select j.id as journal_id,m.id as metric_id,i.id as item_id,a.id as attempt_id
     from pulse_legacy_classification_attempts j join pulse_metrics m on m.id=j.observation_id and m.client_id=j.client_id
     join pulse_run_items i on i.id=m.run_item_id and i.account_id=j.account_id and i.client_id=j.client_id
     join pulse_item_attempts a on a.id=i.accepted_attempt_id and a.item_id=i.id and a.account_id=i.account_id and a.client_id=i.client_id
     where j.id=${claimed[0].id}::uuid and j.account_id=${scope.accountId} and j.client_id=${scope.clientId}::uuid and j.lease_token=${token}::uuid
      and j.status='started' and j.lease_until>now() and j.answer_hash=${answerHash} and j.context->>'version'=${ANALYSIS_VERSION}
      and i.run_id=${input.runId}::uuid and i.status='succeeded' and i.classification_status<>'classified'
      and i.accepted_attempt_id=${row.accepted_attempt_id}::uuid and a.raw_answer=${answer} and m.raw_answer=${answer}
      and a.classifier_version is distinct from ${ANALYSIS_VERSION}
   ), items as (
    update pulse_run_items i set classification_status=${result.classificationStatus},classification_lease_token=null,classification_lease_until=null,updated_at=now() from eligible e where i.id=e.item_id returning i.id
   ), attempts as (
    update pulse_item_attempts a set classification=${serialized}::jsonb,classifier_method=${result.method},classifier_version=${result.version}
    from eligible e where a.id=e.attempt_id and e.item_id in(select id from items) returning a.id
   ), metrics as (
    update pulse_metrics m set classification_status=${result.classificationStatus},classifier_method=${result.method},classifier_version=${result.version},
     brand_mentioned=${result.brandMentioned},sentiment=${result.sentiment},mention_position=${result.mentionPosition},competitors_mentioned=${result.competitorsMentioned}::text[],matched_text=${JSON.stringify(result.matchedText)}::jsonb
    from eligible e where m.id=e.metric_id and e.item_id in(select id from items) and e.attempt_id in(select id from attempts) returning m.id
   ) update pulse_legacy_classification_attempts j set status=${result.classificationStatus==='legacy_unknown'?'failed':result.classificationStatus},analysis=${serialized}::jsonb,
    usage=${result.providerUsage?JSON.stringify(result.providerUsage):null}::jsonb,finished_at=now()
    from eligible e where j.id=e.journal_id and e.metric_id in(select id from metrics) returning j.id`
  ])
  if(committed[0]&&result.classificationStatus==='classified')classified++;else failed++
 }
 // Completion and its projection are independently replayable. A summary
 // incident must not require another classification or collection request.
 await finalizeSavedRun(scope,input.runId)
 return{classified,unchanged,failed}
}

async function finalizeSavedRun(scope:PulseScope,runId:string,requireComplete=false){
 const sql=db()
 const [run]=await sql`select scan_week,purpose from pulse_runs where id=${runId}::uuid and account_id=${scope.accountId} and client_id=${scope.clientId}::uuid`
 if(!run)throw new Error('LEGACY_REPAIR_NOT_FOUND')
 const coverage=await readRunCoverage(scope,runId)
 if(requireComplete&&coverage.status!=='completed')throw new Error('INVALID_LEGACY_REPAIR')
 if(run.purpose==='canonical')await computeWeeklySummary(sql,{clientId:scope.clientId,scanWeek:isoDate(run.scan_week as string|Date,'')})
}
