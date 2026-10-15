import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {PGlite} from '@electric-sql/pglite'
import {beforeAll,beforeEach,afterAll,afterEach,describe,it,expect,vi} from 'vitest'
const state=vi.hoisted(()=>({pg:null as PGlite|null,failSummaryWrites:0}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/db',()=>{
 const sql=(parts:TemplateStringsArray,...values:unknown[])=>{
  const text=parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,'')
  return{text,values,then:(onFulfilled:(rows:unknown[])=>unknown,onRejected:(e:unknown)=>unknown)=>state.pg!.transaction(async tx=>{
   await tx.exec('set local role aeo_app')
   if(state.failSummaryWrites&&/insert into pulse_weekly_summary/i.test(text)){state.failSummaryWrites--;throw new Error('Injected summary write failure')}
   return(await tx.query(text,values)).rows
  }).then(onFulfilled,onRejected)}
 }
 sql.transaction=(queries:{text:string;values:unknown[]}[])=>state.pg!.transaction(async tx=>{await tx.exec('set local role aeo_app');const rows=[];for(const q of queries)rows.push((await tx.query(q.text,q.values)).rows);return rows})
 return{db:()=>sql}
})
import {repairLegacyClassifications} from '@/lib/pulse/runs/legacy-repair'
import {db} from '@/lib/db'
import {claimClassifications} from '@/lib/pulse/runs/classification'
import {readUserPulseRun} from '@/lib/pulse/runs/user-dispatch'
import {attachManifestCoverage} from '@/lib/pulse/runs/read-coverage'
import {projectObservedSummary} from '@/lib/pulse/observed-summary'
import {ANALYSIS_VERSION,coerceAnalysis,naiveAnalysis} from '@/lib/pulse/analysis-fallback'
const account='10000000-0000-4000-8000-000000000001',client='20000000-0000-4000-8000-000000000001'
const run='30000000-0000-4000-8000-000000000001',item='40000000-0000-4000-8000-000000000001'
const attempt='50000000-0000-4000-8000-000000000001',observation='60000000-0000-4000-8000-000000000001'
const scope={accountId:account,clientId:client}
const week='2026-10-12',platforms=['claude-haiku','gemini-flash','gpt-4o','perplexity-sonar','perplexity-sonar-pro']
const idFor=(prefix:string,index:number)=>`${prefix}0000000-0000-4000-8000-${index.toString(16).padStart(12,'0')}`
const input=()=>({runId:run,observationIds:[observation],intentKey:'saved-repair-v4',deadlineAt:Date.now()+45000})
const classify=()=>vi.fn(async()=>coerceAnalysis({brand_mentioned:false,sentiment:'not_mentioned',competitors_mentioned:[]},'A retained answer with citations.','Frozen Brand')!)
// Real ledger migrations retain production column grants, counters, lease pairs and foreign keys.
beforeAll(async()=>{
 state.pg=await PGlite.create()
 await state.pg.exec(`
 create role aeo_app nologin;
 grant usage on schema public to aeo_app;
 create table accounts(id uuid primary key);
 create table clients(id uuid primary key,account_id uuid references accounts(id),brand_name text,competitors text[],unique(id,account_id));
 create table prompt_bank(id uuid primary key);
 create table pulse_metrics(id uuid primary key default gen_random_uuid(),client_id uuid references clients(id),
  prompt_id uuid constraint pulse_metrics_prompt_id_fkey references prompt_bank(id),raw_answer text,brand_mentioned boolean,
  sentiment text,mention_position int,competitors_mentioned text[],provider_citations jsonb,platform text,scan_week date,created_at timestamptz not null default now());
 create table pulse_weekly_summary(client_id uuid,scan_week date,platform text,total_queries int,brand_mentions int,sov_score numeric,avg_sentiment_score numeric,top_competitors jsonb,created_at timestamptz default now(),unique nulls not distinct(client_id,scan_week,platform));
 grant select,insert,update on accounts,clients,prompt_bank,pulse_metrics,pulse_weekly_summary to aeo_app;
 `)
 for(const migration of ['057_pulse_run_ledger.sql','058_pulse_classification_repair.sql','065_pulse_run_identity_and_repair.sql'])await state.pg.exec(readFileSync(resolve(process.cwd(),'supabase/migrations',migration),'utf8'))
 await state.pg.exec('alter table pulse_item_attempts add column provider_citations jsonb')
})
afterAll(async()=>{await state.pg?.close()})
async function seedRun(count=1){
 await state.pg!.exec('truncate accounts,clients,prompt_bank,pulse_runs,pulse_run_items,pulse_item_attempts,pulse_metrics,pulse_classification_attempts,pulse_legacy_classification_attempts,pulse_weekly_summary')
 await state.pg!.query('insert into accounts values($1)',[account])
 await state.pg!.query("insert into clients values($1,$2,'Changed Current Brand','{}')",[client,account])
 await state.pg!.query("insert into pulse_runs(id,account_id,client_id,manifest,scan_week,purpose,status) values($1,$2,$3,$4,$5,'canonical','partial')",[run,account,client,JSON.stringify({brand:{name:'Frozen Brand',competitors:['Frozen Competitor']},items:Array.from({length:count},(_,n)=>({id:idFor('4',n+1)}))}),week])
 for(let n=1;n<=count;n++){
  const ids={item:idFor('4',n),attempt:idFor('5',n),observation:idFor('6',n)}
  const classified=count===40&&n>8,status=classified?'classified':'fallback',version=classified?ANALYSIS_VERSION:'old-version'
  const answer=count===1?'A retained answer with citations.':n<=8?`Frozen Brand retained answer ${n}.`:`Other companies retained answer ${n}.`
  const analysis=classified?coerceAnalysis({brand_mentioned:false,sentiment:'not_mentioned',competitors_mentioned:[]},answer,'Frozen Brand'):naiveAnalysis(answer,'Frozen Brand')
  const citations=JSON.stringify([{url:`https://source.example/retained/${n}`}]),platform=platforms[(n-1)%platforms.length]
  await state.pg!.query(`insert into pulse_run_items(id,run_id,account_id,client_id,prompt_snapshot_id,snapshot,platform,model_id,status,attempt_count,classification_status,classification_attempt_count,classification_fence)
   values($1,$2,$3,$4,$5,$6,$7,$8,'succeeded',1,$9,$10::int,$10::int)`,[ids.item,run,account,client,idFor('7',n),JSON.stringify({question:`Frozen question ${n}`,language:'en',market:'HK'}),platform,`fixture/${platform}`,status,classified?1:3])
  await state.pg!.query(`insert into pulse_item_attempts(id,item_id,account_id,client_id,attempt_number,lease_token,fence,started_at,finished_at,collection_status,accepted,requested_model,actual_model,provider_request_id,raw_answer,prompt_tokens,completion_tokens,cost_usd,http_status,classification,classifier_method,classifier_version,provider_citations)
   values($1,$2,$3,$4,1,$5,1,'2026-10-14T00:00:00Z','2026-10-14T00:00:01Z','succeeded',true,$6,$6,$7,$8,20,30,0.001,200,$9,'literal-evidence-abstention',$10,$11)`,
   [ids.attempt,ids.item,account,client,idFor('8',n),`fixture/${platform}`,`original-provider-request-${n}`,answer,JSON.stringify(analysis),version,citations])
  await state.pg!.query('update pulse_run_items set accepted_attempt_id=$1 where id=$2',[ids.attempt,ids.item])
  await state.pg!.query(`insert into pulse_metrics(id,client_id,run_item_id,raw_answer,classification_status,classifier_version,brand_mentioned,sentiment,provider_citations,platform,scan_week,requested_model,actual_model,provider_request_id,collected_at,prompt_snapshot,brand_snapshot,provider_usage,source_schema_version)
   values($1,$2,$3,$4,$5,$6,$7,'unknown',$8,$9,$10,$11,$11,$12,'2026-10-14T00:00:01Z',$13,$14,$15,'fixture-original')`,
   [ids.observation,client,ids.item,answer,status,version,classified?false:null,citations,platform,week,`fixture/${platform}`,`original-provider-request-${n}`,JSON.stringify({question:`Frozen question ${n}`}),JSON.stringify({name:'Frozen Brand'}),JSON.stringify({promptTokens:20,completionTokens:30,costUsd:0.001})])
  await state.pg!.query(`insert into pulse_classification_attempts(item_id,provider_attempt_id,account_id,client_id,attempt_number,lease_token,fence,status,started_at,finished_at,analysis,usage)
   select $1,$2,$3,$4,n,$5,n,$6,'2026-10-14T00:00:02Z','2026-10-14T00:00:03Z',$7,$8 from generate_series(1,$9::int) n`,
   [ids.item,ids.attempt,account,client,idFor('9',n),status,JSON.stringify(analysis),JSON.stringify({requestId:`original-classifier-${n}`}),classified?1:3])
 }
}
beforeEach(async()=>{state.failSummaryWrites=0;await seedRun()})
afterEach(()=>vi.unstubAllEnvs())

