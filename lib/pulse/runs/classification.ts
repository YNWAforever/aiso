import 'server-only'
import {randomUUID} from 'node:crypto'
import {db} from '@/lib/db'
import {analyseAnswer,type AnswerAnalysisV2} from '@/lib/pulse/analysis'
import {ANALYSIS_VERSION,naiveAnalysis} from '@/lib/pulse/analysis-fallback'
import type {PulseScope} from './schema'

export type ClassificationLease=PulseScope & {id:string;runId:string;attemptId:string;token:string;fence:number;
  classificationAttemptId:string;answer:string;brandName:string;competitors:string[]}
export async function claimClassifications(scope:PulseScope,runId:string,deadlineAt:number):Promise<ClassificationLease[]>{
  if(!Number.isFinite(deadlineAt)||deadlineAt<=Date.now()||deadlineAt>Date.now()+120_000)throw new Error('Invalid classification deadline')
  const sql=db(),token=randomUUID()
  const [,rows]=await sql.transaction([
    sql`select id from pulse_runs where id=${runId}::uuid and account_id=${scope.accountId} and client_id=${scope.clientId}::uuid for no key update`,
    sql`with expired as (
      update pulse_classification_attempts a set status='interrupted',finished_at=now()
      from pulse_run_items i where i.run_id=${runId}::uuid and i.account_id=${scope.accountId} and i.client_id=${scope.clientId}::uuid
        and a.item_id=i.id and a.status='started' and i.classification_lease_until<now() returning a.id
    ), terminal as (
      update pulse_run_items set classification_status='failed',classification_lease_token=null,classification_lease_until=null,updated_at=now()
      where run_id=${runId}::uuid and account_id=${scope.accountId} and client_id=${scope.clientId}::uuid
        and classification_attempt_count>=3 and classification_lease_until<now() returning id
    ), candidates as (
      select i.id from pulse_run_items i where i.run_id=${runId}::uuid and i.account_id=${scope.accountId} and i.client_id=${scope.clientId}::uuid
        and i.status='succeeded' and i.classification_status<>'classified' and i.classification_attempt_count<3
        and i.classification_next_at<=now() and (i.classification_lease_until is null or i.classification_lease_until<now())
      order by i.id limit 5 for update skip locked
    ), leased as (
      update pulse_run_items i set classification_attempt_count=classification_attempt_count+1,classification_fence=classification_fence+1,
        classification_lease_token=${token}::uuid,classification_lease_until=${new Date(deadlineAt).toISOString()}::timestamptz,updated_at=now()
      where i.id in(select id from candidates) returning i.*
    ), started as (
      insert into pulse_classification_attempts(item_id,provider_attempt_id,account_id,client_id,attempt_number,lease_token,fence)
      select id,accepted_attempt_id,account_id,client_id,classification_attempt_count,classification_lease_token,classification_fence from leased
      returning id,item_id
    ) select i.id,i.accepted_attempt_id,i.classification_fence,s.id as classification_attempt_id,a.raw_answer,
      r.manifest->'brand' as brand from leased i join started s on s.item_id=i.id
      join pulse_item_attempts a on a.id=i.accepted_attempt_id join pulse_runs r on r.id=i.run_id`,
  ])
  return rows.map(row=>({...scope,id:String(row.id),runId,attemptId:String(row.accepted_attempt_id),token,
    fence:Number(row.classification_fence),classificationAttemptId:String(row.classification_attempt_id),answer:String(row.raw_answer),
    brandName:(row.brand as {name:string}).name,competitors:(row.brand as {competitors:string[]}).competitors}))
}
export async function commitClassification(item:ClassificationLease,result:AnswerAnalysisV2):Promise<boolean>{
  const sql=db(),serialized=JSON.stringify(result)
  const [,rows]=await sql.transaction([
    sql`select id from pulse_run_items where id=${item.id}::uuid and account_id=${item.accountId} and client_id=${item.clientId}::uuid for update`,
    sql`with accepted as (
      update pulse_run_items set classification_status=${result.classificationStatus},classification_lease_token=null,classification_lease_until=null,
        classification_next_at=now()+case classification_attempt_count when 1 then interval '60 seconds' when 2 then interval '300 seconds' else interval '1800 seconds' end,updated_at=now()
      where id=${item.id}::uuid and account_id=${item.accountId} and client_id=${item.clientId}::uuid and status='succeeded'
        and accepted_attempt_id=${item.attemptId}::uuid and classification_status<>'classified'
        and classification_lease_token=${item.token}::uuid and classification_fence=${item.fence} and classification_lease_until>now() returning id
    ), history as (
      update pulse_classification_attempts set status=${result.classificationStatus},analysis=${serialized}::jsonb,finished_at=now()
      where id=${item.classificationAttemptId}::uuid and item_id in(select id from accepted)
        and account_id=${item.accountId} and client_id=${item.clientId}::uuid and status='started' returning id
    ), observation as (
      update pulse_item_attempts set classification=${serialized}::jsonb,classifier_method=${result.method},classifier_version=${result.version}
      where id=${item.attemptId}::uuid and item_id in(select id from accepted) and account_id=${item.accountId} and client_id=${item.clientId}::uuid returning id
    ), projection as (
      update pulse_metrics set classification_status=${result.classificationStatus},classifier_method=${result.method},classifier_version=${result.version},
        matched_text=${JSON.stringify(result.matchedText)}::jsonb,brand_mentioned=${result.brandMentioned},sentiment=${result.sentiment},
        mention_position=${result.mentionPosition},competitors_mentioned=${result.competitorsMentioned}::text[]
      where run_item_id in(select id from accepted) and client_id=${item.clientId}::uuid returning id
    ) select id from accepted`,
  ])
  return rows.length===1
}

export async function classifySavedAnswers(scope:PulseScope,runId:string,deadlineAt:number,classifier:typeof analyseAnswer=analyseAnswer){
  if(Date.now()+16_000>=deadlineAt||(!process.env.OPENROUTER_API_KEY&&classifier===analyseAnswer))return 0
  const items=await claimClassifications(scope,runId,deadlineAt)
  const results=await Promise.allSettled(items.map(async item=>{
    let result:AnswerAnalysisV2
    let timer:ReturnType<typeof setTimeout>|undefined
    try{
      result=await Promise.race([classifier({answer:item.answer,brandName:item.brandName,competitors:item.competitors}),
        new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Classifier deadline')),Math.min(15_000,Math.max(1,deadlineAt-Date.now()-2_000)))})])
    }catch{result={...naiveAnalysis(item.answer,item.brandName,item.competitors),classificationStatus:'failed',method:'classifier-exception',version:ANALYSIS_VERSION}}
    finally{clearTimeout(timer)}
    return commitClassification(item,result)
  }))
  return results.filter(r=>r.status==='fulfilled'&&r.value).length
}
