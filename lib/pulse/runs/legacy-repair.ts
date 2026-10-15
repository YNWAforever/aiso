import 'server-only'
import {createHash,randomUUID} from 'node:crypto'
import {db} from '@/lib/db'
import {analyseAnswer} from '@/lib/pulse/analysis'
import {ANALYSIS_VERSION,naiveAnalysis,type AnswerAnalysisV2} from '@/lib/pulse/analysis-fallback'
import type {PulseScope} from './schema'
import {repairSavedRunClassifications} from './saved-repair'
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
/** Classification-only repair. The journal records current repair context, never invented historical collection metadata. */
export async function repairLegacyClassifications(scope:PulseScope,input:{observationIds:string[];intentKey:string;deadlineAt:number;runId?:string},classifier:typeof analyseAnswer=analyseAnswer):Promise<{classified:number;unchanged:number;failed:number}>{
 if(input.runId!==undefined)return repairSavedRunClassifications(scope,{...input,runId:input.runId},classifier)
 if(!input.observationIds.length||input.observationIds.length>50||new Set(input.observationIds).size!==input.observationIds.length||input.observationIds.some(id=>!uuid.test(id))||!/^[a-zA-Z0-9:_-]{8,128}$/.test(input.intentKey)||input.deadlineAt<=Date.now()||input.deadlineAt>Date.now()+120000)throw new Error('INVALID_LEGACY_REPAIR')
 const sql=db()
 const rows=await sql`select m.id,m.raw_answer,m.classification_status,c.brand_name,c.competitors from pulse_metrics m join clients c on c.id=m.client_id where c.id=${scope.clientId}::uuid and c.account_id=${scope.accountId} and m.id=any(${input.observationIds}::uuid[]) and m.run_item_id is null`
 if(rows.length!==input.observationIds.length)throw new Error('LEGACY_REPAIR_NOT_FOUND')
 if(classifier===analyseAnswer&&!process.env.OPENROUTER_API_KEY)throw new Error('PROVIDER_NOT_CONFIGURED')
 let classified=0,failed=0,unchanged=0
 for(const row of rows){
  if(row.classification_status==='classified'||typeof row.raw_answer!=='string'||!row.raw_answer.trim()){unchanged++;continue}
  if(Date.now()+16000>=input.deadlineAt){failed++;continue}
  const token=randomUUID(),answer=row.raw_answer,answerHash=createHash('sha256').update(answer).digest('hex'),context={name:String(row.brand_name),competitors:row.competitors??[],basis:'current-repair-context',schemaVersion:'2026-10-11.v1'}
  const [,claimed]=await sql.transaction([
   sql`select id from clients where id=${scope.clientId}::uuid and account_id=${scope.accountId} for no key update`,
   sql`insert into pulse_legacy_classification_attempts(account_id,client_id,observation_id,intent_key,answer_hash,context,lease_token,lease_until)
    select ${scope.accountId},${scope.clientId}::uuid,m.id,${input.intentKey},${answerHash},${JSON.stringify(context)}::jsonb,${token}::uuid,${new Date(input.deadlineAt).toISOString()}::timestamptz
    from pulse_metrics m join clients c on c.id=m.client_id where m.id=${row.id}::uuid and c.id=${scope.clientId}::uuid and c.account_id=${scope.accountId} and m.run_item_id is null and m.raw_answer=${answer} and m.classification_status<>'classified'
     and not exists(select 1 from pulse_legacy_classification_attempts a where a.account_id=${scope.accountId} and a.observation_id=m.id and a.status='started' and a.lease_until>now())
     and (select count(*) from pulse_legacy_classification_attempts a where a.account_id=${scope.accountId} and a.observation_id=m.id)<3
    on conflict(account_id,observation_id,intent_key) do nothing returning id`
  ])
  if(!claimed[0]){unchanged++;continue}
  let result:AnswerAnalysisV2,timer:ReturnType<typeof setTimeout>|undefined
  try{result=await Promise.race([classifier({answer,brandName:context.name,competitors:context.competitors as string[]}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Classifier deadline')),15000)})])}catch{result={...naiveAnalysis(answer,context.name),classificationStatus:'failed',method:'legacy-repair-exception',version:ANALYSIS_VERSION}}finally{clearTimeout(timer)}
  const [,committed]=await sql.transaction([
   sql`select id from clients where id=${scope.clientId}::uuid and account_id=${scope.accountId} for no key update`,
   sql`with projected as (update pulse_metrics m set classification_status=${result.classificationStatus},classifier_method=${result.method},classifier_version=${result.version},brand_mentioned=${result.brandMentioned},sentiment=${result.sentiment},mention_position=${result.mentionPosition},competitors_mentioned=${result.competitorsMentioned}::text[],matched_text=${JSON.stringify(result.matchedText)}::jsonb
    from pulse_legacy_classification_attempts a join clients c on c.id=a.client_id and c.account_id=a.account_id where a.id=${claimed[0].id}::uuid and a.account_id=${scope.accountId} and a.client_id=${scope.clientId}::uuid and a.lease_token=${token}::uuid and a.status='started' and a.lease_until>now() and m.id=a.observation_id and m.client_id=c.id and m.run_item_id is null and m.raw_answer=${answer} and m.classification_status<>'classified' returning m.id), journal as (
    update pulse_legacy_classification_attempts set status=${result.classificationStatus==='legacy_unknown'?'failed':result.classificationStatus},analysis=${JSON.stringify(result)}::jsonb,usage=${result.providerUsage?JSON.stringify(result.providerUsage):null}::jsonb,finished_at=now() where id=${claimed[0].id}::uuid and account_id=${scope.accountId} and client_id=${scope.clientId}::uuid and lease_token=${token}::uuid and exists(select 1 from projected) returning id) select id from journal`
  ])
  if(committed[0]&&result.classificationStatus==='classified')classified++;else failed++
 }
 return {classified,unchanged,failed}
}
