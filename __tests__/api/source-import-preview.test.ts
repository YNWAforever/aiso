import { beforeEach,expect,it,vi } from 'vitest'
vi.mock('server-only',()=>({}))
const mocks=vi.hoisted(()=>({profile:vi.fn(),owner:vi.fn(),sql:vi.fn(),write:vi.fn()}))
vi.mock('@/lib/auth',()=>({getProfile:mocks.profile}))
vi.mock('@/lib/db',()=>({db:()=>mocks.sql}))
vi.mock('@/lib/work-items/store',()=>({loadOwnedDraftClient:mocks.owner}))
vi.mock('@/lib/sources/store',()=>({importSource:mocks.write}))
import { importClientSource,previewClientSource } from '@/lib/sources/service'
const request=(body:unknown)=>new Request('https://fixture.test',{method:'POST',body:JSON.stringify(body)})
beforeEach(()=>{vi.clearAllMocks();mocks.profile.mockResolvedValue({id:'actor',account_id:'account'});mocks.owner.mockResolvedValue({id:'client'});mocks.sql.mockResolvedValue([{latest_version:7}]);mocks.write.mockResolvedValue({kind:'created',source:{},approval:'not-requested'})})
it('preview is scoped, read-only and records current version independently of agent permission',async()=>{
 const result=await previewClientSource('client',request({sourceKey:'facts',csv:'Hours?,Open\nWhere?,'}))
 expect(result.status).toBe(200);expect(await result.json()).toMatchObject({validCount:1,invalidCount:1,expectedLatestVersion:7})
 expect(mocks.sql.mock.calls[0].slice(1)).toEqual(['account','client','facts'])
 expect(mocks.write).not.toHaveBeenCalled()
 mocks.owner.mockResolvedValue(null)
 expect((await previewClientSource('foreign',request({sourceKey:'facts',csv:'Hours?,Open'}))).status).toBe(404)
})
it('formal import rejects a retry subset, unresolved duplicates and missing version precondition',async()=>{
 const base={sourceKey:'facts',label:'Facts',kind:'faq',importMethod:'csv',expectedLatestVersion:7,previewRowCount:2,previewContentHash:null}
 for(const extra of [{entries:[{question:'Hours?',answer:'Open'}]},{entries:[{question:'Hours?',answer:'Open'},{question:'Hours?',answer:'Closed'}]},{expectedLatestVersion:undefined,entries:[{question:'Hours?',answer:'Open'},{question:'Where?',answer:'HK'}]}])expect((await importClientSource('client',request({...base,...extra}))).status).toBe(400)
 expect(mocks.write).not.toHaveBeenCalled()
 const response=await importClientSource('client',request({...base,entries:[{question:'Hours?',answer:'Open'},{question:'Where?',answer:'HK'}]}))
 expect(response.status).toBe(201);expect(mocks.write.mock.calls[0][1]).toMatchObject({expectedLatestVersion:7,approve:false,entries:expect.any(Array)})
 expect(mocks.write.mock.calls[0][1].entries).toHaveLength(2)
})
it('preview rejects oversized bytes, malformed retries and anonymous access without writes',async()=>{
 expect((await previewClientSource('client',request({sourceKey:'facts',csv:'x'.repeat(262144)}))).status).toBe(413)
 expect((await previewClientSource('client',request({sourceKey:'facts',rows:{}}))).status).toBe(400)
 mocks.profile.mockResolvedValue(null)
 expect((await previewClientSource('client',request({}))).status).toBe(401)
 expect(mocks.write).not.toHaveBeenCalled()
})
