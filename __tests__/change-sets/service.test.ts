import { beforeEach, expect, it, vi } from 'vitest'
import { submitAuthenticatedVersion, decideAuthenticatedVersion, listAuthenticatedVersions, readAuthenticatedVersion } from '@/lib/change-sets/service'
const m=vi.hoisted(()=>({profile:vi.fn(),submit:vi.fn(),decide:vi.fn(),list:vi.fn(),read:vi.fn(),liveSources:vi.fn(),ownedSource:vi.fn(),suggestions:vi.fn()}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/auth',()=>({getProfile:m.profile}))
vi.mock('@/lib/change-sets/store',()=>({submitVersion:m.submit,listVersions:m.list,readVersion:m.read}))
vi.mock('@/lib/approvals/decision-store',()=>({decideVersion:m.decide}))
vi.mock('@/lib/work-items/sources',()=>({listLiveSources:m.liveSources}))
vi.mock('@/lib/work-items/store',()=>({loadOwnedDraftSource:m.ownedSource}))
vi.mock('@/lib/opportunities/rules',()=>({deriveSuggestions:m.suggestions}))
const id='11111111-1111-4111-8111-111111111111'
const request=(body:string)=>new Request('https://example.test',{method:'POST',body})
const decisionBody=JSON.stringify({decision:'approved',reason:'Reason',requestId:id})
beforeEach(()=>{vi.resetAllMocks();m.profile.mockResolvedValue({id,account_id:id});m.liveSources.mockResolvedValue([])})
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
it('refuses a decision when a live source no longer derives a matching fingerprint',async()=>{
 m.liveSources.mockResolvedValue([{opportunityKey:'a',sourceKind:'scan-check',sourceId:id,ruleVersion:'scan-check-gap.v1',checkKey:'c9_meta_desc',fingerprint:'a'.repeat(64),snapshot:{}}])
 m.ownedSource.mockResolvedValue({source:{kind:'scan-check'},version:'v'})
 m.suggestions.mockReturnValue([{key:'a',fingerprint:'b'.repeat(64)}])
 const r=await decideAuthenticatedVersion(id,id,id,request(decisionBody))
 expect(r.status).toBe(409);expect(await r.json()).toEqual({error:'EVIDENCE_CHANGED',staleOpportunityKeys:['a']})
 expect(m.decide).not.toHaveBeenCalled()
})
it('names every stale source, not just the first',async()=>{
 m.liveSources.mockResolvedValue([
  {opportunityKey:'a',sourceKind:'scan-check',sourceId:id,ruleVersion:'scan-check-gap.v1',checkKey:'c9_meta_desc',fingerprint:'a'.repeat(64),snapshot:{}},
  {opportunityKey:'b',sourceKind:'pulse-metric',sourceId:id,ruleVersion:'pulse-brand-absent.v1',checkKey:null,fingerprint:'c'.repeat(64),snapshot:{}},
 ])
 m.ownedSource.mockResolvedValue(null)
 const r=await decideAuthenticatedVersion(id,id,id,request(decisionBody))
 expect((await r.json()).staleOpportunityKeys).toEqual(['a','b'])
})
it('proceeds to decide when every live source still derives a matching fingerprint',async()=>{
 m.liveSources.mockResolvedValue([{opportunityKey:'a',sourceKind:'scan-check',sourceId:id,ruleVersion:'scan-check-gap.v1',checkKey:'c9_meta_desc',fingerprint:'a'.repeat(64),snapshot:{}}])
 m.ownedSource.mockResolvedValue({source:{kind:'scan-check'},version:'v'})
 m.suggestions.mockReturnValue([{key:'a',fingerprint:'a'.repeat(64)}])
 m.decide.mockResolvedValue({kind:'created',value:{id}})
 const r=await decideAuthenticatedVersion(id,id,id,request(decisionBody))
 expect(r.status).toBe(201);expect(m.decide).toHaveBeenCalledTimes(1)
})
it('omits checkKey rather than passing it null, matching SourceRef',async()=>{
 // lib/opportunities/types.ts declares SourceRef.checkKey optional, not
 // nullable -- a pulse-metric source never carries one.
 m.liveSources.mockResolvedValue([{opportunityKey:'a',sourceKind:'pulse-metric',sourceId:id,ruleVersion:'pulse-brand-absent.v1',checkKey:null,fingerprint:'a'.repeat(64),snapshot:{}}])
 m.ownedSource.mockResolvedValue({source:{kind:'pulse-metric'},version:'v'})
 m.suggestions.mockReturnValue([{key:'a',fingerprint:'a'.repeat(64)}])
 m.decide.mockResolvedValue({kind:'created',value:{id}})
 await decideAuthenticatedVersion(id,id,id,request(decisionBody))
 expect(m.ownedSource).toHaveBeenCalledWith(id,id,{kind:'pulse-metric',id})
})
it('treats an unowned or vanished source as stale rather than throwing',async()=>{
 m.liveSources.mockResolvedValue([{opportunityKey:'a',sourceKind:'scan-check',sourceId:id,ruleVersion:'scan-check-gap.v1',checkKey:'c9_meta_desc',fingerprint:'a'.repeat(64),snapshot:{}}])
 m.ownedSource.mockResolvedValue(null)
 const r=await decideAuthenticatedVersion(id,id,id,request(decisionBody))
 expect(r.status).toBe(409);expect((await r.json()).staleOpportunityKeys).toEqual(['a']);expect(m.suggestions).not.toHaveBeenCalled()
})
it('blocks changes_requested on stale evidence too, not only approval',async()=>{
 m.liveSources.mockResolvedValue([{opportunityKey:'a',sourceKind:'scan-check',sourceId:id,ruleVersion:'scan-check-gap.v1',checkKey:'c9_meta_desc',fingerprint:'a'.repeat(64),snapshot:{}}])
 m.ownedSource.mockResolvedValue(null)
 const r=await decideAuthenticatedVersion(id,id,id,request(JSON.stringify({decision:'changes_requested',reason:'Reason',requestId:id})))
 expect(r.status).toBe(409);expect(m.decide).not.toHaveBeenCalled()
})
