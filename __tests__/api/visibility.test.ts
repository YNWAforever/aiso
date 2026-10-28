import { beforeEach,describe,expect,it,vi } from 'vitest'
const h=vi.hoisted(()=>({authorize:vi.fn(),read:vi.fn(),query:vi.fn(),review:vi.fn(),draft:vi.fn(),setting:vi.fn(),enqueue:vi.fn(),retry:vi.fn(),snapshot:vi.fn(),page:vi.fn()}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/visibility/guard',()=>({authorizeVisibilityClient:h.authorize}))
vi.mock('@/lib/visibility/store',()=>({loadVisibilityWorkspace:h.read,saveMonitoredQuery:h.query,saveVisibilityReview:h.review,createVisibilityDraft:h.draft}))
vi.mock('@/lib/visibility/jobs',()=>({setVisibilityAutomation:h.setting,enqueueVisibilitySource:h.enqueue,retryVisibilityJob:h.retry,saveVisibilityPageSnapshot:h.snapshot}))
vi.mock('@/lib/visibility/page',()=>({validateVisibilityPage:h.page}))
import { mutateVisibility,readVisibility } from '@/lib/visibility/service'
import { OutcomeError } from '@/lib/outcome-integrations/input'
const scope={accountId:'account',clientId:'client'},id='77000000-0000-4000-8000-000000000001'
const request=(body:unknown)=>new Request('https://app.example/api/clients/client/visibility',{method:'POST',body:JSON.stringify(body)})
beforeEach(()=>{vi.clearAllMocks();h.authorize.mockResolvedValue({scope,profile:{id:'member'},client:{domain:'example.com'}});h.read.mockResolvedValue({observations:[],report:{answerPresence:null}});h.setting.mockResolvedValue({autoRetest:true});h.enqueue.mockResolvedValue({id})})
describe('visibility API contracts',()=>{
 it('reads owned observations and distinguishes unknown results',async()=>{
  const response=await readVisibility('client');expect(response.status).toBe(200);expect(h.read).toHaveBeenCalledWith(scope)
 })
 it.each(['queries','reviews','drafts','automation','baseline','revalidate','retry'])('denies a foreign %s action before writes or fetches',async action=>{
  h.authorize.mockRejectedValue(new OutcomeError('VISIBILITY_NOT_FOUND',404))
  expect((await mutateVisibility('foreign',action,request({}))).status).toBe(404)
  for(const writer of [h.query,h.review,h.draft,h.setting,h.enqueue,h.retry,h.snapshot,h.page])expect(writer).not.toHaveBeenCalled()
 })
 it.each(['queries','reviews','drafts','automation','baseline','revalidate','retry'])('rejects malformed %s input before writes or outbound calls',async action=>{
  expect((await mutateVisibility('client',action,request({accountId:'foreign'}))).status).toBe(400)
  for(const writer of [h.query,h.review,h.draft,h.setting,h.enqueue,h.retry,h.snapshot,h.page])expect(writer).not.toHaveBeenCalled()
 })
 it('records explicit automation consent and does not start a provider request',async()=>{
  expect((await mutateVisibility('client','automation',request({enabled:true}))).status).toBe(200)
  expect(h.setting).toHaveBeenCalledWith(scope,'member',true);expect(h.page).not.toHaveBeenCalled()
 })
 it('enqueues an owned source with the authenticated requester',async()=>{
  expect((await mutateVisibility('client','revalidate',request({sourceKind:'deployment',sourceId:id}))).status).toBe(201)
  expect(h.enqueue).toHaveBeenCalledWith(scope,'deployment',id,'member')
 })
})
