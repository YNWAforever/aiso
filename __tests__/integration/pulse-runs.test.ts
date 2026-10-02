import {beforeAll,describe,it,expect,vi} from 'vitest'
import {neon} from '@neondatabase/serverless'
import {randomUUID} from 'node:crypto'
import {claimDueItems,commitAttempt,createOrResumeRun,readRunCoverage} from '@/lib/pulse/runs/store'
import {processLeasedItem} from '@/lib/pulse/runs/service'
import {modelVariantsFor,PLATFORM_KEYS} from '@/lib/openrouter'
import {attachManifestCoverage} from '@/lib/pulse/runs/read-coverage'
import {db} from '@/lib/db'
import type {ProviderEvidence,PulseScope} from '@/lib/pulse/runs/schema'
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
    await sql`delete from pulse_metrics where client_id=${scope.clientId}`
    await sql`update pulse_run_items set accepted_attempt_id=null where account_id=${accountId}`
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
  it('compatibility writer preserves three old successes after an all-failed retry',async()=>fixture(async scope=>{
    vi.stubEnv('FEATURE_PULSE_ATTEMPTS','0')
    vi.stubEnv('CRON_SECRET','synthetic-cron-secret-1234')
    await sql`update accounts set stripe_subscription_id='sub_synthetic' where id=${scope.accountId}`
    external.classify.mockResolvedValue({brandMentioned:true,sentiment:'neutral',mentionPosition:0,competitorsMentioned:[]})
    external.fanout.mockResolvedValue([{platform:'gemini-flash',answer:'Synthetic preserved'}])
    const post=()=>POST(new Request('http://localhost/api/pulse/run',{method:'POST',headers:{'Content-Type':'application/json','x-cron-secret':'synthetic-cron-secret-1234'},body:JSON.stringify({clientId:scope.clientId})}) as never)
    try{
      expect((await post()).status).toBe(200)
      external.fanout.mockResolvedValue([])
      expect((await post()).status).toBe(200)
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
