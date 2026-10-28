import { PGlite } from '@electric-sql/pglite'
import { beforeAll,afterAll,describe,expect,it,vi,afterEach } from 'vitest'
import { enterpriseFixture,ids as i } from './fixture'
const h=vi.hoisted(()=>({pg:null as PGlite|null}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/db',()=>{const sql=(parts:TemplateStringsArray,...values:unknown[])=>{const text=parts.reduce((out,part,index)=>out+(index?`$${index}`:'')+part,'');return{text,values,then:(ok:(rows:unknown[])=>unknown,bad:(error:unknown)=>unknown)=>h.pg!.query(text,values).then(r=>r.rows).then(ok,bad)}};sql.transaction=(queries:{text:string;values:unknown[]}[])=>h.pg!.transaction(async tx=>{const results=[];for(const q of queries)results.push((await tx.query(q.text,q.values)).rows);return results});return{db:()=>sql}})
import { createEnterpriseAdapter,createAdapterRun,ingestAdapterObservation } from '@/lib/enterprise/adapters'
import { saveEnterpriseArtifact,decideEnterpriseArtifact,createExecutiveReport,publishEnterprisePortal,revokeEnterpriseResource,saveEnterpriseBranding,readEnterpriseArtifact } from '@/lib/enterprise/store'
import { discoverEnterprisePeriods,claimEnterprisePeriod,generateEnterprisePeriod,discoverEnterpriseEvents,repairEnterpriseLeases } from '@/lib/enterprise/cron'
import { createEnterpriseKey,authenticateEnterpriseApi,consumeEnterpriseApi } from '@/lib/enterprise/credentials'
import { signEnterpriseRequest } from '@/lib/enterprise/signature'
import { readPublicPortal } from '@/lib/enterprise/public-portal'
import { claimEnterpriseDelivery,finishEnterpriseDelivery,retryEnterpriseDelivery,retainEnterpriseRequest } from '@/lib/enterprise/delivery'
const scope={accountId:i.account,clientId:i.client},wrong={accountId:i.foreign,clientId:i.client}
afterEach(()=>vi.unstubAllEnvs())
beforeAll(async()=>{h.pg=await enterpriseFixture()});afterAll(async()=>h.pg?.close())
describe('actual scoped enterprise stores',()=>{
 it('freezes owned adapter context and accepts results once, rejecting foreign and changed replay',async()=>{
  await expect(createEnterpriseAdapter(wrong,i.manager,{name:'Connector',model:'own/model',temperature:0.2})).rejects.toThrow('ENTERPRISE_NOT_FOUND')
  const adapter=await createEnterpriseAdapter(scope,i.manager,{name:'Connector',model:'own/model',temperature:0.2})
  await expect(createAdapterRun(wrong,i.manager,String(adapter.id),[i.prompt])).rejects.toThrow('ENTERPRISE_NOT_FOUND')
  const run=await createAdapterRun(scope,i.manager,String(adapter.id),[i.prompt]);expect(run.manifest).toMatchObject({provenance:'connector_reported',items:[{locale:'en',market:'HK'}]})
  const input={eventId:i.request,runId:String(run.id),promptId:i.prompt,observedAt:new Date(Date.now()+100).toISOString(),actualModel:'own/model',answer:'A retained answer',citations:[{url:'https://example.com/a'}]}
  await expect(ingestAdapterObservation(wrong,String(adapter.id),input)).rejects.toThrow('ENTERPRISE_NOT_FOUND')
  expect(await ingestAdapterObservation(scope,String(adapter.id),input)).toMatchObject({status:'created'});expect(await ingestAdapterObservation(scope,String(adapter.id),input)).toMatchObject({status:'replayed'})
  await expect(ingestAdapterObservation(scope,String(adapter.id),{...input,answer:'Changed'})).rejects.toThrow('ENTERPRISE_CONFLICT')
  await expect(ingestAdapterObservation(scope,String(adapter.id),{...input,actualModel:'other'})).rejects.toThrow('ENTERPRISE_NOT_FOUND')
 })
 it('queues approved UTC periods once, commits reports and member deliveries atomically, and fences stale leases',async()=>{
  const artifact=await saveEnterpriseArtifact(scope,i.manager,'schedule',{name:'Weekly',cadence:'weekly',locale:'en',recipientIds:[i.manager],enabled:true,branding:{name:'Portal',companyName:'Agency',primaryColor:'#AABBCC',logoUrl:null,locale:'en'}})
  expect((await h.pg!.query('select enabled from enterprise_schedules')).rows).toEqual([{enabled:false}])
  await decideEnterpriseArtifact(scope,i.admin,{artifactId:String(artifact.id),decision:'approved',reason:'Review complete',requestId:i.request})
  await h.pg!.query("update enterprise_schedules set next_period_start=(date_trunc('week',clock_timestamp() at time zone 'UTC')-interval '7 days')::date")
  expect(await discoverEnterprisePeriods()).toEqual({queued:1,deferred:0});expect(await discoverEnterprisePeriods()).toEqual({queued:0,deferred:0})
  const [period]=(await h.pg!.query<{id:string}>('select id from enterprise_schedule_periods')).rows
  expect(await claimEnterprisePeriod(wrong,period.id)).toBeNull()
  const lease=await claimEnterprisePeriod(scope,period.id);expect(lease).not.toBeNull();expect(await claimEnterprisePeriod(scope,period.id)).toBeNull()
  await expect(generateEnterprisePeriod({...lease!,token:i.request})).rejects.toThrow('ENTERPRISE_LEASE_LOST')
  await generateEnterprisePeriod(lease!)
  const rows=(await h.pg!.query<{status:string;artifact_id:string}>('select status,artifact_id from enterprise_schedule_periods')).rows;expect(rows[0]).toMatchObject({status:'completed',artifact_id:expect.any(String)})
  expect((await h.pg!.query('select * from enterprise_deliveries')).rows).toHaveLength(1)
  expect((await h.pg!.query('select * from enterprise_portals')).rows).toHaveLength(0)
  expect((await h.pg!.query('select status from enterprise_attempts where job_kind=\'schedule\'')).rows).toEqual([{status:'succeeded'}])
  expect(await discoverEnterpriseEvents()).toBeGreaterThanOrEqual(0);expect(await discoverEnterpriseEvents()).toBe(0)
 })
 it('keeps delivery attempts visible, denies foreign/stale completion and caps retries',async()=>{
  const [delivery]=(await h.pg!.query<{id:string}>('select id from enterprise_deliveries limit 1')).rows
  expect(await claimEnterpriseDelivery(wrong,delivery.id)).toBeNull()
  const lease=await claimEnterpriseDelivery(scope,delivery.id);expect(lease).not.toBeNull()
  expect(await retainEnterpriseRequest({...lease!,accountId:i.foreign},'a'.repeat(64))).toBe(false);expect(await retainEnterpriseRequest(lease!,'a'.repeat(64))).toBe(true);expect(await retainEnterpriseRequest(lease!,'b'.repeat(64))).toBe(false)
  expect(await finishEnterpriseDelivery({...lease!,token:i.request},'succeeded','ACCEPTED',200)).toBe(false)
  expect(await finishEnterpriseDelivery(lease!,'unknown','DELIVERY_UNCONFIRMED',null)).toBe(true)
  await expect(retryEnterpriseDelivery(wrong,i.outsider,delivery.id)).rejects.toThrow('ENTERPRISE_CONFLICT')
  expect(await retryEnterpriseDelivery(scope,i.manager,delivery.id)).toMatchObject({queued:true})
  const next=await claimEnterpriseDelivery(scope,delivery.id);expect(next?.attempt).toBe(2)
  await h.pg!.query("update enterprise_deliveries set lease_until=clock_timestamp()-interval '1 minute' where id=$1",[delivery.id]);expect(await repairEnterpriseLeases()).toBe(1)
  expect(await finishEnterpriseDelivery(next!,'succeeded','ACCEPTED',200)).toBe(false)
  expect((await h.pg!.query('select status from enterprise_deliveries where id=$1',[delivery.id])).rows).toEqual([{status:'unknown'}])
 })
})


describe('real scoped signing credentials and portals',()=>{
 it('keeps encrypted credentials out of metadata, binds signatures and denies foreign clients and revoked issuers',async()=>{
  vi.stubEnv('GOOGLE_TOKEN_ENCRYPTION_KEY',Buffer.alloc(32,7).toString('base64'));vi.stubEnv('FEATURE_ENTERPRISE_OS','1')
  const key=await createEnterpriseKey(scope,i.manager,{name:'Integration',scopes:['outcomes:read'],adapterId:null})
  const rows=(await h.pg!.query('select ciphertext,key_id from enterprise_keys where id=$1',[key.id])).rows;expect(JSON.stringify(rows)).not.toContain(key.secret)
  const signed={timestamp:String(Math.floor(Date.now()/1000)),nonce:i.request,method:'GET',path:`/api/v1/clients/${i.client}/outcomes`,body:''}
  const request=new Request('https://app.example'+signed.path,{headers:{'x-aiso-key':key.id,'x-aiso-timestamp':signed.timestamp,'x-aiso-nonce':signed.nonce,'x-aiso-signature':signEnterpriseRequest(key.secret,signed)}})
  await expect(authenticateEnterpriseApi(request,i.otherClient,'outcomes:read','')).rejects.toThrow('UNAUTHENTICATED')
  await expect(authenticateEnterpriseApi(request,i.client,'reports:read','')).rejects.toThrow('ENTERPRISE_SCOPE_REQUIRED')
  const access=await authenticateEnterpriseApi(request,i.client,'outcomes:read','');expect(access.scope).toEqual(scope);await consumeEnterpriseApi(access,'outcomes:read');await expect(consumeEnterpriseApi(access,'outcomes:read')).rejects.toThrow('ENTERPRISE_REPLAY')
  await revokeEnterpriseResource(scope,i.manager,'key',key.id);await expect(authenticateEnterpriseApi(request,i.client,'outcomes:read','')).rejects.toThrow('UNAUTHENTICATED')
 })
 it('serves only approved current-entitlement portal snapshots and hides upstream logo secrets',async()=>{
  vi.stubEnv('FEATURE_ENTERPRISE_OS','1');vi.stubEnv('REPORT_SHARE_SECRET','s'.repeat(40))
  await saveEnterpriseBranding(scope,i.manager,{name:'Private',companyName:'Agency',primaryColor:'#AABBCC',logoUrl:'https://cdn.example.com/logo.png?key=logo-secret',locale:'en'})
  const date=new Date().toISOString().slice(0,10),report=await createExecutiveReport(scope,i.manager,{start:date,end:date},'en')
  await expect(publishEnterprisePortal(scope,i.manager,String(report.id))).rejects.toThrow('ENTERPRISE_APPROVAL_REQUIRED')
  await decideEnterpriseArtifact(scope,i.admin,{artifactId:String(report.id),decision:'approved',reason:'Approved exact snapshot',requestId:i.request})
  const link=await publishEnterprisePortal(scope,i.manager,String(report.id)),url=new URL(link.path,'https://app.example'),slug=url.pathname.split('/').at(-1)!
  const portal=await readPublicPortal(slug,'en',url.searchParams);expect(portal?.snapshot).toMatchObject({version:'executive-report.v1',retrieval:{status:'unavailable'}})
  expect(JSON.stringify(portal?.snapshot)).not.toContain('logo-secret');expect(portal?.snapshot.branding.logoUrl).toMatch(/^\/api\/enterprise\/portals\//)
  const invalid=new URLSearchParams(url.searchParams);invalid.set('accountId',i.foreign);expect(await readPublicPortal(slug,'en',invalid)).toBeNull();expect(await readPublicPortal(slug,'zh-HK',url.searchParams)).toBeNull()
  await h.pg!.query("update accounts set status='cancelled' where id=$1",[i.account]);expect(await readPublicPortal(slug,'en',url.searchParams)).toBeNull();await h.pg!.query("update accounts set status='active' where id=$1",[i.account])
  await revokeEnterpriseResource(scope,i.manager,'portal',link.id);expect(await readPublicPortal(slug,'en',url.searchParams)).toBeNull()
  const rotated=await publishEnterprisePortal(scope,i.manager,String(report.id)),fresh=new URL(rotated.path,'https://app.example');expect(fresh.searchParams.get('v')).toBe('2');expect(rotated.path).not.toBe(link.path);expect(await readPublicPortal(slug,'en',url.searchParams)).toBeNull();expect(await readPublicPortal(fresh.pathname.split('/').at(-1)!,'en',fresh.searchParams)).not.toBeNull()
 })
})


describe('least privilege application role',()=>{
 it('can create and review immutable owned artifacts while denying foreign point reads and direct edits',async()=>{
  await h.pg!.exec('set role aeo_app')
  try{
   const artifact=await saveEnterpriseArtifact(scope,i.manager,'executive_report',{version:'executive-report.v1',locale:'en'})
   expect(await readEnterpriseArtifact(wrong,String(artifact.id))).toBeNull()
   expect(await readEnterpriseArtifact(scope,String(artifact.id))).toMatchObject({id:artifact.id})
   expect(await decideEnterpriseArtifact(scope,i.admin,{artifactId:String(artifact.id),decision:'approved',reason:'Reviewed under application role',requestId:i.request})).toMatchObject({status:'created'})
   await expect(h.pg!.query("update enterprise_artifacts set payload='{}' where id=$1",[artifact.id])).rejects.toThrow()
  }finally{await h.pg!.exec('reset role')}
 })
})


describe('inherited defaults and historical executive evidence',()=>{
 it('removes inherited update/delete from append-only ledgers and delete from mutable records',async()=>{
  const immutable=['enterprise_role_events','enterprise_audit','enterprise_artifacts','enterprise_decisions','enterprise_adapter_runs','enterprise_adapter_observations','enterprise_events']
  const tables=(await h.pg!.query<{relname:string;can_update:boolean;can_delete:boolean}>("select c.relname,has_table_privilege('aeo_app',c.oid,'UPDATE') as can_update,has_table_privilege('aeo_app',c.oid,'DELETE') as can_delete from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'enterprise_%' and c.relkind='r'")).rows
  expect(tables.filter(row=>immutable.includes(row.relname)&&row.can_update)).toEqual([])
  expect(tables.filter(row=>!['enterprise_api_nonces','enterprise_api_windows'].includes(row.relname)&&row.can_delete)).toEqual([])
 })
 it('generates reports from legacy competitor refs lacking domains without inventing missing-domain attribution',async()=>{
  const date=new Date().toISOString().slice(0,10),brand={name:'Brand',domain:'example.com',competitorRefs:[{name:'Other',aliases:['Alias']}]}
  await h.pg!.query("insert into ai_observations(id,account_id,client_id,finished_at,snapshot,classification,classification_status,platform,actual_model,raw_answer,provider_citations,brand) values($1,$2,$3,clock_timestamp(),$4,$5,'classified','gpt-4o','model','An answer',$6,$7)",[i.request,i.account,i.client,JSON.stringify({question:'Which?',language:'en',market:'HK'}),JSON.stringify({brandMentioned:true,competitorsMentioned:['Other']}),JSON.stringify([{url:'https://other.example/a'}]),JSON.stringify(brand)])
  const report=await createExecutiveReport(scope,i.manager,{start:date,end:date},'en')
  expect(report.payload).toMatchObject({visibility:{observations:1,citationShare:0,competitorShareOfVoice:[{name:'Other',mentions:1}]}})
  await h.pg!.query("update ai_observations set brand=brand-'domain' where id=$1",[i.request])
  const withoutDomain=await createExecutiveReport(scope,i.manager,{start:date,end:date},'en')
  expect(withoutDomain.payload).toMatchObject({visibility:{answerPresence:1,citationShare:null,citationCoverage:0}})
 })
})
