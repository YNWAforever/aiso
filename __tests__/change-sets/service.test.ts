import { beforeEach, expect, it, vi } from 'vitest'
import { submitAuthenticatedVersion, decideAuthenticatedVersion, listAuthenticatedVersions, readAuthenticatedVersion } from '@/lib/change-sets/service'
const m=vi.hoisted(()=>({profile:vi.fn(),submit:vi.fn(),decide:vi.fn(),list:vi.fn(),read:vi.fn()}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/auth',()=>({getProfile:m.profile}))
vi.mock('@/lib/change-sets/store',()=>({submitVersion:m.submit,listVersions:m.list,readVersion:m.read}))
vi.mock('@/lib/approvals/decision-store',()=>({decideVersion:m.decide}))
const id='11111111-1111-4111-8111-111111111111'
const request=(body:string)=>new Request('https://example.test',{method:'POST',body})
beforeEach(()=>{vi.resetAllMocks();m.profile.mockResolvedValue({id,account_id:id})})
it.each(['created','replayed'])('submission %s has correct status and no-store',async(kind)=>{m.submit.mockResolvedValue({kind,value:{id}});const r=await submitAuthenticatedVersion(id,id,request('{"expectedRevision":1}'));expect(r.status).toBe(kind==='created'?201:200);expect(r.headers.get('Cache-Control')).toBe('no-store');expect(await r.json()).toEqual({version:{id}})})
it('authenticates independently before body/store',async()=>{m.profile.mockResolvedValue(null);for(const r of [await submitAuthenticatedVersion(id,id,request('bad')),await decideAuthenticatedVersion(id,id,id,request('bad')),await listAuthenticatedVersions(id,id,new URLSearchParams()),await readAuthenticatedVersion(id,id,id)]){expect(r.status).toBe(401);expect(r.headers.get('Cache-Control')).toBe('no-store')}expect(m.submit).not.toHaveBeenCalled()})
it.each([['not_found',404],['denied',403],['conflict',409],['validation_failed',422]])('maps %s',async(kind,status)=>{m.submit.mockResolvedValue({kind});expect((await submitAuthenticatedVersion(id,id,request('{"expectedRevision":1}'))).status).toBe(status)})
it('rejects caller content and actual streamed whitespace overflow',async()=>{expect((await submitAuthenticatedVersion(id,id,request('{"expectedRevision":1,"content":{}}'))).status).toBe(400);expect((await submitAuthenticatedVersion(id,id,request(' '.repeat(4097)))) .status).toBe(413);expect((await decideAuthenticatedVersion(id,id,id,request(' '.repeat(16385)))).status).toBe(413);expect(m.submit).not.toHaveBeenCalled();expect(m.decide).not.toHaveBeenCalled()})
it('returns safe no-store unavailable on persistence failure',async()=>{m.submit.mockRejectedValue(new Error('secret'));const r=await submitAuthenticatedVersion(id,id,request('{"expectedRevision":1}'));expect(r.status).toBe(503);expect(await r.text()).not.toContain('secret');expect(r.headers.get('Cache-Control')).toBe('no-store')})
it('delegates independently authenticated history and detail reads with owned identifiers',async()=>{
 m.list.mockResolvedValue({kind:'created',value:{versions:[],nextCursor:null,latestVersionId:null}});m.read.mockResolvedValue({kind:'created',value:{id}})
 const list=await listAuthenticatedVersions(id,id,new URLSearchParams('limit=2'));expect(list.status).toBe(200);expect(await list.json()).toEqual({versions:[],nextCursor:null,latestVersionId:null});expect(m.list).toHaveBeenCalledWith(id,id,id,id,{limit:2,cursor:null})
 const read=await readAuthenticatedVersion(id,id,id);expect(read.status).toBe(200);expect(await read.json()).toEqual({version:{id}});expect(m.read).toHaveBeenCalledWith(id,id,id,id,id)
})
it.each(['created','replayed'])('returns decision %s response with normalized reason and no-store',async(kind)=>{
 m.decide.mockResolvedValue({kind,value:{id}});const r=await decideAuthenticatedVersion(id,id,id,request(JSON.stringify({decision:'changes_requested',reason:'  Reason  ',requestId:id})))
 expect(r.status).toBe(kind==='created'?201:200);expect(r.headers.get('Cache-Control')).toBe('no-store');expect(m.decide).toHaveBeenCalledWith(id,id,id,id,id,{decision:'changes_requested',reason:'Reason',requestId:id})
})
