import {describe,it,expect,vi,afterEach} from 'vitest'
import {randomUUID,createHash} from 'node:crypto'
import {neon} from '@neondatabase/serverless'
vi.mock('server-only',()=>({}))
import {db} from '@/lib/db'
import {createOrResumeRun,claimDueItems,commitAttempt,recordClassification} from '@/lib/pulse/runs/store'
import {repairLegacyClassifications} from '@/lib/pulse/runs/legacy-repair'
import {naiveAnalysis} from '@/lib/pulse/analysis-fallback'
import {computeWeeklySummary} from '@/lib/pulse/summary'
import {initializeOnboarding} from '@/lib/onboarding/store'
import {parseOnboardingInput} from '@/lib/onboarding/schema'
const admin=neon(process.env.TEST_DATABASE_URL!)
const accounts:string[]=[]
afterEach(async()=>{for(const accountId of accounts.splice(0)){await admin`delete from onboarding_progress where account_id=${accountId}`;await admin`delete from pulse_weekly_summary where client_id in(select id from clients where account_id=${accountId})`;await admin`delete from pulse_legacy_classification_attempts where account_id=${accountId}`;await admin`delete from pulse_metrics where client_id in(select id from clients where account_id=${accountId})`;await admin`update pulse_run_items set accepted_attempt_id=null where account_id=${accountId}`;await admin`delete from pulse_classification_attempts where account_id=${accountId}`;await admin`delete from pulse_item_attempts where account_id=${accountId}`;await admin`delete from pulse_run_items where account_id=${accountId}`;await admin`delete from pulse_runs where account_id=${accountId} and purpose='retest'`;await admin`delete from pulse_runs where account_id=${accountId}`;await admin`delete from accounts where id=${accountId}`}})
async function fixture(){const accountId=randomUUID(),clientId=randomUUID();accounts.push(accountId);await admin`insert into accounts(id,plan,status) values(${accountId},'basic','active')`;await admin`insert into clients(id,account_id,brand_name,domain) values(${clientId},${accountId},'Synthetic audit','fixture.example')`;await admin`insert into prompt_bank(client_id,question,language,market) values(${clientId},'Synthetic question','en','HK')`;return{accountId,clientId}}
const manifest=[{platform:'synthetic',model:'synthetic/model'}],intent={kind:'initial' as const,intentKey:'initial-test-1'}
describe('real local PostgreSQL audit persistence (not hosted Neon)',()=>{
 it('retest intent is idempotent, repair reuses frozen input, canonical denominator stays unchanged',async()=>{
  const scope=await fixture();const canonical=(await createOrResumeRun(scope,{scanWeek:'2026-10-05',manifest,intent}))!
  const retestIntent={kind:'retest' as const,intentKey:'retest-test-1',sourceRunId:canonical.id}
  const [a,b]=await Promise.all([createOrResumeRun(scope,{scanWeek:'2026-10-05',manifest,intent:retestIntent}),createOrResumeRun(scope,{scanWeek:'2026-10-05',manifest,intent:retestIntent})]);expect(a?.id).toBe(b?.id);expect(a?.id).not.toBe(canonical.id)
  for(const run of [canonical,a!]){const [lease]=await claimDueItems(scope,run.id,{owner:'fixture',leaseUntil:new Date(Date.now()+60000),limit:1});expect(await commitAttempt(lease,{kind:'succeeded',evidence:{answer:'Synthetic immutable answer',actualModel:null,requestId:null,promptTokens:null,completionTokens:null,costUsd:null,httpStatus:200}})).toBe('committed');expect(await recordClassification(lease,{status:'classified',method:'fixture',version:'fixture-v1',brandMentioned:true,sentiment:'positive',mentionPosition:1,competitorsMentioned:[]})).toBe(true)}
  await computeWeeklySummary(db(),{clientId:scope.clientId,scanWeek:'2026-10-05'});const [row]=await admin`select total_queries,brand_mentions from pulse_weekly_summary where client_id=${scope.clientId} and platform is null`;expect(row).toMatchObject({total_queries:1,brand_mentions:1})
  const resumed=await createOrResumeRun(scope,{scanWeek:'2026-10-12',manifest,intent:{kind:'repair',intentKey:'repair-test-1',sourceRunId:canonical.id}});expect(resumed?.manifest).toEqual(canonical.manifest);expect(resumed?.id).toBe(canonical.id)
  expect(await createOrResumeRun({accountId:randomUUID(),clientId:scope.clientId},{scanWeek:'2026-10-05',manifest,intent:retestIntent})).toBeNull()
 })
 it('concurrent legacy repair charges one classifier, preserves original bytes and citation envelope',async()=>{
  const scope=await fixture(),answer='Synthetic raw answer unchanged',citations=[{url:'https://source.example/item',title:'Fixture'}];const [observation]=await admin`insert into pulse_metrics(client_id,question,platform,scan_week,raw_answer,provider_citations,classification_status) values(${scope.clientId},'Q','synthetic','2026-10-05',${answer},${JSON.stringify(citations)}::jsonb,'legacy_unknown') returning id`
  const classifier=vi.fn(async()=>({...naiveAnalysis(answer,'Synthetic audit'),classificationStatus:'classified' as const,providerUsage:{requestId:null,model:null,promptTokens:1,completionTokens:1,costUsd:null}}));const input={observationIds:[observation.id],intentKey:'repair-fixture-1',deadlineAt:Date.now()+60000};await Promise.all([repairLegacyClassifications(scope,input,classifier),repairLegacyClassifications(scope,input,classifier)]);expect(classifier).toHaveBeenCalledTimes(1);await repairLegacyClassifications(scope,input,classifier);expect(classifier).toHaveBeenCalledTimes(1)
  const [row]=await admin`select raw_answer,provider_citations,classification_status from pulse_metrics where id=${observation.id}`;expect(row).toEqual({raw_answer:answer,provider_citations:citations,classification_status:'classified'});const [journal]=await admin`select answer_hash,usage,context from pulse_legacy_classification_attempts where account_id=${scope.accountId}`;expect(journal.answer_hash).toBe(createHash('sha256').update(answer).digest('hex'));expect(journal.context.basis).toBe('current-repair-context');expect(journal.usage.costUsd).toBeNull()
  await expect(repairLegacyClassifications({accountId:randomUUID(),clientId:scope.clientId},{...input,intentKey:'foreign-repair-1'},classifier)).rejects.toThrow('LEGACY_REPAIR_NOT_FOUND')
 })
 it('onboarding concurrent same intent creates one brand and rejects changed payload',async()=>{
  const accountId=randomUUID();accounts.push(accountId);await admin`insert into accounts(id,plan,status) values(${accountId},'basic','active')`
  const input=parseOnboardingInput({intentKey:'onboarding-fixture-1',brandName:'Synthetic new brand',domain:'https://www.fixture.example/path',industry:'Technology',language:'en',market:'HK'});expect(input).not.toBeNull()
  const scope={accountId};const [a,b]=await Promise.all([initializeOnboarding(scope,input!),initializeOnboarding(scope,input!)]);expect(a?.clientId).toBe(b?.clientId);expect(a?.clientId).toBeTruthy();await expect(initializeOnboarding(scope,{...input!,brandName:'Changed'})).rejects.toThrow('ONBOARDING_INTENT_CONFLICT')
 })
})
