vi.mock('server-only',()=>({}))
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ sql: vi.fn(), transaction: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: () => Object.assign(mocks.sql, { transaction: mocks.transaction }) }))
import { createDraftIfEvidenceCurrent, updateOwnedDraft, listOwnedDrafts } from '@/lib/work-items/store'
import { projectPulseOpportunityInput } from '@/lib/opportunities/store'
import { deriveSuggestions } from '@/lib/opportunities/rules'
import { buildInitialDraftSnapshot } from '@/lib/work-items/snapshot'
import { opportunityKey, serializeDraftSnapshot } from '@/lib/opportunities/fingerprint'
const id = '00000000-0000-4000-8000-000000000001'
const account = '00000000-0000-4000-8000-000000000002'
const pulse = {id,client_id:id,prompt_id:null,question:'Question?',platform:'chatgpt',scan_week:'2026-08-31',created_at:'2026-09-01T00:00:00.123456Z',raw_answer:'PRIVATE ANSWER',brand_mentioned:false,has_answer:true}
const projected = projectPulseOpportunityInput(account,pulse)
const suggestion = deriveSuggestions(projected.source)[0]
const input = { source:suggestion.source,ruleVersion:suggestion.ruleVersion,fingerprint:suggestion.fingerprint,locale:'en' as const }
const snapshot = () => buildInitialDraftSnapshot(suggestion,projected.source,'en')
const row = () => ({id,client_id:id,status:'draft',title:'Review',action:'Check',notes:'',locale:'en',revision:2,created_at:pulse.created_at,updated_at:pulse.created_at,evidence_snapshot:snapshot(),account_id:account,raw_answer:'PRIVATE ANSWER'})
beforeEach(() => { vi.clearAllMocks(); mocks.sql.mockReturnValue(Promise.resolve([])) })
 it('conditionally inserts with exact source predicates and JSONB size, then a later owned replay', async () => {
  mocks.transaction.mockResolvedValue([[row()],[]])
  const result = await createDraftIfEvidenceCurrent(account,id,null,input,snapshot(),projected.version)
  expect(result?.created).toBe(true)
  expect(JSON.stringify(result)).not.toContain('PRIVATE ANSWER')
  const query = mocks.sql.mock.calls[0][0].join(' ')
  for (const field of ['question','raw_answer','brand_mentioned','platform','prompt_id','scan_week','created_at']) expect(query).toMatch(new RegExp(`m\\.${field} is not distinct from`))
  expect(query).toContain('octet_length(')
  expect(query).toContain('::jsonb::text')
  expect(mocks.sql.mock.calls[0].slice(1)).toContain('PRIVATE ANSWER')
  expect(mocks.transaction.mock.calls[0][1]).toEqual({isolationLevel:'ReadCommitted'})
 })
 it('returns the independently configured concurrent winner and no creation for changed/deleted evidence', async () => {
  mocks.transaction.mockResolvedValueOnce([[],[row()]]).mockResolvedValueOnce([[],[]])
  expect(await createDraftIfEvidenceCurrent(account,id,null,input,snapshot(),projected.version)).toMatchObject({created:false,item:{id}})
  expect(await createDraftIfEvidenceCurrent(account,id,null,input,snapshot(),projected.version)).toBeNull()
 })
 it('propagates failed SQL instead of returning replay success', async () => {
  mocks.transaction.mockRejectedValue(new Error('failed sql'))
  await expect(createDraftIfEvidenceCurrent(account,id,null,input,snapshot(),projected.version)).rejects.toThrow('failed sql')
 })
 it('lands the item insert and its source insert in one atomic statement, not a second awaited call', async () => {
  // Would silently pass without this: a version that writes work_item_sources via a
  // second `await sql\`...\`` AFTER `sql.transaction([mutation,replay])` resolves would
  // still look correct on the happy path, but leaves a window where the item exists and
  // the source insert can fail -- or simply never run -- independently of it. That is
  // exactly the "item without its source row" failure this task exists to prevent.
  mocks.transaction.mockResolvedValue([[row()],[]])
  await createDraftIfEvidenceCurrent(account,id,null,input,snapshot(),projected.version)
  expect(mocks.transaction).toHaveBeenCalledTimes(1)
  expect(mocks.transaction.mock.calls[0][0]).toHaveLength(2)
  expect(mocks.sql).toHaveBeenCalledTimes(2)
  const mutationQuery = mocks.sql.mock.calls[0][0].join(' ')
  expect(mutationQuery).toContain('insert into evidence_work_items')
  expect(mutationQuery).toContain('insert into work_item_sources')
 })
 it('gives the source row the same opportunity_key the item got', async () => {
  // Would silently pass without this: a source insert that computed its own
  // opportunity_key (or omitted the column) would still write "a row" and satisfy a
  // naive not-null check, but a lookup by opportunity_key through work_item_sources --
  // which the next task adds -- would never find it.
  mocks.transaction.mockResolvedValue([[row()],[]])
  await createDraftIfEvidenceCurrent(account,id,null,input,snapshot(),projected.version)
  const key = opportunityKey(input.ruleVersion, input.source)
  const params = mocks.sql.mock.calls[0].slice(1)
  expect(params.filter(value => value === key)).toHaveLength(2)
 })
 it('writes a null check_key for a pulse-metric source, matching the item', async () => {
  // Would silently pass without this: swapping in the scan-check branch's
  // `${input.source.checkKey}` expression here by copy-paste would still typecheck
  // (SourceRef.checkKey is optional regardless of kind) and look plausible in review,
  // but migration 051's work_item_sources_rule_source_check rejects a pulse-metric
  // source with a non-null check_key -- a hard failure at runtime, not a cosmetic one.
  mocks.transaction.mockResolvedValue([[row()],[]])
  await createDraftIfEvidenceCurrent(account,id,null,input,snapshot(),projected.version)
  const query = mocks.sql.mock.calls[0][0].join(' ')
  // check_key is a bare SQL `null` literal here, not an interpolated value, so unlike
  // the scan-check case below there is no bound parameter to filter on. Scope the
  // `,null,` search to each insert's own select-list -- between its `insert into ... (`
  // and its `from` -- rather than the whole statement, so an unrelated nullable column
  // added anywhere else (the where clause, the returning list, ...) can't inflate this
  // count for a reason that has nothing to do with check_key.
  const itemInsert = query.split('insert into evidence_work_items')[1].split('from clients')[0]
  const sourceInsert = query.split('insert into work_item_sources')[1].split('from mutation')[0]
  expect(itemInsert.match(/,null,/g) ?? []).toHaveLength(1)
  expect(sourceInsert.match(/,null,/g) ?? []).toHaveLength(1)
 })
 it('writes the scan check_key to the source row, matching the item exactly', async () => {
  // Would silently pass without this: hard-coding null here (the pulse-metric shape)
  // instead of the actual check key would violate the same rule_source_check
  // constraint from the other direction -- a scan-check source requires a non-null
  // check_key.
  const {buildScanEvidence}=await import('@/lib/scan-evidence')
  const {projectScanOpportunityInput}=await import('@/lib/opportunities/store')
  const envelope=buildScanEvidence({requestedUrl:'https://example.com',evaluatedUrl:'https://example.com',industry:'technology',region:'HK',sitemapSource:'fetched',checks:{c1_robots:{assessment:'fail',collection:'complete'}},observations:[]})
  const scan={id,client_id:id,account_id:account,created_at:pulse.created_at,envelope}
  const projectedScan=projectScanOpportunityInput(account,scan)!
  const candidate=deriveSuggestions(projectedScan.source)[0]
  const built=buildInitialDraftSnapshot(candidate,projectedScan.source,'en')
  mocks.transaction.mockResolvedValue([[row()],[]])
  mocks.sql.mockClear()
  await createDraftIfEvidenceCurrent(account,id,null,{source:candidate.source,ruleVersion:candidate.ruleVersion,fingerprint:candidate.fingerprint,locale:'en'},built,projectedScan.version)
  const params = mocks.sql.mock.calls[0].slice(1)
  expect(params.filter(value => value === candidate.source.checkKey)).toHaveLength(2)
 })
 it('writes the same serialized snapshot to the source row, not a re-serialization', async () => {
  // Would silently pass without this: a source insert that called
  // serializeDraftSnapshot(snapshot) again instead of reusing the `serialized` variable
  // computed once at the top of the function could drift from the item's bytes for the
  // same logical snapshot -- canonicalization is stable today, but nothing should rely
  // on calling it twice producing identical output by coincidence.
  mocks.transaction.mockResolvedValue([[row()],[]])
  await createDraftIfEvidenceCurrent(account,id,null,input,snapshot(),projected.version)
  const expectedSnapshot = serializeDraftSnapshot(snapshot())
  const params = mocks.sql.mock.calls[0].slice(1)
  // The item's own evidence_snapshot value, the pre-existing octet_length size guard,
  // and the new source row's evidence_snapshot value all reuse the same string: 3
  // occurrences if source_ins exists and reuses it, 2 if it does not exist at all.
  expect(params.filter(value => value === expectedSnapshot)).toHaveLength(3)
 })
 it('CAS edits only text/revision/actor/time, and replay requires strictly older identical payload', async () => {
  mocks.transaction.mockResolvedValue([[],[row()]])
  const result = await updateOwnedDraft(account,id,id,null,{title:'Review',action:'Check',notes:'',expectedRevision:1})
  expect(result?.evidenceSnapshot).toEqual(snapshot())
  const mutation = mocks.sql.mock.calls[0][0].join(' ')
  const set = mutation.split(' set ')[1].split(' where ')[0]
  expect(set).not.toMatch(/snapshot|source_|locale|status|fingerprint|opportunity/)
  const replay = mocks.sql.mock.calls[1][0].join(' ')
  expect(replay).toContain('d.revision >')
  expect(replay).toContain('d.title =')
  expect(replay).toContain('d.action =')
  expect(replay).toContain('d.notes =')
 })
 it('preserves microseconds and only exposes the allowlisted DTO during pagination', async () => {
  mocks.sql.mockResolvedValue([row(),{...row(),id:account}])
  const result = await listOwnedDrafts(account,id,{limit:1,cursor:null})
  expect(result.items).toHaveLength(1)
  expect(JSON.parse(Buffer.from(result.nextCursor!,'base64url').toString()).createdAt).toBe(pulse.created_at)
  expect(result.items[0]).not.toHaveProperty('account_id')
 })


