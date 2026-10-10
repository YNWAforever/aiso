import {beforeAll,describe,it,expect,vi} from 'vitest'
import {neon} from '@neondatabase/serverless'
import {randomUUID} from 'node:crypto'
import {claimDueItems,commitAttempt,createOrResumeRun,readRunCoverage,recordClassification} from '@/lib/pulse/runs/store'
import {processLeasedItem} from '@/lib/pulse/runs/service'
import {modelVariantsFor,PLATFORM_KEYS} from '@/lib/openrouter'
import {attachManifestCoverage} from '@/lib/pulse/runs/read-coverage'
import {db} from '@/lib/db'
import {consumeDuePulseWork,pulseWorkerPorts} from '@/lib/pulse/runs/worker'
import {readWeeklyEnqueue,saveWeeklyEnqueue} from '@/lib/pulse/runs/dispatch'
import {startCronRun} from '@/lib/cron/recordRun'
import {createNeonAlertStore} from '@/lib/alerts/neon-store'
import {runAlertEvaluation} from '@/lib/alerts/evaluate'
import {computeWeeklySummary} from '@/lib/pulse/summary'
import {currentScanWeek} from '@/lib/pulse/schedule'
import {claimClassifications,commitClassification,classifySavedAnswers} from '@/lib/pulse/runs/classification'
import {naiveAnalysis,coerceAnalysis} from '@/lib/pulse/analysis-fallback'
import {loadObservationDetail} from '@/lib/observations/store'
import {projectPulseOpportunityInput} from '@/lib/opportunities/store'
import {deriveSuggestions} from '@/lib/opportunities/rules'
import {buildInitialDraftSnapshot} from '@/lib/work-items/snapshot'
import {createDraftIfEvidenceCurrent} from '@/lib/work-items/store'
import type {ProviderEvidence,PulseScope} from '@/lib/pulse/runs/schema'
import {loadMaintenanceSnapshot} from '@/lib/workspace/maintenance'
import {loadRunTroubleshooting} from '@/lib/observations/run-troubleshooting'
vi.mock('server-only',()=>({}))
const external=vi.hoisted(()=>({classify:vi.fn<typeof import('@/lib/pulse/analysis').analyseAnswer>(async()=>{throw new Error('Synthetic classifier outage')}),fanout:vi.fn()}))
vi.mock('@/lib/pulse/analysis',()=>({analyseAnswer:external.classify}))
vi.mock('@/lib/openrouter',async original=>({...await original<typeof import('@/lib/openrouter')>(),callMultiPlatform:external.fanout}))
import {POST} from '@/app/api/pulse/run/route'
const sql=neon(process.env.TEST_DATABASE_URL!)
beforeAll(async()=>{
  const [identity]=await sql`select current_setting('neon.project_id') as project,current_setting('neon.branch_id') as branch,current_user as role`
  expect(identity.project).toBe(process.env.EXPECTED_NEON_PROJECT_ID)
  vi.stubEnv('DATABASE_URL',process.env.TEST_DATABASE_URL!)
  vi.stubEnv('EXPECTED_NEON_BRANCH_ID',identity.branch)
  vi.stubEnv('EXPECTED_DB_ROLE',identity.role)
})
const evidence:ProviderEvidence={answer:'Synthetic original answer',actualModel:'synthetic/served-variant',requestId:'synthetic-1',promptTokens:10,completionTokens:5,costUsd:null,httpStatus:200}
const manifest=modelVariantsFor(PLATFORM_KEYS)
async function fixture(test:(scope:PulseScope)=>Promise<void>,promptCount=3){
  const accountId=randomUUID()
  await sql`insert into accounts(id,plan,status) values(${accountId},'basic','active')`
  const [client]=await sql`insert into clients(account_id,brand_name) values(${accountId},'Synthetic Brand') returning id`
  const scope={accountId,clientId:client.id as string}
  await sql`insert into prompt_bank(client_id,question,language) select ${scope.clientId},'Synthetic question ' || n,'zh-HK' from generate_series(1,${promptCount}) n`
  try{await test(scope)}finally{
    await sql`delete from pulse_weekly_summary where client_id=${scope.clientId}`
    await sql`delete from pulse_metrics where client_id=${scope.clientId}`
    await sql`update pulse_run_items set accepted_attempt_id=null where account_id=${accountId}`
    await sql`delete from pulse_classification_attempts where account_id=${accountId}`
    await sql`delete from pulse_item_attempts where account_id=${accountId}`
    await sql`delete from pulse_run_items where account_id=${accountId}`
    await sql`delete from pulse_runs where account_id=${accountId}`
    await sql`delete from clients where account_id=${accountId}`
    await sql`delete from accounts where id=${accountId}`
  }
}
const runFor=(scope:PulseScope)=>createOrResumeRun(scope,{scanWeek:'2026-09-28',manifest})
const claim=(scope:PulseScope,runId:string,limit=5)=>claimDueItems(scope,runId,{owner:'synthetic-worker',leaseUntil:new Date(Date.now()+60_000),limit})
describe('T05 guarded Neon run ledger',()=>{
  it('preserves provider citations through accepted attempt and tenant-scoped detail',async()=>fixture(async scope=>{
    const run=(await runFor(scope))!
    const [lease]=await claim(scope,run.id,1)
    const providerCitations=[{url:'https://source.example/report',title:'Synthetic source'}]
    expect(await commitAttempt(lease,{kind:'succeeded',evidence:{...evidence,providerCitations,providerFinishReason:'stop'}})).toBe('committed')
    const [attempt]=await sql`select provider_citations,provider_finish_reason from pulse_item_attempts where account_id=${scope.accountId} and id=${lease.attemptId}`
    expect(attempt).toEqual({provider_citations:providerCitations,provider_finish_reason:'stop'})
    const [metric]=await sql`select id from pulse_metrics where run_item_id=${lease.id} and client_id=${scope.clientId}`
    expect(await loadObservationDetail(scope.accountId,scope.clientId,metric.id)).toMatchObject({
      links:[{...providerCitations[0],kind:'provider-citation'}],providerFinishReason:'stop',
    })
    expect(await loadObservationDetail(randomUUID(),scope.clientId,metric.id)).toBeNull()
  },1))
  it('T15 reads partial coverage and scoped failed items without mutating run evidence',async()=>fixture(async scope=>{
    const run=(await runFor(scope))!
    const leased=await claim(scope,run.id,15)
    expect(leased).toHaveLength(15)
    for(const [index,item]of leased.entries())await commitAttempt(item,index<13?{kind:'succeeded',evidence}:{kind:'failed',errorCode:'synthetic-failure'})
    for(let retry=0;retry<2;retry++){
      await sql`update pulse_run_items set next_attempt_at=now()-interval '1 second' where account_id=${scope.accountId} and run_id=${run.id} and status='retry_wait'`
      for(const item of await claim(scope,run.id,2))await commitAttempt(item,{kind:'failed',errorCode:'synthetic-failure'})
    }
    const before=await sql`select status,updated_at from pulse_runs where account_id=${scope.accountId} and id=${run.id}`
    const daily=await loadMaintenanceSnapshot(scope.accountId,scope.clientId,true)
    expect(daily).toMatchObject({runRead:'ok',latestRun:{expected:15,succeeded:13,failed:2,pending:0,classified:0},lastCompleteAt:null})
    const failed=await loadRunTroubleshooting(scope.accountId,scope.clientId,run.id,'failed')
    expect(failed).toMatchObject({expected:15,total:2,succeeded:13,failed:2})
    expect(failed?.items).toHaveLength(2)
    expect(failed?.items.every(item=>item.status==='failed'&&item.attempts===3)).toBe(true)
    expect(await loadRunTroubleshooting(randomUUID(),scope.clientId,run.id,'all')).toBeNull()
    expect(await loadRunTroubleshooting(scope.accountId,scope.clientId,run.id,'pending')).toMatchObject({total:0,items:[]})
    expect(await loadRunTroubleshooting(scope.accountId,scope.clientId,run.id,'unclassified')).toMatchObject({total:13})
    expect((await loadMaintenanceSnapshot(randomUUID(),scope.clientId,true)).latestRun).toBeNull()
    expect(await sql`select status,updated_at from pulse_runs where account_id=${scope.accountId} and id=${run.id}`).toEqual(before)
  }))
  it('T11 context changes apply to new runs while original manifests remain frozen',async()=>fixture(async scope=>{
    await sql`update prompt_bank set language='zh-HK',market='HK' where client_id=${scope.clientId}`
    const original=(await createOrResumeRun(scope,{scanWeek:'2026-09-14',manifest:[manifest[0]]}))!
    await sql`update prompt_bank set language='en',market='US' where client_id=${scope.clientId}`
    const resumed=(await createOrResumeRun(scope,{scanWeek:'2026-09-14',manifest:[manifest[0]]}))!
    const next=(await createOrResumeRun(scope,{scanWeek:'2026-09-21',manifest:[manifest[0]]}))!
    expect(resumed.manifest).toEqual(original.manifest)
    const rows=await sql`select run_id,snapshot from pulse_run_items where account_id=${scope.accountId} order by run_id`
    expect(rows.find(r=>r.run_id===original.id)?.snapshot).toMatchObject({language:'zh-HK',market:'HK'})
    expect(rows.find(r=>r.run_id===next.id)?.snapshot).toMatchObject({language:'en',market:'US'})
  },1))
  it('T09 a classification downgrade cannot be bypassed by a previously loaded suggestion',async()=>fixture(async scope=>{
    const [row]=await sql`insert into pulse_metrics(client_id,question,platform,scan_week,raw_answer,brand_mentioned,sentiment,classification_status)
      values(${scope.clientId},'Frozen question','synthetic','2026-09-21','Frozen answer',false,'unknown','classified')
      returning id,client_id,prompt_id,question,platform,scan_week::text,
        to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at,
        raw_answer,brand_mentioned,classification_status,true as has_answer`
    const projected=projectPulseOpportunityInput(scope.accountId,row as Parameters<typeof projectPulseOpportunityInput>[1])
    const suggestion=deriveSuggestions(projected.source)[0]
    await sql`update pulse_metrics set classification_status='fallback' where id=${row.id}`
    const save=()=>createDraftIfEvidenceCurrent(scope.accountId,scope.clientId,null,
      {source:suggestion.source,ruleVersion:suggestion.ruleVersion,fingerprint:suggestion.fingerprint,locale:'en'},
      buildInitialDraftSnapshot(suggestion,projected.source,'en'),projected.version)
    try{
      expect(await save()).toBeNull()
      expect(await sql`select id from evidence_work_items where account_id=${scope.accountId}`).toEqual([])
      await sql`update pulse_metrics set classification_status='classified' where id=${row.id}`
      expect(await save()).toMatchObject({created:true})
    }finally{
      await sql`delete from work_item_sources where account_id=${scope.accountId}`
      await sql`delete from evidence_work_items where account_id=${scope.accountId}`
    }
  },1))
  it('T09 original answer, model and question snapshots survive edits across two weeks',async()=>fixture(async scope=>{
    for(const week of ['2026-09-14','2026-09-21']){
      const run=(await createOrResumeRun(scope,{scanWeek:week,manifest:[manifest[0]]}))!
      const item=(await claim(scope,run.id,1))[0]
      await commitAttempt(item,{kind:'succeeded',evidence:{...evidence,answer:`Frozen answer ${week} https://example.com/claim`,actualModel:`synthetic/served-${week}`}})
    }
    await sql`update prompt_bank set question='Edited today',language='en' where client_id=${scope.clientId}`
    await sql`update clients set brand_name='Edited brand' where id=${scope.clientId}`
    await sql`delete from prompt_bank where client_id=${scope.clientId}`
    const rows=await sql`select id,scan_week::text as week from pulse_metrics where client_id=${scope.clientId} order by scan_week`
    for(const row of rows){
      const detail=await loadObservationDetail(scope.accountId,scope.clientId,String(row.id))
      expect(detail).toMatchObject({model:`synthetic/served-${row.week}`,requestedModel:manifest[0].model,collector:'openrouter_api',
        rawAnswer:`Frozen answer ${row.week} https://example.com/claim`,promptSnapshot:{question:'Synthetic question 1',language:'zh-HK',market:null},
        brandSnapshot:{name:'Synthetic Brand'},links:[{url:'https://example.com/claim',kind:'text-link'}],classification:{status:'legacy_unknown'}})
      expect(await loadObservationDetail(randomUUID(),scope.clientId,String(row.id))).toBeNull()
    }
    expect(rows).toHaveLength(2)
  },1))
  it('T08 retries classification using the saved answer without collecting it again',async()=>fixture(async scope=>{
    const run=(await createOrResumeRun(scope,{scanWeek:'2026-09-21',manifest:[manifest[0]]}))!
    const collect=vi.fn(async()=>({...evidence,answer:'Synthetic Brand is terrible.'}))
    await processLeasedItem((await claim(scope,run.id,1))[0],Date.now()+45_000,collect)
    const classifier=vi.fn<typeof import('@/lib/pulse/analysis').analyseAnswer>()
      .mockRejectedValueOnce(new Error('Synthetic analysis outage'))
      .mockImplementation(async input=>coerceAnalysis({brand_mentioned:true,sentiment:'negative',competitors_mentioned:[]},input.answer,input.brandName)!)
    expect(await classifySavedAnswers(scope,run.id,Date.now()+45_000,classifier)).toBe(1)
    expect(await classifySavedAnswers(scope,run.id,Date.now()+45_000,classifier)).toBe(0)
    await sql`update pulse_run_items set classification_next_at=now()-interval '1 second' where run_id=${run.id}`
    expect(await classifySavedAnswers(scope,run.id,Date.now()+45_000,classifier)).toBe(1)
    expect(collect).toHaveBeenCalledTimes(1);expect(classifier).toHaveBeenCalledTimes(2)
    expect(await readRunCoverage(scope,run.id)).toMatchObject({expected:1,succeeded:1,classified:1,mentioned:1})
    const [state]=await sql`select attempt_count,classification_attempt_count from pulse_run_items where run_id=${run.id}`
    expect(state).toMatchObject({attempt_count:1,classification_attempt_count:2})
    const histories=await sql`select status from pulse_classification_attempts where account_id=${scope.accountId} order by attempt_number`
    expect(histories.map(r=>r.status)).toEqual(['failed','classified'])
    await computeWeeklySummary(db(),{clientId:scope.clientId,scanWeek:run.scanWeek})
    const [summary]=await sql`select total_queries,brand_mentions,sov_score::float,avg_sentiment_score::float from pulse_weekly_summary where client_id=${scope.clientId} and platform is null`
    expect(summary).toMatchObject({total_queries:1,brand_mentions:1,sov_score:100,avg_sentiment_score:-1})
  },1))
  it('T08 fallback/legacy evidence stays outside classified and sentiment denominators',async()=>fixture(async scope=>{
    const run=(await createOrResumeRun(scope,{scanWeek:'2026-09-21',manifest:[manifest[0]]}))!
    const item=(await claim(scope,run.id,1))[0]
    await commitAttempt(item,{kind:'succeeded',evidence:{...evidence,answer:'Synthetic Brand is terrible.'}})
    const classifier=vi.fn<typeof import('@/lib/pulse/analysis').analyseAnswer>(async input=>naiveAnalysis(input.answer,input.brandName))
    for(let n=0;n<3;n++){
      expect(await classifySavedAnswers(scope,run.id,Date.now()+45_000,classifier)).toBe(1)
      await sql`update pulse_run_items set classification_next_at=now()-interval '1 second' where run_id=${run.id}`
    }
    expect(await classifySavedAnswers(scope,run.id,Date.now()+45_000,classifier)).toBe(0)
    expect(classifier).toHaveBeenCalledTimes(3)
    await sql`insert into pulse_metrics(client_id,question,raw_answer,scan_week,platform,brand_mentioned,sentiment)
      values(${scope.clientId},'Historical legacy question','Legacy positive substring','2026-09-21','legacy',true,'positive')`
    await computeWeeklySummary(db(),{clientId:scope.clientId,scanWeek:run.scanWeek})
    const [summary]=await sql`select total_queries,brand_mentions,sov_score,avg_sentiment_score from pulse_weekly_summary where client_id=${scope.clientId} and platform is null`
    expect(summary).toMatchObject({total_queries:2,brand_mentions:0,sov_score:null,avg_sentiment_score:null})
    expect(await readRunCoverage(scope,run.id)).toMatchObject({succeeded:1,classified:0,mentionRate:null})
  },1))
  it('T08 concurrent and stale classifiers cannot overwrite a fenced result or tenant',async()=>fixture(async scope=>{
    const run=(await createOrResumeRun(scope,{scanWeek:'2026-09-21',manifest:[manifest[0]]}))!
    await commitAttempt((await claim(scope,run.id,1))[0],{kind:'succeeded',evidence:{...evidence,answer:'Synthetic Brand is terrible.'}})
    const leases=await Promise.all([claimClassifications(scope,run.id,Date.now()+45_000),claimClassifications(scope,run.id,Date.now()+45_000)])
    expect(leases.flat()).toHaveLength(1)
    const old=leases.flat()[0]
    expect(await claimClassifications({...scope,accountId:randomUUID()},run.id,Date.now()+45_000)).toEqual([])
    await sql`update pulse_run_items set classification_lease_until=now()-interval '1 second' where id=${old.id}`
    const fresh=(await claimClassifications(scope,run.id,Date.now()+45_000))[0]
    const result=coerceAnalysis({brand_mentioned:true,sentiment:'negative',competitors_mentioned:[]},fresh.answer,fresh.brandName)!
    expect(await commitClassification({...fresh,accountId:randomUUID()},result)).toBe(false)
    expect(await commitClassification(old,result)).toBe(false)
    expect(await commitClassification(fresh,result)).toBe(true)
    expect(await commitClassification(fresh,naiveAnalysis(fresh.answer,fresh.brandName))).toBe(false)
    const histories=await sql`select status from pulse_classification_attempts where account_id=${scope.accountId} order by attempt_number`
    expect(histories.map(r=>r.status)).toEqual(['interrupted','classified'])
    const [raw]=await sql`select raw_answer,attempt_count from pulse_run_items i join pulse_item_attempts a on a.id=i.accepted_attempt_id where i.id=${fresh.id}`
    expect(raw).toMatchObject({raw_answer:'Synthetic Brand is terrible.',attempt_count:1})
  },1))
  it('application role cannot delete ledger evidence or rewrite immutable inputs',async()=>{
    for(const table of ['pulse_runs','pulse_run_items','pulse_item_attempts','pulse_classification_attempts']){
      const [row]=await sql`select has_table_privilege('aeo_app',${'public.'+table},'DELETE') as can_delete,
        has_column_privilege('aeo_app',${'public.'+table},'account_id','UPDATE') as can_rebind`
      expect(row).toEqual({can_delete:false,can_rebind:false})
    }
    const [attempt]=await sql`select has_column_privilege('aeo_app','public.pulse_item_attempts','requested_model','UPDATE') as can_rewrite,
      has_column_privilege('aeo_app','public.pulse_item_attempts','collection_status','UPDATE') as can_finish`
    expect(attempt).toEqual({can_rewrite:false,can_finish:true})
  })
  it('T07 raw-only and partial rollups cannot create definite alerts',async()=>fixture(async scope=>{
    const run=(await createOrResumeRun(scope,{scanWeek:currentScanWeek(),manifest}))!
    const lease=(await claim(scope,run.id,1))[0]
    await commitAttempt(lease,{kind:'succeeded',evidence})
    await recordClassification(lease,{status:'classified',method:'synthetic-fixture',version:'fixture.v1',brandMentioned:false,sentiment:'neutral',mentionPosition:null,competitorsMentioned:[]})
    await computeWeeklySummary(db(),{clientId:scope.clientId,scanWeek:run.scanWeek})
    await sql`insert into alert_configs(client_id,enabled_sov) values(${scope.clientId},true)`
    vi.stubEnv('FEATURE_PULSE_ATTEMPTS','1')
    const notification=vi.fn(async()=>{}),email=vi.fn(async()=>{})
    try{
      const store=createNeonAlertStore(db())
      const snapshot=await store.loadSnapshot()
      expect(snapshot.weeksByClient[scope.clientId][0].coverageComplete).toBe(false)
      expect(await runAlertEvaluation({...store,upsertNotification:notification,sendAlertEmail:email})).toMatchObject({evaluated:0,incomplete:1,fired:0})
      expect(notification).not.toHaveBeenCalled();expect(email).not.toHaveBeenCalled()
    }finally{vi.stubEnv('FEATURE_PULSE_ATTEMPTS','0')}
  }))
  it('T07 lost self-call recovers on a new repair consumer in the original week',async()=>fixture(async scope=>{
    await sql`update accounts set plan='pro',stripe_subscription_id='sub_synthetic' where id=${scope.accountId}`
    const run=(await createOrResumeRun(scope,{scanWeek:'2026-09-21',manifest}))!
    const collect=vi.fn(async()=>evidence)
    const deadline=Date.now()+45_000
    let virtualNow=Date.now()
    const firstPorts={...pulseWorkerPorts(),now:()=>virtualNow,process:async(i:Parameters<typeof processLeasedItem>[0],end:number)=>{
      const result=await processLeasedItem(i,end,collect);virtualNow=deadline-6_000;return result
    }}
    const first=await consumeDuePulseWork({mode:'repair',owner:'lost-self-call',deadlineAt:deadline},firstPorts)
    expect(first).toMatchObject({outcome:'partial',processed:5,remaining:10,hasDue:true,runIds:[run.id]})
    const second=await consumeDuePulseWork({mode:'repair',owner:'next-daily-trigger',deadlineAt:Date.now()+45_000},
      {...pulseWorkerPorts(),process:(i,end)=>processLeasedItem(i,end,collect)})
    expect(second).toMatchObject({outcome:'partial',processed:10,remaining:0,unclassified:15,runIds:[run.id]})
    expect(collect).toHaveBeenCalledTimes(15)
    const [rows]=await sql`select count(*)::int as n,min(scan_week)::text as week from pulse_metrics where client_id=${scope.clientId}`
    expect(rows).toMatchObject({n:15,week:'2026-09-21'})
    await sql`delete from pulse_weekly_summary where client_id=${scope.clientId}`
  }))
  it('T07 backoff and maximum three attempts persist across consumers',async()=>fixture(async scope=>{
    const run=(await createOrResumeRun(scope,{scanWeek:'2026-09-21',manifest:[manifest[0]]}))!
    for(let n=1;n<=3;n++){
      const lease=(await claim(scope,run.id,1))[0]
      expect(lease.attempt).toBe(n)
      await commitAttempt(lease,{kind:'failed',errorCode:'SYNTHETIC_TIMEOUT_OUTCOME_UNKNOWN'})
      const [state]=await sql`select status,attempt_count,extract(epoch from next_attempt_at-now())::int as backoff from pulse_run_items where id=${lease.id}`
      expect(state.status).toBe(n<3?'retry_wait':'failed')
      expect(Number(state.backoff)).toBeGreaterThan([0,55,295,1795][n])
      expect(await claim(scope,run.id,1)).toHaveLength(0)
      await sql`update pulse_run_items set next_attempt_at=now()-interval '1 second' where id=${lease.id}`
    }
    expect(await readRunCoverage(scope,run.id)).toMatchObject({expected:1,failed:1,pending:0,status:'failed'})
    expect(await claim(scope,run.id,1)).toHaveLength(0)
  },1))
  it('T07 dispatch checkpoint uses original weeks and fences an old overwrite',async()=>{
    const original={scanWeek:'2026-09-14',after:null,failedClientIds:[],complete:false}
    const newer={...original,scanWeek:'2026-09-21'}
    const oldId=await startCronRun('/api/cron/pulse',{mode:'weekly',enqueue:original})
    const newId=await startCronRun('/api/cron/pulse',{mode:'weekly',enqueue:newer})
    try{
      expect(await readWeeklyEnqueue()).toMatchObject({id:oldId,state:original})
      const completed={...original,complete:true}
      await saveWeeklyEnqueue(oldId!,original,completed)
      await saveWeeklyEnqueue(oldId!,original,{...original,failedClientIds:['stale-worker']})
      expect(await readWeeklyEnqueue()).toMatchObject({id:newId,state:newer})
      const [row]=await sql`select detail->'enqueue' as enqueue from cron_runs where id=${oldId}`
      expect(row.enqueue).toEqual(completed)
    }finally{await sql`delete from cron_runs where id in (${oldId},${newId})`}
  })
  it('compatibility writer preserves three old successes after an all-failed retry',async()=>fixture(async scope=>{
    vi.stubEnv('FEATURE_PULSE_ATTEMPTS','0')
    vi.stubEnv('CRON_SECRET','synthetic-cron-secret-1234')
    await sql`update accounts set stripe_subscription_id='sub_synthetic' where id=${scope.accountId}`
    external.classify.mockResolvedValue({classificationStatus:'classified',method:'synthetic-fixture',version:'fixture.v1',matchedText:[],brandMentioned:true,sentiment:'neutral',mentionPosition:0,competitorsMentioned:[]})
    external.fanout.mockResolvedValue([{platform:'gemini-flash',answer:'Synthetic preserved'}])
    const post=()=>POST(new Request('http://localhost/api/pulse/run',{method:'POST',headers:{'Content-Type':'application/json','x-cron-secret':'synthetic-cron-secret-1234'},body:JSON.stringify({clientId:scope.clientId})}) as never)
    try{
      expect((await post()).status).toBe(200)
      external.fanout.mockResolvedValue([])
      // An all-failed chunk is reported as a provider outage (#70), so the
      // driver stops instead of re-buying LLM calls; it still writes nothing.
      const retry=await post()
      expect(retry.status).toBe(502)
      expect(await retry.json()).toMatchObject({error:'NO_PROVIDER_RESPONSES'})
      const [counts]=await sql`select count(*)::int as n from pulse_metrics where client_id=${scope.clientId}`
      expect(counts.n).toBe(3)
    }finally{
      await sql`delete from pulse_weekly_summary where client_id=${scope.clientId}`
      external.classify.mockReset().mockRejectedValue(new Error('Synthetic classifier outage'))
    }
  }))
  it('two simultaneous creators share one immutable manifest with tenant-scoped coverage',async()=>fixture(async scope=>{
    const runs=await Promise.all([runFor(scope),runFor(scope)])
    expect(runs[0]?.id).toBe(runs[1]?.id)
    expect(await readRunCoverage(scope,runs[0]!.id)).toMatchObject({expected:15,pending:15})
    vi.stubEnv('FEATURE_PULSE_ATTEMPTS','1')
    const rows=await attachManifestCoverage(db(),scope.accountId,[scope.clientId],[])
    expect(rows.find(r=>r.platform===null)).toMatchObject({expected_items:15,pending_items:15})
    expect(await attachManifestCoverage(db(),randomUUID(),[scope.clientId],[])).toEqual([])
    vi.stubEnv('FEATURE_PULSE_ATTEMPTS','0')
  }))
  it('three_by_five_has_fifteen_items after first question entirely fails',async()=>fixture(async scope=>{
    const run=(await runFor(scope))!
    const first=await claim(scope,run.id)
    expect(first).toHaveLength(5)
    expect(new Set(first.map(i=>i.snapshot.question)).size).toBe(1)
    await Promise.all(first.map(i=>commitAttempt(i,{kind:'failed',errorCode:'SYNTHETIC_PROVIDER_FAILURE'})))
    const next=await claim(scope,run.id,10)
    expect(next).toHaveLength(10)
    await Promise.all(next.map(i=>commitAttempt(i,{kind:'succeeded',evidence})))
    expect(await readRunCoverage(scope,run.id)).toMatchObject({expected:15,succeeded:10,pending:5,classified:0,status:'partial',coverage:10/15})
    const [counts]=await sql`select count(*)::int as n from pulse_item_attempts where account_id=${scope.accountId}`
    expect(counts.n).toBe(15)
  }))
  it('two_workers_one_item_one_commit and rerun_keeps_success',async()=>fixture(async scope=>{
    const run=(await createOrResumeRun(scope,{scanWeek:'2026-09-28',manifest:[manifest[0]]}))!
    const claims=await Promise.all([claim(scope,run.id,1),claim(scope,run.id,1)])
    expect(claims.flat()).toHaveLength(1)
    const item=claims.flat()[0]
    expect((await Promise.all([commitAttempt(item,{kind:'succeeded',evidence}),commitAttempt(item,{kind:'succeeded',evidence:{...evidence,answer:'Overwrite forbidden'}})])).sort())
      .toEqual(['already-recorded','committed'])
    expect(await claim(scope,run.id,1)).toHaveLength(0)
    expect((await runFor(scope))?.id).toBe(run.id)
    const rows=await sql`select raw_answer from pulse_metrics where client_id=${scope.clientId}`
    expect(rows).toHaveLength(1)
    expect(['Synthetic original answer','Overwrite forbidden']).toContain(rows[0].raw_answer)
  },1))
  it('late_worker_cannot_overwrite_new_lease and interrupted cost is unknown',async()=>fixture(async scope=>{
    const run=(await runFor(scope))!,old=(await claim(scope,run.id,1))[0]
    await sql`update pulse_run_items set lease_until=now()-interval '1 second' where id=${old.id}`
    const replacement=(await claim(scope,run.id,1))[0]
    expect(replacement.id).toBe(old.id)
    expect(replacement.fence).toBe(old.fence+1)
    expect(await commitAttempt(old,{kind:'succeeded',evidence})).toBe('stale-lease')
    expect(await commitAttempt(replacement,{kind:'succeeded',evidence:{...evidence,answer:'Current lease answer'}})).toBe('committed')
    const [attempt]=await sql`select collection_status,cost_usd,error_code,accepted from pulse_item_attempts where id=${old.attemptId}`
    expect(attempt).toMatchObject({collection_status:'interrupted',cost_usd:null,error_code:'LEASE_EXPIRED_OUTCOME_UNKNOWN',accepted:false})
    const [metric]=await sql`select raw_answer from pulse_metrics where run_item_id=${old.id}`
    expect(metric.raw_answer).toBe('Current lease answer')
  }))
  it('manifest survives edited/deleted questions and repairs its original week',async()=>fixture(async scope=>{
    const run=(await runFor(scope))!
    await sql`update prompt_bank set question='Edited',language='en',is_active=false where client_id=${scope.clientId}`
    await sql`delete from prompt_bank where client_id=${scope.clientId}`
    await sql`update clients set brand_name='Edited brand' where id=${scope.clientId}`
    const reused=(await runFor(scope))!
    expect(reused.manifest).toEqual(run.manifest)
    const item=(await claim(scope,run.id,1))[0]
    expect(item.snapshot).toMatchObject({language:'zh-HK',market:null})
    expect(item.brand.name).toBe('Synthetic Brand')
    expect(item.scanWeek).toBe('2026-09-28')
    await commitAttempt(item,{kind:'succeeded',evidence})
    const [metric]=await sql`select prompt_id,scan_week::text as scan_week from pulse_metrics where run_item_id=${item.id}`
    expect(metric.prompt_id).toBeNull()
    expect(metric.scan_week).toBe('2026-09-28')
    expect(await createOrResumeRun({...scope,accountId:randomUUID()},{scanWeek:'2026-09-28',manifest})).toBeNull()
  }))
  it('classifier outage retains raw answer and does not classify it',async()=>fixture(async scope=>{
    const run=(await runFor(scope))!,item=(await claim(scope,run.id,1))[0]
    expect(await processLeasedItem(item,Date.now()+45_000,async()=>evidence)).toBe('committed')
    expect(await readRunCoverage(scope,run.id)).toMatchObject({succeeded:1,classified:0})
    const [attempt]=await sql`select raw_answer,classification,actual_model from pulse_item_attempts where id=${item.attemptId}`
    expect(attempt).toMatchObject({raw_answer:evidence.answer,classification:null,actual_model:evidence.actualModel})
  }))
  it('provider success followed by DB failure rolls back acceptance and remains recoverable',async()=>fixture(async scope=>{
    const run=(await runFor(scope))!,item=(await claim(scope,run.id,1))[0]
    await sql`create function t05_fail_projection() returns trigger language plpgsql as $$begin raise exception 'Synthetic projection failure'; end $$`
    await sql`create trigger t05_fail_projection before insert on pulse_metrics for each row execute function t05_fail_projection()`
    try{await expect(commitAttempt(item,{kind:'succeeded',evidence})).rejects.toThrow()}
    finally{await sql`drop trigger t05_fail_projection on pulse_metrics`;await sql`drop function t05_fail_projection()`}
    const [attempt]=await sql`select collection_status,accepted,raw_answer from pulse_item_attempts where id=${item.attemptId}`
    expect(attempt).toMatchObject({collection_status:'started',accepted:false,raw_answer:null})
    expect(await commitAttempt(item,{kind:'succeeded',evidence})).toBe('committed')
    expect(await readRunCoverage(scope,run.id)).toMatchObject({succeeded:1,pending:14})
  }))
})