async function collectionEvidence(){
 return{
  attempts:(await state.pg!.query(`select id,item_id,account_id,client_id,attempt_number,lease_token,fence,started_at,finished_at,collection_status,accepted,requested_model,actual_model,provider_request_id,collector,collector_version,raw_answer,prompt_tokens,completion_tokens,cost_usd,http_status,error_code,provider_citations from pulse_item_attempts order by id`)).rows,
  metrics:(await state.pg!.query(`select id,client_id,run_item_id,raw_answer,provider_citations,platform,scan_week,requested_model,actual_model,provider_request_id,collected_at,prompt_snapshot,brand_snapshot,provider_usage,source_schema_version from pulse_metrics order by id`)).rows,
  items:(await state.pg!.query('select id,run_id,prompt_snapshot_id,snapshot,platform,model_id,attempt_count,accepted_attempt_id,classification_attempt_count,classification_fence from pulse_run_items order by id')).rows,
  history:(await state.pg!.query('select * from pulse_classification_attempts order by item_id,attempt_number')).rows,
  runs:(await state.pg!.query('select id,account_id,client_id,manifest,scan_week,purpose from pulse_runs')).rows,
 }
}
describe('versioned repair of saved run answers',()=>{
 it('the real classifier repairs literal absence without provider network calls or changing collection receipts',async()=>{
  const before=await collectionEvidence(),network=vi.fn(async()=>{throw new Error('Provider must not run')})
  vi.stubEnv('OPENROUTER_API_KEY','offline-fixture-must-not-be-used');vi.stubGlobal('fetch',network)
  expect(await repairLegacyClassifications(scope,input())).toEqual({classified:1,unchanged:0,failed:0})
  expect(network).not.toHaveBeenCalled()
  expect((await state.pg!.query('select brand_mentioned,classification_status,classifier_method from pulse_metrics')).rows)
   .toEqual([{brand_mentioned:false,classification_status:'classified',classifier_method:'literal-absence'}])
  const journal=(await state.pg!.query<{analysis:Record<string,unknown>;usage:unknown}>('select analysis,usage from pulse_legacy_classification_attempts')).rows[0]!
  expect(journal.analysis).toMatchObject({version:ANALYSIS_VERSION,method:'literal-absence',brandMentioned:false,providerUsage:null})
  expect(journal.usage).toBeNull();expect(await collectionEvidence()).toEqual(before)
 })
 it('executes application SQL with the real column grants and ledger constraints',async()=>{
  expect(await db()`select current_user as role`).toEqual([{role:'aeo_app'}])
  await expect(db()`update pulse_runs set manifest='{}'::jsonb where id=${run}::uuid`).rejects.toThrow(/permission denied/)
  await expect(db()`update pulse_run_items set snapshot='{}'::jsonb where id=${item}::uuid`).rejects.toThrow(/permission denied/)
  await expect(state.pg!.query('update pulse_run_items set classification_attempt_count=4')).rejects.toThrow(/check constraint/)
  await expect(state.pg!.query('update pulse_run_items set classification_lease_until=now()')).rejects.toThrow(/classification_lease_pair/)
 })
 it('retains genuine abstention and permits no second charge for this classifier version',async()=>{
  const classifier=vi.fn(async()=>naiveAnalysis('A retained answer with citations.','Frozen Brand'))
  expect(await repairLegacyClassifications(scope,input(),classifier)).toEqual({classified:0,unchanged:0,failed:1})
  expect((await state.pg!.query('select brand_mentioned,classification_status from pulse_metrics')).rows).toEqual([{brand_mentioned:null,classification_status:'fallback'}])
  expect(await repairLegacyClassifications(scope,{...input(),intentKey:'different-intent-key'},classifier)).toEqual({classified:0,unchanged:1,failed:0})
  expect(classifier).toHaveBeenCalledTimes(1)
 })
 it('does not project a result from an unexpected classifier version',async()=>{
  const classifier=vi.fn(async()=>({...coerceAnalysis({brand_mentioned:false,sentiment:'unknown',competitors_mentioned:[]},'A retained answer with citations.','Frozen Brand')!,version:'stale-version'}))
  expect(await repairLegacyClassifications(scope,input(),classifier)).toEqual({classified:0,unchanged:0,failed:1})
  expect((await state.pg!.query('select classification_status,classifier_version from pulse_metrics')).rows).toEqual([{classification_status:'fallback',classifier_version:'old-version'}])
 })
 it('repairs exhausted classification using frozen context, preserving all collection evidence and old attempts',async()=>{
  const before=(await state.pg!.query('select raw_answer,provider_citations,provider_request_id from pulse_item_attempts')).rows
  const classifier=classify()
  expect(await repairLegacyClassifications(scope,input(),classifier)).toEqual({classified:1,unchanged:0,failed:0})
  expect(classifier).toHaveBeenCalledWith({answer:'A retained answer with citations.',brandName:'Frozen Brand',competitors:[{name:'Frozen Competitor',aliases:[]}]})
  expect((await state.pg!.query('select raw_answer,provider_citations,provider_request_id from pulse_item_attempts')).rows).toEqual(before)
  expect((await state.pg!.query('select attempt_count,classification_attempt_count,accepted_attempt_id,classification_status from pulse_run_items')).rows).toEqual([{attempt_count:1,classification_attempt_count:3,accepted_attempt_id:attempt,classification_status:'classified'}])
  expect((await state.pg!.query('select attempt_number,status from pulse_classification_attempts order by attempt_number')).rows).toEqual([{attempt_number:1,status:'fallback'},{attempt_number:2,status:'fallback'},{attempt_number:3,status:'fallback'}])
  const journal=(await state.pg!.query('select context,status from pulse_legacy_classification_attempts')).rows[0]
  expect(journal).toMatchObject({context:{basis:'run-manifest',version:ANALYSIS_VERSION,acceptedAttemptId:attempt},status:'classified'})
  expect((await state.pg!.query('select total_queries,brand_mentions,sov_score from pulse_weekly_summary where platform is null')).rows).toEqual([{total_queries:1,brand_mentions:0,sov_score:'0.00'}])
 })
 it('does not spend twice for concurrent or repeated repair intents',async()=>{
  let release!:(value:ReturnType<ReturnType<typeof classify>> extends Promise<infer T>?T:never)=>void
  const classifier=vi.fn(()=>new Promise<Awaited<ReturnType<ReturnType<typeof classify>>>>(resolve=>{release=resolve}))
  const first=repairLegacyClassifications(scope,input(),classifier)
  void first.catch(()=>{})
  await vi.waitFor(()=>expect(classifier).toHaveBeenCalledTimes(1))
  expect(await repairLegacyClassifications(scope,input(),classify())).toEqual({classified:0,unchanged:1,failed:0})
  release(coerceAnalysis({brand_mentioned:false,sentiment:'unknown',competitors_mentioned:[]},'A retained answer with citations.','Frozen Brand')!)
  await first
  expect(await repairLegacyClassifications(scope,input(),classifier)).toEqual({classified:0,unchanged:1,failed:0})
  expect(classifier).toHaveBeenCalledTimes(1)
 })
 it.each(['foreign account','foreign run','changed metric body','active ordinary lease','current version'])('refuses %s before a provider call',async kind=>{
  if(kind==='changed metric body')await state.pg!.exec("update pulse_metrics set raw_answer='mismatched projection'")
  if(kind==='active ordinary lease')await state.pg!.query("update pulse_run_items set classification_lease_token=$1,classification_lease_until=now()+interval '1 hour'",[idFor('8',1)])
  if(kind==='current version')await state.pg!.query('update pulse_item_attempts set classifier_version=$1',[ANALYSIS_VERSION])
  const classifier=classify()
  const result=repairLegacyClassifications(kind==='foreign account'?{...scope,accountId:'10000000-0000-4000-8000-000000000099'}:scope,{...input(),...(kind==='foreign run'?{runId:'30000000-0000-4000-8000-000000000099'}:{})},classifier)
  if(kind.startsWith('foreign')||kind==='changed metric body')await expect(result).rejects.toThrow('LEGACY_REPAIR_NOT_FOUND')
  else expect(await result).toEqual({classified:0,unchanged:1,failed:0})
  expect(classifier).not.toHaveBeenCalled()
 })
 it.each(['answer','accepted attempt','expired journal','lease token','answer hash'])('fences a stale result after %s changes',async change=>{
  const classifier=vi.fn(async()=>{
   if(change==='answer')await state.pg!.exec("update pulse_item_attempts set raw_answer='changed'")
   if(change==='accepted attempt')await state.pg!.exec('update pulse_run_items set accepted_attempt_id=null')
   if(change==='expired journal')await state.pg!.exec("update pulse_legacy_classification_attempts set lease_until=now()-interval '1 second'")
   if(change==='lease token')await state.pg!.query('update pulse_legacy_classification_attempts set lease_token=$1',[idFor('8',99)])
   if(change==='answer hash')await state.pg!.exec("update pulse_legacy_classification_attempts set answer_hash=repeat('0',64)")
   return coerceAnalysis({brand_mentioned:false,sentiment:'unknown',competitors_mentioned:[]},'A retained answer with citations.','Frozen Brand')!
  })
  expect(await repairLegacyClassifications(scope,input(),classifier)).toEqual({classified:0,unchanged:0,failed:1})
  expect((await state.pg!.query('select classification_status from pulse_metrics')).rows).toEqual([{classification_status:'fallback'}])
  expect((await state.pg!.query('select classification_status from pulse_run_items')).rows).toEqual([{classification_status:'fallback'}])
  expect((await state.pg!.query('select status from pulse_legacy_classification_attempts')).rows).toEqual([{status:'started'}])
 })
 it('keeps a repaired classification accepted when ordinary cleanup sees its former expired lease',async()=>{
  await state.pg!.query("update pulse_run_items set classification_lease_token=$1,classification_lease_until=now()-interval '1 minute'",[idFor('8',1)])
  const before=await collectionEvidence(),classifier=classify()
  expect(await repairLegacyClassifications(scope,input(),classifier)).toEqual({classified:1,unchanged:0,failed:0})
  expect(await claimClassifications(scope,run,Date.now()+45000)).toEqual([])
  expect((await state.pg!.query('select classification_status,classification_lease_token,classification_lease_until from pulse_run_items')).rows)
   .toEqual([{classification_status:'classified',classification_lease_token:null,classification_lease_until:null}])
  expect((await state.pg!.query('select classification_status from pulse_metrics')).rows).toEqual([{classification_status:'classified'}])
  expect(await collectionEvidence()).toEqual(before)
  expect(classifier).toHaveBeenCalledTimes(1)
 })
 it('replays a failed final summary with retained observation IDs and no additional paid call',async()=>{
  const classifier=classify();state.failSummaryWrites=1
  await expect(repairLegacyClassifications(scope,input(),classifier)).rejects.toThrow('Injected summary write failure')
  expect((await state.pg!.query('select classification_status from pulse_metrics')).rows).toEqual([{classification_status:'classified'}])
  expect(await repairLegacyClassifications(scope,input(),classifier)).toEqual({classified:0,unchanged:1,failed:0})
  expect((await state.pg!.query('select total_queries,brand_mentions,sov_score from pulse_weekly_summary where platform is null')).rows)
   .toEqual([{total_queries:1,brand_mentions:0,sov_score:'0.00'}])
  expect(classifier).toHaveBeenCalledTimes(1)
 })
 it('replays a failed final summary with no observation IDs, provider configuration or additional paid call',async()=>{
  const classifier=classify();state.failSummaryWrites=1
  await expect(repairLegacyClassifications(scope,input(),classifier)).rejects.toThrow('Injected summary write failure')
  expect((await state.pg!.query('select classification_status from pulse_metrics')).rows).toEqual([{classification_status:'classified'}])
  const before=await collectionEvidence()
  vi.stubEnv('OPENROUTER_API_KEY','')
  expect(await repairLegacyClassifications(scope,{...input(),observationIds:[]})).toEqual({classified:0,unchanged:0,failed:0})
  expect((await state.pg!.query('select total_queries,brand_mentions,sov_score from pulse_weekly_summary where platform is null')).rows)
   .toEqual([{total_queries:1,brand_mentions:0,sov_score:'0.00'}])
  expect((await state.pg!.query('select status from pulse_runs')).rows).toEqual([{status:'completed'}])
  expect((await state.pg!.query('select status from pulse_legacy_classification_attempts')).rows).toEqual([{status:'classified'}])
  expect(await collectionEvidence()).toEqual(before)
  expect(classifier).toHaveBeenCalledTimes(1)
 })
 it('does not allow classification-free finalization to cross ownership or conceal an incomplete run',async()=>{
  const classifier=classify(),finalize={...input(),observationIds:[]}
  await expect(repairLegacyClassifications({...scope,accountId:idFor('1',99)},finalize,classifier)).rejects.toThrow('LEGACY_REPAIR_NOT_FOUND')
  await expect(repairLegacyClassifications(scope,finalize,classifier)).rejects.toThrow('INVALID_LEGACY_REPAIR')
  expect(classifier).not.toHaveBeenCalled()
  expect((await state.pg!.query('select count(*)::int as count from pulse_legacy_classification_attempts')).rows).toEqual([{count:0}])
 })
 it('repairs exactly eight exhausted observations among forty saved answers through the real inventory and summary',async()=>{
  vi.stubEnv('FEATURE_PULSE_ATTEMPTS','0');await seedRun(40)
  const before=await collectionEvidence(),classifier=vi.fn(async({answer,brandName}:Parameters<typeof import('@/lib/pulse/analysis').analyseAnswer>[0])=>
   coerceAnalysis({brand_mentioned:true,sentiment:'unknown',competitors_mentioned:[]},answer,brandName)!)
  const initial=await readUserPulseRun(scope,run)
  expect(initial).toMatchObject({week,coverage:{expected:40,succeeded:40,classified:32,status:'partial'},retryable:false})
  expect(initial?.classificationRepairIds).toEqual([idFor('6',1)])
  for(let n=1;n<=8;n++){
    const current=await readUserPulseRun(scope,run)
    expect(current).toMatchObject({week,coverage:{expected:40,succeeded:40,classified:31+n,status:'partial'}})
    expect(current?.classificationRepairIds).toEqual([idFor('6',n)])
    expect(await repairLegacyClassifications(scope,{...input(),intentKey:`saved-repair-single-${n}`,observationIds:current!.classificationRepairIds!},classifier))
      .toEqual({classified:1,unchanged:0,failed:0})
  }
  expect(await readUserPulseRun(scope,run)).toMatchObject({week,classificationRepairIds:[],coverage:{expected:40,succeeded:40,classified:40,mentioned:8,mentionRate:0.2,status:'completed'}})
  expect(classifier).toHaveBeenCalledTimes(8)
  expect(classifier.mock.calls.every(([value])=>value.brandName==='Frozen Brand')).toBe(true)
  expect((await state.pg!.query("select count(*)::int as count,count(distinct observation_id)::int as observations from pulse_legacy_classification_attempts where status='classified' and context->>'version'=$1",[ANALYSIS_VERSION])).rows)
   .toEqual([{count:8,observations:8}])
  expect((await state.pg!.query('select total_queries,brand_mentions,sov_score,avg_sentiment_score from pulse_weekly_summary where platform is null')).rows)
   .toEqual([{total_queries:40,brand_mentions:8,sov_score:'20.00',avg_sentiment_score:null}])
  expect((await state.pg!.query('select platform,total_queries,brand_mentions from pulse_weekly_summary where platform is not null order by platform')).rows)
   .toEqual(platforms.map((platform,index)=>({platform,total_queries:8,brand_mentions:index<3?2:1})))
  expect((await state.pg!.query('select status from pulse_runs')).rows).toEqual([{status:'completed'}])
  expect(await collectionEvidence()).toEqual(before)
 })
})

