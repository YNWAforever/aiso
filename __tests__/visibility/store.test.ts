import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll,afterAll,beforeEach,describe,expect,it,vi } from 'vitest'
const h=vi.hoisted(()=>({pg:null as PGlite|null}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/db',()=>{
  const sql=(strings:TemplateStringsArray,...values:unknown[])=>{const text=strings.reduce((out,part,i)=>out+(i?`$${i}`:'')+part,'');return{text,values,then:(resolve:(rows:unknown[])=>unknown,reject:(error:unknown)=>unknown)=>h.pg!.query(text,values).then(result=>result.rows).then(resolve,reject)}}
  return{db:()=>sql}
})
import { saveMonitoredQuery,loadVisibilityWorkspace,saveVisibilityReview,createVisibilityDraft } from '@/lib/visibility/store'
import { parseMonitoredQuery } from '@/lib/visibility/input'
const account='11000000-0000-4000-8000-000000000001',foreign='11000000-0000-4000-8000-000000000002',client='22000000-0000-4000-8000-000000000001',other='22000000-0000-4000-8000-000000000002',actor='33000000-0000-4000-8000-000000000001',prompt='44000000-0000-4000-8000-000000000001',run='55000000-0000-4000-8000-000000000001',item='66000000-0000-4000-8000-000000000001',observation='77000000-0000-4000-8000-000000000001'
const scope={accountId:account,clientId:client},wrong={accountId:foreign,clientId:client}
beforeAll(async()=>{
 h.pg=await PGlite.create();await h.pg.exec(`create role aeo_app;
 create table accounts(id uuid primary key);
 create table clients(id uuid primary key,account_id uuid references accounts(id),domain text,unique(id,account_id));
 create table profiles(id uuid primary key,account_id uuid references accounts(id),deactivated_at timestamptz,unique(id,account_id));
 create table prompt_bank(id uuid primary key,client_id uuid references clients(id),question text,language text,market text,is_active boolean);
 create table competitors(id uuid primary key,account_id uuid,client_id uuid,name text,aliases text[],domains text[],archived_at timestamptz);
 create table pulse_runs(id uuid primary key,account_id uuid,client_id uuid,manifest jsonb,purpose text,created_at timestamptz default now(),unique(id,client_id,account_id));
 create table pulse_run_items(id uuid primary key,account_id uuid,client_id uuid,run_id uuid,prompt_snapshot_id uuid,platform text,snapshot jsonb,classification_status text,status text,accepted_attempt_id uuid);
 create table pulse_item_attempts(id uuid primary key,item_id uuid,account_id uuid,client_id uuid,requested_model text,actual_model text,finished_at timestamptz,raw_answer text,provider_citations jsonb,classification jsonb,collection_status text,accepted boolean,unique(id,item_id,client_id,account_id));`)
 await h.pg.exec(readFileSync('supabase/migrations/074_closed_loop_visibility.sql','utf8'))
})
afterAll(async()=>{await h.pg?.close()})
beforeEach(async()=>{
 await h.pg!.exec('truncate accounts cascade;truncate pulse_runs,pulse_run_items,pulse_item_attempts,competitors cascade')
 await h.pg!.query('insert into accounts values($1),($2)',[account,foreign])
 await h.pg!.query("insert into clients values($1,$2,'example.com'),($3,$4,'foreign.example')",[client,account,other,foreign])
 await h.pg!.query('insert into profiles(id,account_id) values($1,$2)',[actor,account])
 await h.pg!.query("insert into prompt_bank values($1,$2,'Which service?','en','HK',true,null)",[prompt,client])
 const monitoring={targetUrl:'https://example.com/a',intent:'comparison',expectedAttributes:['Evidence'],sampling:{temperature:0.2,samplesPerRun:1,seed:null}}
 await h.pg!.query("insert into pulse_runs(id,account_id,client_id,manifest,purpose) values($1,$2,$3,$4,'canonical')",[run,account,client,JSON.stringify({brand:{domain:'example.com',competitorRefs:[]}})])
 await h.pg!.query("insert into pulse_run_items values($1,$2,$3,$4,$5,'gpt-4o',$6,'classified','succeeded',$7)",[item,account,client,run,prompt,JSON.stringify({question:'Frozen question',language:'en',market:'HK',monitoring}),observation])
 await h.pg!.query("insert into pulse_item_attempts values($1,$2,$3,$4,'model','model',now(),'A source answer',$5,$6,'succeeded',true)",[observation,item,account,client,JSON.stringify([{url:'https://source.example/a'}]),JSON.stringify({brandMentioned:false,sentiment:'unknown',competitorsMentioned:[]})])
})
describe('actual SQL visibility boundaries',()=>{
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
