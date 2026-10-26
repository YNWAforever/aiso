import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll,afterAll,afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
const h=vi.hoisted(()=>({pg:null as PGlite|null}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/db',()=>{
  const sql=(strings:TemplateStringsArray,...values:unknown[])=>{const text=strings.reduce((out,part,i)=>out+(i?`$${i}`:'')+part,'');return{text,values,then:(resolve:(rows:unknown[])=>unknown,reject:(error:unknown)=>unknown)=>h.pg!.query(text,values).then(result=>result.rows).then(resolve,reject)}}
  sql.transaction=(queries:{text:string;values:unknown[]}[])=>h.pg!.transaction(async tx=>{const results=[];for(const query of queries)results.push((await tx.query(query.text,query.values)).rows);return results})
  return{db:()=>sql}
})
import { saveMonitoredQuery,loadVisibilityWorkspace,saveVisibilityReview,createVisibilityDraft } from '@/lib/visibility/store'
import { parseMonitoredQuery } from '@/lib/visibility/input'
import { setVisibilityAutomation,enqueueVisibilitySource,claimVisibilityJob,finishVisibilityJob,saveVisibilityPageSnapshot,repairVisibilityLeases,finishWaitingVisibilityJob } from '@/lib/visibility/jobs'
import { discoverVisibilitySources,loadVisibilityAutomationTargets,loadDueVisibilityJobs,pollWaitingVisibilityJob } from '@/lib/visibility/cron'
const account='11000000-0000-4000-8000-000000000001',foreign='11000000-0000-4000-8000-000000000002',client='22000000-0000-4000-8000-000000000001',other='22000000-0000-4000-8000-000000000002',actor='33000000-0000-4000-8000-000000000001',prompt='44000000-0000-4000-8000-000000000001',run='55000000-0000-4000-8000-000000000001',item='66000000-0000-4000-8000-000000000001',observation='77000000-0000-4000-8000-000000000001'
const scope={accountId:account,clientId:client},wrong={accountId:foreign,clientId:client}
beforeAll(async()=>{
 h.pg=await PGlite.create();await h.pg.exec(`create role aeo_app;
 create table accounts(id uuid primary key,plan text default 'pro',status text default 'active',stripe_subscription_id text default 'sub_fixture',trial_ends_at timestamptz,override_plan text,override_expires_at timestamptz);
 create table clients(id uuid primary key,account_id uuid references accounts(id),domain text,status text default 'active',unique(id,account_id));
 create table profiles(id uuid primary key,account_id uuid references accounts(id),deactivated_at timestamptz,unique(id,account_id));
 create table prompt_bank(id uuid primary key,client_id uuid references clients(id),question text,language text,market text,is_active boolean);
 create table competitors(id uuid primary key,account_id uuid,client_id uuid,name text,aliases text[],domains text[],archived_at timestamptz);
 create table pulse_runs(id uuid primary key,account_id uuid,client_id uuid,manifest jsonb,purpose text,status text default 'completed',created_at timestamptz default now(),unique(id,client_id,account_id));
 create table evidence_work_items(id uuid primary key,account_id uuid,client_id uuid,revision integer default 1,target_url text,operation_status text default 'todo',title text default 'Work item',unique(id,client_id,account_id));
 create table outcome_deployments(id uuid primary key,account_id uuid,client_id uuid,deployed_at timestamptz,urls jsonb,external_id text default 'release');
 create table pulse_run_items(id uuid primary key,account_id uuid,client_id uuid,run_id uuid,prompt_snapshot_id uuid,platform text,snapshot jsonb,classification_status text,status text,accepted_attempt_id uuid);
 create table pulse_item_attempts(id uuid primary key,item_id uuid,account_id uuid,client_id uuid,requested_model text,actual_model text,finished_at timestamptz,raw_answer text,provider_citations jsonb,classification jsonb,collection_status text,accepted boolean,grounding text default 'none',search_evidence jsonb default '{"requested":"none","execution":"unknown","basis":"request-only"}',unique(id,item_id,client_id,account_id));`)
 await h.pg.exec(readFileSync('supabase/migrations/074_closed_loop_visibility.sql','utf8'))
 await h.pg.exec(readFileSync('supabase/migrations/075_visibility_revalidation_sources.sql','utf8'))
})
afterAll(async()=>{await h.pg?.close()})
afterEach(()=>vi.unstubAllEnvs())
beforeEach(async()=>{
 await h.pg!.exec('truncate accounts cascade;truncate pulse_runs,pulse_run_items,pulse_item_attempts,competitors,evidence_work_items,outcome_deployments cascade')
 await h.pg!.query('insert into accounts values($1),($2)',[account,foreign])
 await h.pg!.query("insert into clients values($1,$2,'example.com'),($3,$4,'foreign.example')",[client,account,other,foreign])
 await h.pg!.query('insert into profiles(id,account_id) values($1,$2)',[actor,account])
 await h.pg!.query("insert into prompt_bank values($1,$2,'Which service?','en','HK',true,null)",[prompt,client])
 const monitoring={targetUrl:'https://example.com/a',intent:'comparison',expectedAttributes:['Evidence'],sampling:{temperature:0.2,samplesPerRun:1,seed:null}}
 await h.pg!.query("insert into pulse_runs(id,account_id,client_id,manifest,purpose) values($1,$2,$3,$4,'canonical')",[run,account,client,JSON.stringify({brand:{domain:'example.com',competitorRefs:[]}})])
 await h.pg!.query("insert into pulse_run_items values($1,$2,$3,$4,$5,'gpt-4o',$6,'classified','succeeded',$7)",[item,account,client,run,prompt,JSON.stringify({question:'Frozen question',language:'en',market:'HK',monitoring}),observation])
 await h.pg!.query("insert into pulse_item_attempts values($1,$2,$3,$4,'model','model',now(),'A source answer',$5,$6,'succeeded',true,default,default)",[observation,item,account,client,JSON.stringify([{url:'https://source.example/a'}]),JSON.stringify({brandMentioned:false,sentiment:'unknown',competitorsMentioned:[]})])
})
describe('actual SQL visibility boundaries',()=>{
 it('captures work completion transitions without inventing historic completions or repeating done edits',async()=>{
  await h.pg!.query("insert into evidence_work_items(id,account_id,client_id,target_url) values($1,$2,$3,'https://example.com/a')",[item,account,client])
  await h.pg!.query("update evidence_work_items set operation_status='done',revision=2 where id=$1",[item])
  await h.pg!.query("update evidence_work_items set operation_status='done',revision=3 where id=$1",[item])
  expect((await h.pg!.query('select item_revision from visibility_completion_events')).rows).toEqual([{item_revision:2}])
  await h.pg!.query("update evidence_work_items set operation_status='in_progress' where id=$1",[item])
  await h.pg!.query("update evidence_work_items set operation_status='done',revision=4 where id=$1",[item])
  expect((await h.pg!.query('select id from visibility_completion_events')).rows).toHaveLength(2)
 })
 it('discovers only future opted-in sources for active creators',async()=>{
  await setVisibilityAutomation(scope,actor,true)
  await h.pg!.query("insert into outcome_deployments values($1,$2,$3,now()-interval '1 day',$4),($5,$2,$3,now(),$4)",[item,account,client,JSON.stringify(['https://example.com/a']),observation])
  expect((await discoverVisibilitySources(scope)).map(row=>row.id)).toEqual([observation])
  expect(await discoverVisibilitySources(wrong)).toEqual([])
  expect((await loadVisibilityAutomationTargets()).map(row=>row.account_id)).toEqual([account])
  await h.pg!.query('update profiles set deactivated_at=now() where id=$1',[actor])
  expect(await loadVisibilityAutomationTargets()).toEqual([])
 })
 it('polls a completed frozen retest into an owned immutable before/after result',async()=>{
  vi.stubEnv('FEATURE_CLOSED_LOOP_VISIBILITY','1')
  const nextRun='55000000-0000-4000-8000-000000000002',nextItem='66000000-0000-4000-8000-000000000002',nextAnswer='77000000-0000-4000-8000-000000000002'
  const manifest={version:'2026-10-26.v1',items:[{promptId:prompt,question:'Frozen question',language:'en',market:'HK',platform:'gpt-4o',model:'model'}],brand:{domain:'example.com',competitorRefs:[]}}
  await h.pg!.query('update pulse_runs set manifest=$1 where id=$2',[JSON.stringify(manifest),run])
  await h.pg!.query("update pulse_runs set created_at=now()-interval '2 hours' where id=$1",[run])
  await h.pg!.query("update pulse_item_attempts set finished_at=now()-interval '1 hour' where id=$1",[observation])
  await h.pg!.query("insert into outcome_deployments values($1,$2,$3,now()-interval '30 minutes',$4)",[observation,account,client,JSON.stringify(['https://example.com/a'])])
  await h.pg!.query("insert into pulse_runs(id,account_id,client_id,manifest,purpose) values($1,$2,$3,$4,'retest')",[nextRun,account,client,JSON.stringify(manifest)])
  await h.pg!.query('insert into pulse_run_items select $1,account_id,client_id,$2,prompt_snapshot_id,platform,snapshot,classification_status,status,$3 from pulse_run_items where id=$4',[nextItem,nextRun,nextAnswer,item])
  await h.pg!.query("insert into pulse_item_attempts select $1,$2,account_id,client_id,requested_model,actual_model,clock_timestamp(),'A new answer',$3,$4,collection_status,accepted,grounding,search_evidence from pulse_item_attempts where id=$5",[nextAnswer,nextItem,JSON.stringify([{url:'https://example.com/a'}]),JSON.stringify({brandMentioned:true,sentiment:'neutral',competitorsMentioned:[]}),observation])
  const job=await enqueueVisibilitySource(scope,'deployment',observation,actor),lease=await claimVisibilityJob(scope,job.id)
  expect(lease?.sourceRunId).toBe(run)
  await finishVisibilityJob(lease!,'waiting','PULSE_PENDING',{pages:[]},nextRun)
  await h.pg!.query('update visibility_revalidations set next_at=now() where id=$1',[job.id])
  const [pending]=await loadDueVisibilityJobs()
  expect(await pollWaitingVisibilityJob(pending)).toBe(true)
  const [saved]=(await h.pg!.query<{status:string;result:{ai:{comparable:boolean;delta:{answerPresence:number;citationShare:number}}}}>('select status,result from visibility_revalidations where id=$1',[job.id])).rows
  expect(saved).toMatchObject({status:'completed',result:{ai:{comparable:true,delta:{answerPresence:1,citationShare:1}}}})
  expect(await pollWaitingVisibilityJob(pending)).toBe(false)
  vi.unstubAllEnvs()
 })
 it('queues owned source snapshots once and fences foreign/stale job completion',async()=>{
  await setVisibilityAutomation(scope,actor,true)
  await expect(setVisibilityAutomation(wrong,actor,true)).rejects.toThrow('VISIBILITY_NOT_FOUND')
  await h.pg!.query("insert into outcome_deployments values($1,$2,$3,now(),$4)",[observation,account,client,JSON.stringify(['https://example.com/a'])])
  await expect(enqueueVisibilitySource(wrong,'deployment',observation,actor)).rejects.toThrow('VISIBILITY_NOT_FOUND')
  const job=await enqueueVisibilitySource(scope,'deployment',observation,actor)
  expect(await enqueueVisibilitySource(scope,'deployment',observation,actor)).toMatchObject({id:job.id})
  expect(await claimVisibilityJob(wrong,job.id)).toBeNull()
  const lease=await claimVisibilityJob(scope,job.id)
  expect(lease).not.toBeNull()
  expect(await claimVisibilityJob(scope,job.id)).toBeNull()
  expect(await finishVisibilityJob({...lease!,token:'99000000-0000-4000-8000-000000000001'},'completed','CHECKED',{})).toBe(false)
  expect(await finishVisibilityJob(lease!,'completed','CHECKED',{pages:[]})).toBe(true)
  expect((await h.pg!.query('select status from visibility_revalidation_attempts')).rows).toEqual([{status:'completed'}])
 })
 it('stores compact owned page baselines and rejects foreign writes',async()=>{
  const page={url:'https://example.com/a',observedAt:'2026-10-25T00:00:00Z',method:'visibility-page.v1' as const,collection:'complete' as const,httpStatus:200,canonicalState:'missing' as const,noindex:false,titlePresent:true,contentHash:'a'.repeat(64),limitations:[]}
  await expect(saveVisibilityPageSnapshot(wrong,page,'manual',actor)).rejects.toThrow('VISIBILITY_NOT_FOUND')
  await saveVisibilityPageSnapshot(scope,page,'manual',actor)
  expect((await h.pg!.query('select url from visibility_page_snapshots')).rows).toEqual([{url:page.url}])
 })
 it('repairs expired leases visibly and refuses foreign waiting-job completion',async()=>{
  await h.pg!.query("insert into outcome_deployments values($1,$2,$3,now(),$4)",[observation,account,client,JSON.stringify(['https://example.com/a'])])
  const job=await enqueueVisibilitySource(scope,'deployment',observation,actor),lease=await claimVisibilityJob(scope,job.id)
  await h.pg!.query("update visibility_revalidations set lease_until=now()-interval '1 minute' where id=$1",[job.id])
  expect(await repairVisibilityLeases()).toBe(1)
  expect((await h.pg!.query('select status,reason from visibility_revalidation_attempts')).rows).toEqual([{status:'unknown',reason:'ATTEMPT_INTERRUPTED'}])
  expect(await finishVisibilityJob(lease!,'completed','LATE',{})).toBe(false)
  const next=await claimVisibilityJob(scope,job.id)
  expect(next?.attempt).toBe(2)
  await finishVisibilityJob(next!,'waiting','PULSE_PENDING',{pages:[]},run)
  expect(await finishWaitingVisibilityJob(wrong,job.id,run,'completed','CHECKED',{ai:{comparable:false}})).toBe(false)
  expect(await finishWaitingVisibilityJob(scope,job.id,run,'completed','CHECKED',{ai:{comparable:false}})).toBe(true)
 })
 it('updates owned query context and rejects a foreign query/competitor',async()=>{
  const input=parseMonitoredQuery({promptId:prompt,locale:'zh-HK',market:'HK',persona:'Buyer',intent:'comparison',funnel:'consideration',topic:'Services',targetUrl:'https://example.com/a',priority:2,branded:false,expectedAttributes:[],competitorIds:[]},'example.com')
  await expect(saveMonitoredQuery(wrong,input)).rejects.toThrow('VISIBILITY_NOT_FOUND')
  await saveMonitoredQuery(scope,input)
  const view=await loadVisibilityWorkspace(scope)
  expect(view?.queries[0]).toMatchObject({locale:'zh-HK',context_current:true})
  expect(view?.observations[0].question).toBe('Frozen question')
  expect(await loadVisibilityWorkspace(wrong)).toBeNull()
  await expect(saveMonitoredQuery(scope,{...input,competitorIds:['88000000-0000-4000-8000-000000000001']})).rejects.toThrow('VISIBILITY_REFERENCE_NOT_FOUND')
 })
 it('records an owned human assessment without rewriting provider evidence',async()=>{
  const review={observationId:observation,recommendation:'excluded',accuracy:'inaccurate',risk:'high',notes:'Checked first-party source'}
  await expect(saveVisibilityReview(wrong,actor,review)).rejects.toThrow('VISIBILITY_NOT_FOUND')
  await saveVisibilityReview(scope,actor,review)
  expect((await loadVisibilityWorkspace(scope))?.observations[0]).toMatchObject({recommendation:'excluded',accuracy:'inaccurate',risk:'high'})
  expect((await h.pg!.query('select raw_answer from pulse_item_attempts')).rows).toEqual([{raw_answer:'A source answer'}])
 })
 it('creates a reviewable immutable draft once and refuses foreign evidence',async()=>{
  await expect(createVisibilityDraft(wrong,actor,{observationId:observation,kind:'brief',locale:'en'})).rejects.toThrow('VISIBILITY_NOT_FOUND')
  const draft=await createVisibilityDraft(scope,actor,{observationId:observation,kind:'brief',locale:'en'})
  expect(await createVisibilityDraft(scope,actor,{observationId:observation,kind:'brief',locale:'en'})).toMatchObject({id:draft.id,state:'draft'})
  expect(draft.artifact).toContain('Frozen question')
  expect((await h.pg!.query('select id from visibility_drafts')).rows).toHaveLength(1)
 })
})
