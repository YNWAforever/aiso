import{beforeEach,afterEach,afterAll,describe,it,expect,vi}from'vitest'
import{randomUUID}from'node:crypto'
import{writeFileSync}from'node:fs'
import{neon}from'@neondatabase/serverless'
import{NextRequest}from'next/server'
vi.mock('server-only',()=>({}))
const auth=vi.hoisted(()=>({profile:null as Record<string,unknown>|null,error:false,provider:vi.fn()}))
vi.mock('@/lib/auth',()=>({getProfile:async()=>{if(auth.error)throw Error('Synthetic session store unavailable');return auth.profile}}))
vi.mock('@/lib/openrouter',async original=>({...await original<typeof import('@/lib/openrouter')>(),callOpenRouter:auth.provider}))
vi.mock('next/server',async original=>({...await original<typeof import('next/server')>(),after:vi.fn()}))
import{POST as onboarding}from'@/app/api/onboarding/complete/route'
import{GET as bulkRead,POST as bulkWrite}from'@/app/api/dashboard/clients/[clientId]/prompts/bulk/route'
import{GET as optionsRead,POST as pulseWrite}from'@/app/api/dashboard/clients/[clientId]/pulse-runs/route'
import{GET as runRead}from'@/app/api/dashboard/clients/[clientId]/pulse-runs/[runId]/route'
import{GET as observationsRead}from'@/app/api/clients/[clientId]/observations/route'
import{POST as legacyRepair}from'@/app/api/dashboard/clients/[clientId]/pulse-runs/legacy-repair/route'
import{GET as adminRead}from'@/app/api/admin/directory/route'
import{db}from'@/lib/db'
import{createOrResumeRun}from'@/lib/pulse/runs/store'
const admin=neon(process.env.TEST_DATABASE_URL!),accounts:string[]=[],fixtureIds:string[]=[]
let a:{accountId:string;clientId:string},b:typeof a
const request=(body?:unknown)=>new NextRequest('http://localhost/api/fixture',{method:body===undefined?'GET':'POST',...(body===undefined?{}:{body:JSON.stringify(body),headers:{'Content-Type':'application/json'}})})
const params=(clientId=a.clientId)=>({params:Promise.resolve({clientId})})
function session(scope:typeof a,is_admin=false){auth.profile={id:scope.accountId,account_id:scope.accountId,is_admin,accounts:{plan:'pro',status:'active',stripe_subscription_id:'sub_t34_'+scope.accountId}}}
async function seed(){const accountId=randomUUID(),clientId=randomUUID();accounts.push(accountId);fixtureIds.push(accountId);await admin`insert into accounts(id,plan,status,stripe_subscription_id) values(${accountId},'pro','active',${'sub_t34_'+accountId})`;await admin`insert into clients(id,account_id,brand_name,domain,status) values(${clientId},${accountId},'T34 synthetic brand','fixture.example','active')`;await admin`insert into prompt_bank(client_id,question,category,language,market,is_active) values(${clientId},'T34 synthetic question','brand_query','en','HK',true)`;await admin`insert into pulse_metrics(client_id,platform,question,scan_week,raw_answer,classification_status,brand_mentioned) values(${clientId},'synthetic','Saved old question','2026-10-05','Immutable T34 saved original','legacy_unknown',null)`;return{accountId,clientId}}
beforeEach(async()=>{
 const target=new URL(process.env.DATABASE_URL!);expect(target.hostname).toBe('127.0.0.1');expect(target.port).toBe('55439');expect(target.username).toBe('aeo_app');expect(target.pathname).toBe('/aiso_audit_fixture');expect((await db()`select current_user as role`)[0].role).toBe('aeo_app')
 auth.error=false;auth.provider.mockReset().mockResolvedValue(JSON.stringify({questions:[{question:'Synthetic seeded question',category:'brand_query',language:'en'}]}));vi.stubEnv('FEATURE_PULSE_ATTEMPTS','1');a=await seed();b=await seed();session(a)
})
afterEach(async()=>{for(const accountId of accounts.splice(0)){await admin`delete from work_item_sources where account_id=${accountId}`;await admin`delete from work_item_groups where account_id=${accountId}`;await admin`delete from evidence_work_items where account_id=${accountId}`;await admin`delete from pulse_user_intents where account_id=${accountId}`;await admin`delete from pulse_run_reservations where account_id=${accountId}`;await admin`delete from onboarding_progress where account_id=${accountId}`;await admin`delete from pulse_weekly_summary where client_id in(select id from clients where account_id=${accountId})`;await admin`delete from pulse_legacy_classification_attempts where account_id=${accountId}`;await admin`delete from pulse_metrics where client_id in(select id from clients where account_id=${accountId})`;await admin`update pulse_run_items set accepted_attempt_id=null where account_id=${accountId}`;await admin`delete from pulse_classification_attempts where account_id=${accountId}`;await admin`delete from pulse_item_attempts where account_id=${accountId}`;await admin`delete from pulse_run_items where account_id=${accountId}`;await admin`delete from pulse_runs where account_id=${accountId} and purpose='retest'`;await admin`delete from pulse_runs where account_id=${accountId}`;await admin`delete from accounts where id=${accountId}`}})
afterEach(()=>{vi.unstubAllEnvs();auth.profile=null;auth.error=false})
afterAll(async()=>{const [counts]=await admin`select (select count(*)::int from accounts where id=any(${fixtureIds}::uuid[])) as accounts,(select count(*)::int from clients where account_id=any(${fixtureIds}::uuid[])) as brands,(select count(*)::int from pulse_runs where account_id=any(${fixtureIds}::uuid[])) as runs,(select count(*)::int from onboarding_progress where account_id=any(${fixtureIds}::uuid[])) as onboarding,(select count(*)::int from prompt_batch_intents where account_id=any(${fixtureIds}::uuid[])) as batches`;expect(counts).toEqual({accounts:0,brands:0,runs:0,onboarding:0,batches:0});writeFileSync('artifacts/aiso-development-20261013/T34-cleanup.json',JSON.stringify({at:new Date().toISOString(),testOwnedAccounts:fixtureIds.length,role:'aeo_app',sessionEvidence:'mock only',counts},null,2));const {closeLocalTransport}=await import('../../scripts/ci/local-pg-transport.mjs');await closeLocalTransport()})
const snapshot=()=>admin`select m.id,m.raw_answer,m.brand_mentioned,m.classification_status,m.scan_week from pulse_metrics m join clients c on c.id=m.client_id where c.account_id=${a.accountId} order by m.id`
describe('T34 app-role SQL with synthetic session seam; NOT actual Auth acceptance',()=>{
 it('lost committed onboarding response reconciles one brand; payload conflict and changed identity cannot overwrite',async()=>{
  const body={intentKey:'T34-onboarding-original',brandName:'Committed one brand',language:'en',market:'HK',accountId:b.accountId}
  const before=await snapshot();expect((await onboarding(request(body))).status).toBe(200) // deliberately discard accepted body
  const response=await onboarding(request(body)),saved=await response.json();expect(response.status).toBe(200);expect(saved.progress.prompts).toBe('ready')
  expect(auth.provider).toHaveBeenCalledOnce();expect(await admin`select count(*)::int n from clients where account_id=${a.accountId}`).toEqual([{n:2}])
  expect(await admin`select count(*)::int n from prompt_bank where client_id=${saved.clientId}`).toEqual([{n:1}])
  expect((await onboarding(request({...body,brandName:'Changed'}))).status).toBe(409)
  session(b);expect((await onboarding(request({...body,clientId:saved.clientId}))).status).toBe(404)
  auth.profile=null;expect((await onboarding(request(body))).status).toBe(401);expect(await snapshot()).toEqual(before)
 })
 it('bulk original receipt replays exactly once after response loss and freezes existing run input',async()=>{
  const frozen=await createOrResumeRun(a,{scanWeek:'2026-09-28',manifest:[{platform:'synthetic',model:'synthetic/model'}]});const original=await admin`select manifest from pulse_runs where id=${frozen!.id}`,before=await snapshot()
  const read=await bulkRead(request(),params()),version=(await read.json()).version
  const body={intentKey:'T34-bulk-original',expectedVersion:version,changes:[{question:'One T34 new question',category:'brand_query',language:'en',market:'HK',is_active:true}]}
  expect((await bulkWrite(request(body),params())).status).toBe(200)
  const again=await bulkWrite(request(body),params());expect(again.status).toBe(200);const receipt=await again.json();expect(receipt.activeCount).toBe(2);expect(receipt.updatedIds).toHaveLength(1);expect((await (await bulkRead(request(),params())).json()).prompts).toHaveLength(2);expect(await admin`select result from prompt_batch_intents where account_id=${a.accountId}`).toEqual([{result:receipt}])
  expect(await admin`select count(*)::int n from prompt_batch_intents where account_id=${a.accountId}`).toEqual([{n:1}])
  expect((await bulkWrite(request({...body,changes:[{...body.changes[0],question:'Different payload'}]}),params())).status).toBe(409)
  expect(await admin`select manifest from pulse_runs where id=${frozen!.id}`).toEqual(original);expect(await snapshot()).toEqual(before)
 })
 it('bulk owned/foreign/anonymous follows 200/404/401 without revealing rows',async()=>{
  expect((await bulkRead(request(),params())).status).toBe(200);session(b);expect((await bulkRead(request(),params())).status).toBe(404)
  expect((await bulkWrite(request({mode:'preview',rows:[]}),params())).status).toBe(404);auth.profile=null;expect((await bulkRead(request(),params())).status).toBe(401);expect((await bulkWrite(request({}),params())).status).toBe(401)
 })
 it('lost run response and repair keep one run/reservation and existing original answers',async()=>{
  const before=await snapshot(),body={kind:'initial',intentKey:'T34-run-original'}
  expect((await pulseWrite(request(body),params())).status).toBe(202)
  const again=await pulseWrite(request(body),params()),result=await again.json();expect(again.status).toBe(202)
  expect(await admin`select count(*)::int n from pulse_runs where account_id=${a.accountId}`).toEqual([{n:1}]);expect(await admin`select count(*)::int n from pulse_run_reservations where account_id=${a.accountId}`).toEqual([{n:1}])
  const frozen=await admin`select manifest from pulse_runs where account_id=${a.accountId}`
  expect((await pulseWrite(request({kind:'repair',intentKey:'T34-run-repair',sourceRunId:result.run.id}),params())).status).toBe(202)
  expect(await admin`select manifest from pulse_runs where account_id=${a.accountId}`).toEqual(frozen);expect(await snapshot()).toEqual(before);expect(auth.provider).not.toHaveBeenCalled()
  expect((await pulseWrite(request({...body,kind:'retest',sourceRunId:result.run.id}),params())).status).toBe(409)
 })
 it('run/options/repair owned then foreign and anonymous use actual SQL ownership',async()=>{
  const saved=await pulseWrite(request({kind:'initial',intentKey:'T34-owned-run'}),params()),id=(await saved.json()).run.id
  const detail={params:Promise.resolve({clientId:a.clientId,runId:id})}
  expect((await optionsRead(request(),params())).status).toBe(200);expect((await runRead(request(),detail)).status).toBe(200)
  session(b);expect((await optionsRead(request(),params())).status).toBe(404);expect((await runRead(request(),detail)).status).toBe(404);expect((await pulseWrite(request({kind:'repair',intentKey:'T34-foreign-repair',sourceRunId:id}),params())).status).toBe(404)
  auth.profile=null;expect((await optionsRead(request(),params())).status).toBe(401);expect((await runRead(request(),detail)).status).toBe(401);expect((await pulseWrite(request({kind:'repair',intentKey:'T34-anon-repair',sourceRunId:id}),params())).status).toBe(401)
 })
 it('saved observations and legacy repair deny foreign/session-revoked before any classifier',async()=>{
  const owned=await observationsRead(request(),params());expect(owned.status).toBe(200);const observed=await owned.json();expect(observed.counts).toMatchObject({recordedRows:1,successfulRows:0,incompleteRows:1});expect(observed.items).toHaveLength(1)
  const rows=await snapshot();session(b);expect((await observationsRead(request(),params())).status).toBe(404)
  expect((await legacyRepair(request({observationIds:[rows[0].id],intentKey:'T34-foreign-legacy'}),params())).status).toBe(404)
  auth.profile=null;expect((await observationsRead(request(),params())).status).toBe(401);expect((await legacyRepair(request({observationIds:[rows[0].id],intentKey:'T34-anon-legacy'}),params())).status).toBe(401)
  expect(auth.provider).not.toHaveBeenCalled();expect(await snapshot()).toEqual(rows)
 })
 it('server Admin guard refuses ordinary/revoked sessions and permits synthetic admin read only',async()=>{
  const req=new NextRequest('http://localhost/api/admin/directory?view=brands&accountId='+a.accountId)
  expect((await adminRead(req)).status).toBe(403);session(a,true);const allowed=await adminRead(req);expect(allowed.status).toBe(200);expect((await allowed.json()).rows).toHaveLength(1)
  session(a,false);expect((await adminRead(req)).status).toBe(403);auth.profile=null;expect((await adminRead(req)).status).toBe(401)
 })
 it('session-store outage stays unavailable rather than anonymous/empty and performs no mutation',async()=>{
  const before=await snapshot();auth.error=true
  expect((await optionsRead(request(),params())).status).toBe(503);expect((await observationsRead(request(),params())).status).toBe(503)
  await expect(onboarding(request({brandName:'No outage write',intentKey:'T34-no-write'}))).rejects.toThrow('Synthetic session store unavailable')
  expect(await snapshot()).toEqual(before);expect(auth.provider).not.toHaveBeenCalled()
 })
})
