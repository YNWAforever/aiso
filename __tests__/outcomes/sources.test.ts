import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { projectOutcomeSnapshot } from '@/lib/outcomes/sources'
import { snapshot, pulseRow } from './snapshot-fixtures'
import { REQUEST_ID } from '../delivery/fixtures'
describe('private outcome snapshot projection', () => {
 it('uses frozen baseline and preserves exact timestamp precision', () => {
  const row = snapshot(); row.pulse = [pulseRow()]
  expect(projectOutcomeSnapshot(row)).toMatchObject({ evaluatedAt: row.evaluated_at, anchorState: 'active', anchor: { recordedAt: row.events[0].recorded_at },
   baseline: { collectedAt: null, verdict: 'success' }, candidates: [{ collectedAt: null, recordedAt: pulseRow().created_at, verdict: 'success', reasons: ['collection-time-unknown', 'pulse-provenance-incomplete'] }] })
  expect(JSON.stringify(projectOutcomeSnapshot(row))).not.toMatch(/Example|raw_answer|destination|answerDigest/)
 })
 it.each(['question','platform','prompt_id'])('refuses a mismatched Pulse %s before constructing safe evidence', key => {
  const row = snapshot(); row.pulse = [{ ...pulseRow(), [key]: 'different' }]
  // A retained null prompt does not constrain a candidate's prompt.
  if (key === 'prompt_id') expect(projectOutcomeSnapshot(row).candidates).toHaveLength(1)
  else expect(projectOutcomeSnapshot(row)).toMatchObject({ candidates: [], sourceState: 'unavailable' })
 })
 it('bounds untimed sources and exposes overflow', () => {
  const row = snapshot(); row.pulse = Array.from({length:201}, () => pulseRow())
  expect(projectOutcomeSnapshot(row)).toMatchObject({ truncated: true })
  expect(projectOutcomeSnapshot(row).candidates).toHaveLength(200)
 })
 it('does not turn malformed source arrays into empty success', () => {
  expect(projectOutcomeSnapshot({ ...snapshot(), pulse: null })).toMatchObject({ sourceState: 'unavailable' })
 })
 it.each([undefined, {}, { ...snapshot(), version: {} }, { ...snapshot(), events: null }])('rejects invalid primary snapshot', row => {
  expect(() => projectOutcomeSnapshot(row)).toThrow()
 })
 it('rejects hash or approval binding mismatch and multiple active events', () => {
  for (const patch of [{content_hash:'a'.repeat(64)}, {approval_decision_id: REQUEST_ID.replace(/3$/, '4')}, {version_id: REQUEST_ID}]) {
   const row = snapshot(); Object.assign(row.events[0], patch)
   expect(() => projectOutcomeSnapshot(row)).toThrow()
  }
  const row = snapshot(); row.events.push({...row.events[0], id:REQUEST_ID})
  expect(() => projectOutcomeSnapshot(row)).toThrow()
 })
 it('derives withdrawal over complete retained history and rejects orphan withdrawal', () => {
  const row = snapshot()
  const withdrawal = {...row.events[0], id: REQUEST_ID, kind:'withdraw', target_attestation_id:row.events[0].id, reason:'Correction', destination:null, delivered_at:null, note:null,approval_decision_id:null,approval_decision:null}
  expect(projectOutcomeSnapshot({...row,events:[...row.events,withdrawal]})).toMatchObject({anchorState:'withdrawn',anchor:null})
  expect(() => projectOutcomeSnapshot({...row,events:[withdrawal]})).toThrow()
  expect(projectOutcomeSnapshot({...row,events:[]})).toMatchObject({anchorState:'no-delivery',anchor:null})
 })
})