describe('saved canonical coverage when collection is paused',()=>{
 const observations=()=>[{client_id:client,scan_week:week,platform:null,observed_queries:40,collected_queries:40,successful_queries:32,observed_brand_mentions:0,successful_platform_count:5}]
 it.each(['0','1'])('keeps the frozen 40-answer workload readable with FEATURE_PULSE_ATTEMPTS=%s',async flag=>{
  await seedRun(40)
  vi.stubEnv('FEATURE_PULSE_ATTEMPTS',flag)
  const result=projectObservedSummary(await attachManifestCoverage(db(),account,[client],observations()))
  expect(result.coverage).toMatchObject({expected:40,recorded:40,collected:40,classified:32,collectionRate:1,classificationRate:0.8,provenance:'ledger'})
  expect(result.state).toBe('partial')
 })
 it('does not attach another account canonical workload to legacy observations while paused',async()=>{
  await seedRun(40)
  vi.stubEnv('FEATURE_PULSE_ATTEMPTS','0')
  const rows=await attachManifestCoverage(db(),'10000000-0000-4000-8000-000000000002',[client],observations())
  expect(projectObservedSummary(rows).coverage).toMatchObject({expected:null,collectionRate:null,provenance:'legacy'})
 })
 it('does not invent a denominator for an owned client without a saved manifest',async()=>{
  vi.stubEnv('FEATURE_PULSE_ATTEMPTS','0')
  const legacyClient='20000000-0000-4000-8000-000000000002'
  await state.pg!.query("insert into clients values($1,$2,'Legacy client','{}')",[legacyClient,account])
  const rows=await attachManifestCoverage(db(),account,[legacyClient],[{...observations()[0],client_id:legacyClient}])
  expect(projectObservedSummary(rows).coverage).toMatchObject({expected:null,collectionRate:null,provenance:'legacy'})
 })
})
