vi.mock('server-only',()=>({}))
import { beforeEach, expect, it, vi } from 'vitest'
const mocks=vi.hoisted(()=>({profile:vi.fn(),owner:vi.fn(),find:vi.fn(),read:vi.fn(),list:vi.fn(),update:vi.fn(),source:vi.fn(),create:vi.fn()}))
vi.mock('@/lib/auth',()=>({getProfile:mocks.profile}))
vi.mock('@/lib/work-items/store',()=>({loadOwnedDraftClient:mocks.owner,findOwnedDraft:mocks.find,readOwnedDraft:mocks.read,listOwnedDrafts:mocks.list,updateOwnedDraft:mocks.update,loadOwnedDraftSource:mocks.source,createDraftIfEvidenceCurrent:mocks.create}))
import { GET, POST } from '@/app/api/clients/[clientId]/work-items/route'
import { GET as read, PATCH } from '@/app/api/clients/[clientId]/work-items/[workItemId]/route'
const id='00000000-0000-4000-8000-000000000001'
beforeEach(()=>{vi.clearAllMocks();mocks.profile.mockResolvedValue(null)})
it('all work item routes authenticate and return safe no-store errors',async()=>{
 const request=new Request('http://localhost/api/clients/bad/work-items')
 for(const handler of [GET,POST,read,PATCH]) {
  const response=await handler(request,{params:Promise.resolve({clientId:'bad',workItemId:'bad'})})
  expect(response.status).toBe(401)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.json()).toEqual({error:'UNAUTHENTICATED'})
 }
})
it('routes wrap owned replay/read/list/edit results with no-store',async()=>{
 mocks.profile.mockResolvedValue({id,account_id:id});mocks.owner.mockResolvedValue({id})
 const item={id,revision:2};mocks.find.mockResolvedValue(item);mocks.read.mockResolvedValue(item);mocks.list.mockResolvedValue({items:[item],nextCursor:null});mocks.update.mockResolvedValue(item)
 const ctx={params:Promise.resolve({clientId:id,workItemId:id})}
 const post=await POST(new Request('http://localhost',{method:'POST',body:JSON.stringify({source:{kind:'pulse-metric',id},ruleVersion:'pulse-brand-absent.v1',fingerprint:'a'.repeat(64),locale:'en'})}),ctx)
 const patch=await PATCH(new Request('http://localhost',{method:'PATCH',body:JSON.stringify({title:'Review',action:'Check',notes:'',expectedRevision:1})}),ctx)
 for(const response of [post,patch,await read(new Request('http://localhost'),ctx)]) {
  expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');expect(await response.json()).toEqual({item})
 }
 expect(await (await GET(new Request('http://localhost'),ctx)).json()).toEqual({items:[item],nextCursor:null})
})
it('returns 201 only for a confirmed insertion',async()=>{
 const {projectPulseOpportunityInput}=await import('@/lib/opportunities/store')
 const {deriveSuggestions}=await import('@/lib/opportunities/rules')
 const source=projectPulseOpportunityInput(id,{id,client_id:id,prompt_id:null,question:'Question?',platform:'chatgpt',scan_week:'2026-08-31',created_at:null,raw_answer:'PRIVATE',brand_mentioned:false,has_answer:true})
 const suggestion=deriveSuggestions(source.source)[0]
 mocks.profile.mockResolvedValue({id,account_id:id});mocks.owner.mockResolvedValue({id});mocks.find.mockResolvedValue(null);mocks.source.mockResolvedValue(source);mocks.create.mockResolvedValue({item:{id},created:true})
 const response=await POST(new Request('http://localhost',{method:'POST',body:JSON.stringify({source:suggestion.source,ruleVersion:suggestion.ruleVersion,fingerprint:suggestion.fingerprint,locale:'en'})}),{params:Promise.resolve({clientId:id})})
 expect(response.status).toBe(201)
 expect(await response.json()).toEqual({item:{id}})
 expect(response.headers.get('cache-control')).toBe('no-store')
})
