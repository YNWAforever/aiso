import { draft, saved, itemId } from './fixtures'
import { beforeEach, expect, it, vi } from 'vitest'
import { submitVersion, listVersions } from '@/lib/change-sets/store'
const m=vi.hoisted(()=>({sql:vi.fn(),transaction:vi.fn(),draft:vi.fn()}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/db',()=>({db:()=>Object.assign(m.sql,{transaction:m.transaction})}))
vi.mock('@/lib/work-items/store',()=>({readOwnedDraft:m.draft}))
const id='11111111-1111-4111-8111-111111111111'
beforeEach(()=>{vi.resetAllMocks();m.sql.mockReturnValue([]);m.draft.mockResolvedValue(null)})
it.each(['not_found','denied','conflict','validation_failed'])('returns locked %s without success fabrication',async(kind)=>{m.transaction.mockResolvedValue([[],[],[{kind}]]);expect(await submitVersion(id,id,id,id,1)).toEqual({kind})})
it('keeps same-revision replay before validation and exact INSERT SELECT under initialized locks',async()=>{
 m.draft.mockRejectedValue(new Error('INVALID_DRAFT_SNAPSHOT'));m.transaction.mockResolvedValue([[],[],[{kind:'validation_failed'}]])
 await submitVersion(id,id,id,id,1)
 const statements=m.sql.mock.calls.map(c=>(c[0] as string[]).join('?'))
 expect(statements[1]).toContain('FOR SHARE');expect(statements[1]).toContain("set_config('aiso.version_actor_locked'")
 expect(statements[2]).toContain('FOR UPDATE');expect(statements[2]).toContain("set_config('aiso.version_item_locked'")
 const mutation=statements.at(-1)!
 expect(mutation.indexOf('FROM replay')).toBeLessThan(mutation.indexOf("THEN 'validation_failed'"))
 for(const text of ['d.title =','d.action =','d.notes =','d.locale =','jsonb_agg(s.evidence_snapshot','s.withdrawn_at IS NULL','d.revision =','max(version_number)','current_setting','p.account_id ='])expect(mutation).toContain(text)
 expect(mutation).not.toContain('UPDATE evidence_work_items')
})
it('fails closed on persistence and retries only transaction errors twice',async()=>{m.transaction.mockRejectedValue({code:'40001'});await expect(submitVersion(id,id,id,id,1)).rejects.toThrow('CHANGE_SET_UNAVAILABLE');expect(m.transaction).toHaveBeenCalledTimes(3)})
it('rejects malformed opaque cursors before querying',async()=>{await expect(listVersions(id,id,id,id,{limit:20,cursor:'wrong'})).rejects.toThrow('INVALID_CHANGE_SET_INPUT');expect(m.sql).not.toHaveBeenCalled()})

it('replays retained revision after newer malformed draft without replacing content',async()=>{
 const row=await saved();m.draft.mockRejectedValue(new Error('INVALID_DRAFT_SNAPSHOT'));m.transaction.mockResolvedValue([[],[],[{kind:'replayed',value:row}]])
 const r=await submitVersion(id,id,itemId,id,1);expect(r).toMatchObject({kind:'replayed',value:{draftRevision:1,title:'Review question coverage'}})
})
it.each([0,2])('stale/future unsubmitted pre-read revision %s cannot supply INSERT content',async(delta)=>{
 m.draft.mockResolvedValue({...draft(),revision:delta+1});m.transaction.mockResolvedValue([[],[],[{kind:'conflict'}]])
 const r=await submitVersion(id,id,itemId,id,2);expect(r).toEqual({kind:'conflict'})
 const values=m.sql.mock.calls.at(-1)!.slice(1);expect(values).not.toContain('Review question coverage')
})
it('supplied forged content cannot enter exact INSERT SELECT',async()=>{
 const {freezeReview}=await import('@/lib/change-sets/validation');m.draft.mockResolvedValue(draft());m.transaction.mockResolvedValue([[],[],[{kind:'validation_failed'}]])
 const f=freezeReview(draft());f.content.title='Forged'
 expect(await submitVersion(id,id,itemId,id,1,f)).toEqual({kind:'validation_failed'});expect(m.sql.mock.calls.at(-1)!.slice(1)).not.toContain('Forged')
})
it('new immutable version includes canonical content while exact comparison failure remains conflict',async()=>{
 const row=await saved();m.draft.mockResolvedValue(draft());m.transaction.mockResolvedValueOnce([[],[],[{kind:'created',value:row}]]).mockResolvedValueOnce([[],[],[{kind:'conflict'}]])
 expect(await submitVersion(id,id,itemId,id,1)).toMatchObject({kind:'created',value:{id,title:draft().title}})
 expect(await submitVersion(id,id,itemId,id,1)).toEqual({kind:'conflict'})
 const values=m.sql.mock.calls.at(-1)!.slice(1);expect(values).toContain(draft().title)
 // The single bound `content` value is the exact serialized ReviewContentV1 --
 // it carries evidenceSnapshot nested inside it, which is what matters here.
 // (The separate aggregate-comparison parameter is [] in this mock, since
 // listLiveSources's own m.sql call is not individually seeded above; that
 // property -- the aggregate reflecting real live rows -- is proven against
 // real Postgres in __tests__/integration/work-item-sources.test.ts instead.)
 const contentValue=values.find((v): v is string => typeof v==='string' && v.includes('"evidenceSnapshot"'))
 expect(contentValue).toBeDefined()
 expect(JSON.parse(contentValue!).evidenceSnapshot).toEqual(draft().evidenceSnapshot)
})
it('validates persisted content/hash/actor and validation rather than exposing corrupt saved rows',async()=>{
 const {versionDTO}=await import('@/lib/change-sets/store');const row=await saved()
 for(const corrupt of [{...row,content_hash:'b'.repeat(64)},{...row,content:{...row.content,locale:'fr'}},{...row,validation:{}},{...row,submitter:{...row.submitter,profileId:'wrong'}},{...row,version_number:0}])expect(()=>versionDTO(corrupt)).toThrow('CHANGE_SET_UNAVAILABLE')
})
it('paginates summaries without full content and computes latest outside cursor filtering',async()=>{
 const row=await saved();const second={...row,id:itemId,version_number:2};m.sql.mockReturnValue([{owned:true,latest_id:itemId,versions:[second,row]}])
 const result=await listVersions(id,id,itemId,id,{limit:1,cursor:null});expect(result).toMatchObject({kind:'created',value:{latestVersionId:itemId,versions:[{versionNumber:2}]}})
 if(!('value' in result))throw new Error('expected page')
 expect(result.value.versions[0]).not.toHaveProperty('content');expect(result.value.versions[0]).not.toHaveProperty('evidenceSnapshot');expect(result.value.versions[0]).not.toHaveProperty('title')
 expect(JSON.parse(Buffer.from(result.value.nextCursor!,'base64url').toString())).toEqual({before:2})
 const statement=(m.sql.mock.calls[0][0] as string[]).join('?');expect(statement.indexOf('latest AS MATERIALIZED')).toBeLessThan(statement.indexOf('page AS'))
 expect(statement).not.toContain('FROM pulse_metrics');expect(statement).not.toContain('FROM scans')
})
it('distinguishes owned empty history from tenant miss and malformed stored rows',async()=>{
 m.sql.mockReturnValueOnce([{owned:true,latest_id:null,versions:[]}]).mockReturnValueOnce([{owned:false,versions:[]}]).mockReturnValueOnce([{owned:true,versions:[{}]}])
 expect(await listVersions(id,id,itemId,id,{limit:20,cursor:null})).toMatchObject({value:{versions:[],nextCursor:null,latestVersionId:null}})
 expect(await listVersions(id,id,itemId,id,{limit:20,cursor:null})).toEqual({kind:'not_found'})
 await expect(listVersions(id,id,itemId,id,{limit:20,cursor:null})).rejects.toThrow('CHANGE_SET_UNAVAILABLE')
})
it('constructs lazy transaction queries without awaiting locks',async()=>{
 const then=vi.fn();m.sql.mockReturnValueOnce([]).mockReturnValue({then});m.transaction.mockResolvedValue([[],[],[{kind:'not_found'}]])
 await submitVersion(id,id,itemId,id,1);expect(then).not.toHaveBeenCalled();expect(m.transaction.mock.calls[0][1]).toEqual({isolationLevel:'ReadCommitted'})
})
it('does not load or revalidate newer draft at all when saved revision precheck exists',async()=>{
 const row=await saved();m.sql.mockReturnValueOnce([{id:row.id}]).mockReturnValue([]);m.transaction.mockResolvedValue([[],[],[{kind:'replayed',value:row}]])
 expect(await submitVersion(id,id,itemId,id,1)).toMatchObject({kind:'replayed'});expect(m.draft).not.toHaveBeenCalled()
})
it('retained history preserves unknown recorded time and nullable actor name without original source reads', async () => {
 const {readVersion, versionDTO}=await import('@/lib/change-sets/store')
 const row=await saved()
 const persisted=JSON.parse(JSON.stringify(row))
 const decoded=versionDTO(persisted);if(decoded.schemaVersion!==1)throw new Error('expected a v1 fixture')
 expect(decoded.evidenceSnapshot.evidence.recordedAt).toBeNull()
 m.sql.mockReturnValue([{owned:true,latest_id:row.id,versions:[persisted]}])
 const result=await readVersion(id,id,itemId,row.id,id)
 expect(result).toMatchObject({kind:'created',value:{submittedBy:{displayName:null},evidenceSnapshot:{evidence:{recordedAt:null,provenance:'retained-pulse-metric',promptId:null}}}})
 expect(m.draft).not.toHaveBeenCalled()
 const query=(m.sql.mock.calls[0][0] as string[]).join('?')
 expect(query).not.toMatch(/FROM (pulse_metrics|scans)/i)
})
it('writes schemaVersion 1 content when the multi-source flag is off, byte-identical to before 051',async()=>{
 delete process.env.WORK_ITEM_MULTI_SOURCE_V1
 m.draft.mockResolvedValue(draft());m.transaction.mockResolvedValue([[],[],[{kind:'validation_failed'}]])
 await submitVersion(id,id,itemId,id,1)
 const values=m.sql.mock.calls.at(-1)!.slice(1)
 const contentValue=values.find((v):v is string=>typeof v==='string'&&v.includes('"evidenceSnapshot"'))
 expect(contentValue).toBeDefined();expect(JSON.parse(contentValue!).schemaVersion).toBe(1)
 expect(contentValue).not.toContain('evidenceSnapshots')
})
it('writes schemaVersion 2 content with an array when the flag is on',async()=>{
 process.env.WORK_ITEM_MULTI_SOURCE_V1='1'
 try {
  m.draft.mockResolvedValue(draft());m.transaction.mockResolvedValue([[],[],[{kind:'validation_failed'}]])
  // Call order per invocation is [saved-check, listLiveSources, lock1, lock2,
  // write]. Seeding only the first two: listLiveSources must see a real row,
  // or freezeMultiSourceReview throws on an empty array before the write is
  // ever built.
  m.sql.mockReturnValueOnce([]).mockReturnValueOnce([{id:'source-1',opportunity_key:'k',source_kind:'pulse-metric',source_id:itemId,rule_version:'pulse-brand-absent.v1',check_key:null,evidence_fingerprint:'f'.repeat(64),evidence_snapshot:draft().evidenceSnapshot}])
  await submitVersion(id,id,itemId,id,1)
  const values=m.sql.mock.calls.at(-1)!.slice(1)
  const contentValue=values.find((v):v is string=>typeof v==='string'&&v.includes('"evidenceSnapshots"'))
  expect(contentValue).toBeDefined()
  const parsed=JSON.parse(contentValue!)
  expect(parsed.schemaVersion).toBe(2);expect(parsed.evidenceSnapshots).toEqual([draft().evidenceSnapshot])
 } finally { delete process.env.WORK_ITEM_MULTI_SOURCE_V1 }
})
