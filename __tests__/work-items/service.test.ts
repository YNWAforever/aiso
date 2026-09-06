vi.mock('server-only',()=>({}))
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ profile:vi.fn(), owner:vi.fn(), find:vi.fn(), source:vi.fn(), create:vi.fn(), update:vi.fn(), read:vi.fn(), list:vi.fn() }))
vi.mock('@/lib/auth',()=>({getProfile:mocks.profile}))
vi.mock('@/lib/work-items/store',()=>({loadOwnedDraftClient:mocks.owner,findOwnedDraft:mocks.find,loadOwnedDraftSource:mocks.source,createDraftIfEvidenceCurrent:mocks.create,updateOwnedDraft:mocks.update,readOwnedDraft:mocks.read,listOwnedDrafts:mocks.list}))
import { saveAuthenticatedDraft, editAuthenticatedDraft } from '@/lib/work-items/service'
import { projectPulseOpportunityInput } from '@/lib/opportunities/store'
import { deriveSuggestions } from '@/lib/opportunities/rules'
const id='00000000-0000-4000-8000-000000000001'
const projected=projectPulseOpportunityInput(id,{id,client_id:id,prompt_id:null,question:'Question?',platform:'chatgpt',scan_week:'2026-08-31',created_at:null,raw_answer:'PRIVATE',brand_mentioned:false,has_answer:true})
const suggestion=deriveSuggestions(projected.source)[0]
const input={source:suggestion.source,ruleVersion:suggestion.ruleVersion,fingerprint:suggestion.fingerprint,locale:'en'}
const request=(value:unknown)=>new Request('http://localhost',{method:'POST',body:JSON.stringify(value)})
beforeEach(()=>{vi.clearAllMocks();mocks.profile.mockResolvedValue({id,account_id:id});mocks.owner.mockResolvedValue({id});mocks.find.mockResolvedValue(null);mocks.source.mockResolvedValue(projected);mocks.create.mockResolvedValue(null);vi.spyOn(console,'error').mockImplementation(()=>{})})
 it('auth precedes invalid input and foreign owner precedes body parsing',async()=>{
  mocks.profile.mockResolvedValueOnce(null)
  await expect(saveAuthenticatedDraft('bad',request({}))).rejects.toMatchObject({status:401})
  expect(mocks.owner).not.toHaveBeenCalled()
  mocks.owner.mockResolvedValueOnce(null)
  await expect(saveAuthenticatedDraft(id,request({}))).rejects.toMatchObject({status:404})
 })
 it('replays an owned draft before missing or changed sources and ignores forged matching-format fingerprints for replay',async()=>{
  mocks.find.mockResolvedValue({id})
  expect(await saveAuthenticatedDraft(id,request({...input,fingerprint:'a'.repeat(64)}))).toEqual({item:{id},created:false})
  expect(mocks.source).not.toHaveBeenCalled()
 })
 it.each(['forged','missing','changed'])('rejects %s evidence',async mode=>{
  if(mode==='missing')mocks.source.mockResolvedValueOnce(null)
  await expect(saveAuthenticatedDraft(id,request(mode==='forged'?{...input,fingerprint:'a'.repeat(64)}:input))).rejects.toMatchObject({code:'EVIDENCE_CHANGED',status:409})
 })
 it('rejects recommendation inputs and caller-owned snapshot/generated text',async()=>{
  for(const value of [{...input,source:{kind:'agent-recommendation',id},ruleVersion:'stored-recommendation.v1'},{...input,evidenceSnapshot:{}},{...input,title:'forged'}]) await expect(saveAuthenticatedDraft(id,request(value))).rejects.toMatchObject({status:400})
  expect(mocks.create).not.toHaveBeenCalled()
 })
 it('caps actual streamed bytes regardless of content length, including trailing whitespace',async()=>{
  const body=JSON.stringify(input)+' '.repeat(4096)
  const req=new Request('http://localhost',{method:'POST',body,headers:{'content-length':'1'}})
  await expect(saveAuthenticatedDraft(id,req)).rejects.toMatchObject({status:400})
  expect(mocks.find).not.toHaveBeenCalled()
 })
 it('never leaks raw source answer into stored snapshots',async()=>{
  mocks.create.mockResolvedValueOnce({item:{id},created:true})
  expect(await saveAuthenticatedDraft(id,request(input))).toMatchObject({created:true})
  expect(JSON.stringify(mocks.create.mock.calls[0][4])).not.toContain('PRIVATE')
 })
 it('maps failed writes to safe 503 and rechecks ownership after lost conditional insert',async()=>{
  mocks.create.mockRejectedValueOnce(new Error('SQL PRIVATE'))
  await expect(saveAuthenticatedDraft(id,request(input))).rejects.toMatchObject({code:'WORK_ITEMS_UNAVAILABLE',status:503})
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('PRIVATE')
  mocks.owner.mockResolvedValueOnce({id}).mockResolvedValueOnce(null)
  await expect(saveAuthenticatedDraft(id,request(input))).rejects.toMatchObject({status:404})
 })
 it('normalizes edits and classifies missing vs stale/future conflicts',async()=>{
  mocks.update.mockResolvedValue(null);mocks.read.mockResolvedValue({id,revision:1})
  await expect(editAuthenticatedDraft(id,id,request({title:' Review ',action:' Check ',notes:'',expectedRevision:2}))).rejects.toMatchObject({code:'WORK_ITEM_CONFLICT',status:409})
  expect(mocks.update.mock.calls[0][4]).toMatchObject({title:'Review',action:'Check'})
  mocks.read.mockResolvedValueOnce(null)
  await expect(editAuthenticatedDraft(id,id,request({title:'Review',action:'Check',notes:'',expectedRevision:1}))).rejects.toMatchObject({status:404})
 })

it('caps edit raw bytes and rejects immutable fields before persistence',async()=>{
 for(const value of [{title:'Review',action:'Check',notes:'',expectedRevision:1,evidenceSnapshot:{}},{title:'Review',action:'Check',notes:'',expectedRevision:1,locale:'zh-HK'}]){
  await expect(editAuthenticatedDraft(id,id,request(value))).rejects.toMatchObject({status:400})
 }
 const req=new Request('http://localhost',{method:'PATCH',body:JSON.stringify({title:'Review',action:'Check',notes:'',expectedRevision:1})+' '.repeat(32768)})
 await expect(editAuthenticatedDraft(id,id,req)).rejects.toMatchObject({status:400})
 expect(mocks.update).not.toHaveBeenCalled()
})
it('returns identical-payload lost-response replay from persistence without snapshot rewriting',async()=>{
 const stored={id,revision:3,evidenceSnapshot:{retained:'original'}}
 mocks.update.mockResolvedValueOnce(stored)
 expect(await editAuthenticatedDraft(id,id,request({title:' Review ',action:'Check',notes:'',expectedRevision:2}))).toEqual({item:stored})
})
it('handles malformed UTF-8/JSON and missing-table failures with safe codes',async()=>{
 for(const data of ['{',new Uint8Array([0xff])]) {
  await expect(saveAuthenticatedDraft(id,new Request('http://localhost',{method:'POST',body:data}))).rejects.toMatchObject({status:400})
 }
 mocks.find.mockRejectedValueOnce(Object.assign(new Error('relation SECRET does not exist'),{code:'42P01'}))
 await expect(saveAuthenticatedDraft(id,request(input))).rejects.toMatchObject({code:'WORK_ITEMS_UNAVAILABLE',status:503})
})