import { scanEnvelope, scanSnapshot } from './snapshot-fixtures'
it('validates scan collection time without substituting recorded time and retains schema-v1 rejection',()=>{
 const row=scanSnapshot(); row.scans=[{id:REQUEST_ID,created_at:'2026-09-20T00:00:00.123456Z',envelope:scanEnvelope('2026-09-14T00:00:00.000Z')}]
 // The baseline keeps 'final-path-identity-withheld': it is a single frozen check,
 // not a full envelope, so it can never prove which page it came from. The
 // candidate no longer does — it carries a complete envelope whose page
 // observation redacted no path, so compareScanEvidence now finds it comparable
 // and only the schema-wide limitations remain.
 expect(projectOutcomeSnapshot(row)).toMatchObject({baseline:{collectedAt:'2026-09-01T00:00:00.000Z',reasons:expect.arrayContaining(['origin-only-identity','final-path-identity-withheld'])},candidates:[{collectedAt:'2026-09-14T00:00:00.000Z',recordedAt:'2026-09-20T00:00:00.123456Z',reasons:expect.arrayContaining(['origin-only-identity','sampled-single-page'])}]})
 expect(projectOutcomeSnapshot(row).candidates[0]!.reasons).not.toContain('final-path-identity-withheld')
})
it('marks malformed scan envelope unavailable with safe diagnostic instead of timing by created_at',()=>{
 const row=scanSnapshot();row.scans=[{id:REQUEST_ID,created_at:'2026-09-14T00:00:00.123456Z',envelope:{collectedAt:'bad'}}]
 expect(projectOutcomeSnapshot(row)).toMatchObject({sourceState:'unavailable',candidates:[{collectedAt:null,reasons:['source-malformed']}]})
})
it('suppresses certainty on scan overflow even when every raw candidate is outside all windows',()=>{
 const row=scanSnapshot();row.scans=Array.from({length:201},()=>({id:REQUEST_ID,created_at:null,envelope:scanEnvelope()}))
 expect(projectOutcomeSnapshot(row)).toMatchObject({truncated:true})
 expect(projectOutcomeSnapshot(row).candidates).toHaveLength(200)
})
it('requires retained prompt identity when present',()=>{
 const row=snapshot()
 const d = draft()
 if(d.evidenceSnapshot.evidence.kind!=='pulse-metric')throw Error()
 d.evidenceSnapshot.evidence.promptId=REQUEST_ID
 const f=freezeReview(d)
 Object.assign(row.version,{content:f.content,content_hash:f.contentHash,validation:f.validation})
 row.version.decision_record.content_hash=f.contentHash;row.events[0].content_hash=f.contentHash
 row.pulse=[pulseRow()]
 expect(projectOutcomeSnapshot(row)).toMatchObject({sourceState:'unavailable',candidates:[]})
})
import { draft } from '../change-sets/fixtures'
import { freezeReview } from '@/lib/change-sets/validation'



import { evaluateOutcomes } from '@/lib/outcomes/evaluate'
import { parseOutcomeResponse } from '@/lib/outcomes/dto'
it('roundtrips projected Pulse and scan responses through the strict browser contract',()=>{
 for(const row of [snapshot(),scanSnapshot()]){
  if(row.version.content.evidenceSnapshot.evidence.kind==='pulse-metric')row.pulse=[pulseRow()]
  else row.scans=[{id:REQUEST_ID,created_at:null,envelope:scanEnvelope('2026-09-14T00:00:00.000Z')}]
  const response=evaluateOutcomes(projectOutcomeSnapshot(row))
  expect(parseOutcomeResponse(response)).toEqual(response)
 }
})
it.each(['account_id','client_id','work_item_id'])('rejects crossed event %s ownership',field=>{
 const row=snapshot();Object.assign(row.events[0],{[field]:REQUEST_ID.replace(/3$/,'9')})
 expect(()=>projectOutcomeSnapshot(row)).toThrow()
})
it('keeps legacy Pulse collection time unknown despite extra created/scan-week/collection metadata',()=>{
 const row=snapshot();row.pulse=[{...pulseRow(),scan_week:'2026-09-14',collectedAt:'2026-09-14T00:00:00Z',model:'invented'}]
 expect(projectOutcomeSnapshot(row).candidates[0].collectedAt).toBeNull()
})
it('retains method mismatch and incomplete collection reasons without an adapter',()=>{
 const row=scanSnapshot()
 const envelope=scanEnvelope('2026-09-14T00:00:00.000Z')
 const other=buildScanEvidence({requestedUrl:'https://other.example',evaluatedUrl:'https://other.example',industry:'general_b2b',region:'HK',sitemapSource:'fetched',collectedAt:envelope.collectedAt!,checks:{}})
 row.scans=[{id:REQUEST_ID,created_at:null,envelope:other}]
 expect(projectOutcomeSnapshot(row).candidates[0].reasons).toEqual(expect.arrayContaining(['different-methods-or-scope','incomplete-collection']))
 expect(evaluateOutcomes(projectOutcomeSnapshot(row)).windows[0].evidenceState).toBe('not-comparable')
})
import { buildScanEvidence } from '@/lib/scan-evidence'
it('fails closed for missing frozen evidence and malformed delivery calendar dates',()=>{
 const row=snapshot()
 expect(()=>projectOutcomeSnapshot({...row,version:{...row.version,content:{...row.version.content,evidenceSnapshot:null}}})).toThrow()
 row.events[0].delivered_at='2026-02-30T00:00:00.123456Z'
 expect(()=>projectOutcomeSnapshot(row)).toThrow()
})