it.each(['en','zh-HK'] as const)('keeps maximal Pulse questions fully retained with bounded %s initial copy',locale=>{
 const long=projectPulseOpportunityInput(account,{...pulse,question:'😀'.repeat(500),platform:'p'.repeat(80)})
 const candidate=deriveSuggestions(long.source)[0]
 const built=buildInitialDraftSnapshot(candidate,long.source,locale)
 expect(Array.from(built.initialTitle).length).toBeLessThanOrEqual(160)
 expect(Array.from(built.initialAction).length).toBeLessThanOrEqual(4000)
 expect(built.initialAction).toContain('😀'.repeat(500))
 expect(built.locale).toBe(locale)
})
it('reads exact sources only after both ownership predicates and compares the complete scan envelope',async()=>{
 const {buildScanEvidence}=await import('@/lib/scan-evidence')
 const {projectScanOpportunityInput}=await import('@/lib/opportunities/store')
 const {loadOwnedDraftSource}=await import('@/lib/work-items/store')
 const envelope=buildScanEvidence({requestedUrl:'https://example.com',evaluatedUrl:'https://example.com',industry:'technology',region:'HK',sitemapSource:'fetched',checks:{c1_robots:{assessment:'fail',collection:'complete'}},observations:[]})
 const scan={id,client_id:id,account_id:account,created_at:pulse.created_at,envelope}
 mocks.sql.mockResolvedValueOnce([scan])
 const selected=await loadOwnedDraftSource(account,id,{kind:'scan-check',id,checkKey:'c1_robots'})
 expect(selected?.version).toMatchObject({kind:'scan-check',row:scan})
 let query=mocks.sql.mock.calls.at(-1)![0].join(' ')
 expect(query).toContain('s.account_id=')
 expect(query).toContain('s.client_id=')
 expect(query).not.toContain('domain')
 const projectedScan=projectScanOpportunityInput(account,scan)!
 const candidate=deriveSuggestions(projectedScan.source)[0]
 const built=buildInitialDraftSnapshot(candidate,projectedScan.source,'en')
 mocks.transaction.mockResolvedValue([[],[]])
 mocks.sql.mockClear()
 await createDraftIfEvidenceCurrent(account,id,null,{source:candidate.source,ruleVersion:candidate.ruleVersion,fingerprint:candidate.fingerprint,locale:'en'},built,projectedScan.version)
 query=mocks.sql.mock.calls[0][0].join(' ')
 for(const field of ['account_id','client_id','created_at'])expect(query).toContain(`s.${field} is not distinct from`)
 expect(query).toContain("(s.results -> 'evidence') is not distinct from")
 expect(mocks.sql.mock.calls[0]).toContain(JSON.stringify(envelope))
 // All snapshot material is derived from this envelope plus exact scan identity/time.
 const oversized=structuredClone(candidate)
 if(oversized.evidence.kind!=='scan-check')throw new Error('fixture')
 oversized.evidence.limitations=Array.from({length:40},()=> '😀'.repeat(160))
 oversized.limitations=[...oversized.evidence.limitations]
 oversized.evidence.observations=Array.from({length:40},()=>({observedAt:null,provenance:null,collection:'complete',target:{origin:'https://'+'a'.repeat(280)+'.com',pathRedacted:false,queryRedacted:false,fragmentRedacted:false,originNormalized:false},httpStatus:200,signals:{},check:null}))
 expect(()=>buildInitialDraftSnapshot(oversized,projectedScan.source,'en')).toThrow()
})
it('every owned draft read/write excludes the reserved recommendation kind',async()=>{
 const {findOwnedDraft,readOwnedDraft}=await import('@/lib/work-items/store')
 mocks.sql.mockClear();mocks.sql.mockResolvedValue([])
 await findOwnedDraft(account,id,'key')
 await readOwnedDraft(account,id,id)
 await listOwnedDrafts(account,id,{limit:50,cursor:null})
 for(const call of mocks.sql.mock.calls) expect(call[0].join(' ')).toContain("d.source_kind in ('pulse-metric','scan-check')")
})


it('compares huge valid future revisions without PostgreSQL int4 parameter overflow',async()=>{
 mocks.transaction.mockResolvedValue([[],[]])
 expect(await updateOwnedDraft(account,id,id,null,{title:'Review',action:'Check',notes:'',expectedRevision:Number.MAX_SAFE_INTEGER})).toBeNull()
 for(const call of mocks.sql.mock.calls){
  const index=call.slice(1).indexOf(Number.MAX_SAFE_INTEGER)
  expect(index).toBeGreaterThanOrEqual(0)
  expect(call[0][index+1]).toMatch(/^::bigint/)
 }
})
