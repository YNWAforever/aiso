import { expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { freezeMultiSourceReview } from '@/lib/change-sets/validation'
import { versionDTO } from '@/lib/change-sets/store'
import type { DraftSnapshotV1 } from '@/lib/opportunities/types'
import { projectMultiSourceOutcomeSnapshot, projectOutcomeSnapshot, projectStoredOutcomeSnapshot } from '@/lib/outcomes/sources'
import { evaluateMultiSourceOutcomes, multiSourceOutcomeContext, parseMultiSourceOutcomeResponse } from '@/lib/outcomes/multi-source'
import { parseOutcomeResponse } from '@/lib/outcomes/dto'
import { buildScanEvidence } from '@/lib/scan-evidence'
import { deriveSuggestions } from '@/lib/opportunities/rules'
import { snapshot, pulseRow, scanEnvelope, scanSnapshot } from './snapshot-fixtures'
import { approvedVersion, REQUEST_ID } from '../delivery/fixtures'

function pulse(question = 'Example?', promptId: string | null = null, platform = 'chatgpt'): DraftSnapshotV1 {
 const value = approvedVersion().evidenceSnapshot
 if (value.evidence.kind !== 'pulse-metric') throw new Error('Expected Pulse fixture')
 value.evidence.question = question
 value.evidence.platform = platform
 value.evidence.promptId = promptId
 value.args = { question, platform }
 return value
}
function scan(): DraftSnapshotV1 { return scanSnapshot().version.content.evidenceSnapshot }
function multi(snapshots: DraftSnapshotV1[] = [scan(), pulse(), scan(), pulse('Second?')]) {
 const row = snapshot(), version = versionDTO(row.version)
 const frozen = freezeMultiSourceReview({ ...version, id: version.workItemId, revision: version.draftRevision }, snapshots)
 return {
  ...row,
  version: { ...row.version, content: frozen.content, content_hash: frozen.contentHash, validation: frozen.validation,
   decision_record: { ...row.version.decision_record, content_hash: frozen.contentHash } },
  events: row.events.map(event => ({ ...event, content_hash: frozen.contentHash })) as Record<string, unknown>[],
 }
}
const candidateId = (index: number) => `123e4567-e89b-42d3-a456-${index.toString(16).padStart(12, '0')}`
const scanRow = (index = 1) => ({ id: candidateId(index), created_at: '2026-09-14T01:00:00.123456Z', envelope: scanEnvelope('2026-09-14T00:00:00.000001Z') })
const pulseCandidate = (question = 'Example?', index = 1, promptId: string | null = null, platform = 'chatgpt') => ({ ...pulseRow(), id: candidateId(index), question, prompt_id: promptId, platform })

it('keeps V1 dispatch byte-shaped and the original projector narrow', () => {
 const row = snapshot()
 expect(projectStoredOutcomeSnapshot(row)).toEqual(projectOutcomeSnapshot(row))
 expect(projectStoredOutcomeSnapshot(row)).not.toHaveProperty('schemaVersion')
 expect(() => projectOutcomeSnapshot(multi())).toThrow('OUTCOMES_UNAVAILABLE')
 expect(() => projectMultiSourceOutcomeSnapshot(row)).toThrow('OUTCOMES_UNAVAILABLE')
})

it('projects original frozen order, duplicates, clock and same-version anchor without mutable replacements', () => {
 const row = multi()
 row.scans = [scanRow()]
 row.pulse = [pulseCandidate(), pulseCandidate('Second?', 2)]
 const result = projectStoredOutcomeSnapshot({ ...row, liveSources: [], currentScan: { invented: true } })
 expect(result).toHaveProperty('schemaVersion', 2)
 if (!('schemaVersion' in result)) throw new Error('Expected V2')
 expect(result.sources.map(source => source.sourceIndex)).toEqual([0, 1, 2, 3])
 expect(result.sources[0]).toEqual({ ...result.sources[2], sourceIndex: 0 })
 expect(result.sources.map(source => source.candidates.map(candidate => candidate.source.id))).toEqual([
  [candidateId(1)], [candidateId(1)], [candidateId(1)], [candidateId(2)],
 ])
 expect(result.sources.map(source => source.baseline?.source.kind)).toEqual(['scan-check', 'pulse-metric', 'scan-check', 'pulse-metric'])
 expect(result).toMatchObject({ contentHash: row.version.content_hash, evaluatedAt: '2026-09-15T00:00:00.123456Z',
  anchorState: 'active', anchor: { recordedAt: row.events[0].recorded_at } })
 expect(result.sources[0].baseline).toMatchObject({ collectedAt: '2026-09-01T00:00:00.000Z', verdict: 'fail', reasons: expect.arrayContaining(['final-path-identity-withheld']) })
 const response = evaluateMultiSourceOutcomes(result)
 expect(parseMultiSourceOutcomeResponse(response, multiSourceOutcomeContext(result))).toEqual(response)
 expect(() => parseOutcomeResponse(response)).toThrow()
 expect(response.sources[0].windows[0]).toMatchObject({ comparison: { status: 'partially_comparable', outcome: 'unchanged' } })
 expect(response.sources[1].windows[0]).toMatchObject({ selected: null, evidenceState: 'timing-unknown' })
 expect(JSON.stringify(response)).not.toMatch(/Example\?|Second\?|raw_answer|answerDigest|destination|invented|unknown-answer-coverage/)
})

it.each(['舊來源:É', '𠮷'.repeat(36)])('preserves normalized opaque frozen ID %s by code-point bound, not UUID/UTF16 length', opaqueId => {
 const p = pulse(), s = scan()
 if (p.evidence.kind !== 'pulse-metric' || s.evidence.kind !== 'scan-check') throw new Error('Unexpected fixture')
 p.source.id = p.evidence.id = opaqueId
 s.source.id = s.evidence.scanId = 'Old-Scan:É'
 const input = projectMultiSourceOutcomeSnapshot(multi([p, s, p]))
 expect(input.sources.map(source => source.baseline?.source.id)).toEqual([opaqueId, 'Old-Scan:É', opaqueId])
 const response = evaluateMultiSourceOutcomes(input)
 expect(parseMultiSourceOutcomeResponse(response, multiSourceOutcomeContext(input))).toEqual(response)
})

it.each(['array-null', 'array-empty', 'source-null', 'hash', 'validation', 'schema'] as const)('fails the entire malformed frozen primary for %s', kind => {
 const row = multi()
 if (kind === 'hash') row.version.content_hash = 'f'.repeat(64)
 else if (kind === 'validation') Object.assign(row.version.validation, { policyVersion: 'unsupported' })
 else if (kind === 'schema') Object.assign(row.version.content, { schemaVersion: 3 })
 else Object.assign(row.version.content, { evidenceSnapshots: kind === 'array-null' ? null : kind === 'array-empty' ? [] : [null, pulse()] })
 expect(() => projectStoredOutcomeSnapshot(row)).toThrow()
})

it.each(['pulse-metric', 'scan-check'] as const)('does not localize malformed frozen %s calendars as bad observations', kind => {
 const value = kind === 'pulse-metric' ? pulse() : scan()
 if (value.evidence.kind === 'pulse-metric') value.evidence.recordedAt = '2026-02-30T00:00:00Z'
 else value.evidence.collectedAt = '2026-02-30T00:00:00Z'
 expect(() => projectMultiSourceOutcomeSnapshot(multi([scan(), value, pulse()]))).toThrow()
})

it.each(['submission', 'decision', 'decision-id'] as const)('rejects malformed V2 primary %s even without any delivery events', field => {
 const row = multi()
 row.events = []
 if (field === 'submission') row.version.submitted_at = '2026-02-30T00:00:00Z'
 else if (field === 'decision') row.version.decision_record.decided_at = '2026-02-30T00:00:00Z'
 else row.version.decision_record.id = 'invalid'
 expect(() => projectStoredOutcomeSnapshot(row)).toThrow()
})

it.each(['account_id', 'client_id', 'work_item_id', 'version_id', 'content_hash', 'approval_decision_id'] as const)('rejects crossed V2 anchor %s', field => {
 const row = multi()
 row.events[0][field] = field === 'content_hash' ? 'b'.repeat(64) : candidateId(98)
 expect(() => projectStoredOutcomeSnapshot(row)).toThrow('OUTCOMES_UNAVAILABLE')
})

it('rejects duplicate active anchors and future or invalid calendar events before source projection', () => {
 for (const patch of [{ id: candidateId(98) }, { recorded_at: '2026-09-16T00:00:00Z' }, { delivered_at: '2026-02-30T00:00:00Z' }]) {
  const row = multi()
  if ('id' in patch) row.events.push({ ...row.events[0], ...patch })
  else Object.assign(row.events[0], patch)
  expect(() => projectStoredOutcomeSnapshot(row)).toThrow()
 }
})

it('shares one derived withdrawal/no-delivery state across all frozen entries and rejects orphan withdrawal', () => {
 const row = multi()
 const withdrawal = { ...row.events[0], id: candidateId(99), kind: 'withdraw', target_attestation_id: row.events[0].id,
  reason: 'Correction', destination: null, delivered_at: null, note: null, approval_decision_id: null, approval_decision: null }
 const result = projectMultiSourceOutcomeSnapshot({ ...row, events: [...row.events, withdrawal] })
 expect(result).toMatchObject({ anchorState: 'withdrawn', anchor: null })
 expect(evaluateMultiSourceOutcomes(result).sources.every(source => source.windows.length === 0)).toBe(true)
 expect(projectMultiSourceOutcomeSnapshot({ ...row, events: [] })).toMatchObject({ anchorState: 'no-delivery', anchor: null })
 expect(() => projectMultiSourceOutcomeSnapshot({ ...row, events: [withdrawal] })).toThrow()
})

it('partitions question/platform/prompt before comparison while preserving the null-prompt wildcard', () => {
 const specific = REQUEST_ID, different = candidateId(90)
 const row = multi([pulse(), pulse('Example?', specific), pulse('Example?', null, 'claude'), pulse('Second?')])
 row.pulse = [pulseCandidate('Example?', 1), pulseCandidate('Example?', 2, specific), pulseCandidate('Example?', 3, different),
  pulseCandidate('Example?', 4, null, 'claude'), pulseCandidate('Second?', 5)]
 const result = projectMultiSourceOutcomeSnapshot(row)
 expect(result.sources.map(source => source.candidates.map(candidate => candidate.source.id))).toEqual([
  [candidateId(1), candidateId(2), candidateId(3)], [candidateId(2)], [candidateId(4)], [candidateId(5)],
 ])
 expect(result.sources.every(source => source.sourceState === 'ok')).toBe(true)
 expect(result.sources.flatMap(source => source.candidates).every(candidate => candidate.collectedAt === null && candidate.reasons.includes('pulse-provenance-incomplete'))).toBe(true)
})

it.each([
 { label: 'answer marker', patch: { has_answer: 'invalid' } },
 { label: 'brand marker', patch: { brand_mentioned: 'invalid' } },
 { label: 'recorded calendar', patch: { created_at: '2026-02-30T00:00:00Z' } },
 { label: 'candidate UUID', patch: { id: 'invalid' } },
])('localizes malformed matching Pulse $label to its subject and leaves other subjects/kinds available', ({ patch }) => {
 const row = multi()
 row.scans = [scanRow()]
 row.pulse = [{ ...pulseCandidate(), ...patch }, pulseCandidate('Second?', 2)]
 const result = projectMultiSourceOutcomeSnapshot(row)
 expect(result.sources.map(source => source.sourceState)).toEqual(['ok', 'unavailable', 'ok', 'ok'])
 if ('id' in patch) expect(result.sources[1].candidates).toEqual([])
 else expect(result.sources[1].candidates[0]).toMatchObject({ collectedAt: null, verdict: null, reasons: ['source-malformed'] })
 expect(result.sources[3].candidates).toHaveLength(1)
})

it.each([null, {}, { ...pulseCandidate(), question: null }, { ...pulseCandidate(), prompt_id: undefined }, pulseCandidate('Not in frozen union')])('marks unassignable Pulse union corruption unavailable only for that kind: %j', candidate => {
 const row = multi()
 row.scans = [scanRow()]
 row.pulse = [candidate, pulseCandidate('Second?', 2)]
 const result = projectMultiSourceOutcomeSnapshot(row)
 expect(result.sources.map(source => source.sourceState)).toEqual(['ok', 'unavailable', 'ok', 'unavailable'])
 expect(result.sources[3].candidates).toHaveLength(1)
})

it.each([
 { label: 'null', envelope: null }, { label: 'empty', envelope: {} },
 { label: 'invalid-calendar', envelope: { collectedAt: 'bad' } }, { label: 'oversized', envelope: { oversized: 'x'.repeat(32769) } },
])('keeps malformed shared scan evidence unavailable without poisoning Pulse: $label', ({ envelope }) => {
 const row = multi()
 row.scans = [{ ...scanRow(), envelope }]
 row.pulse = [pulseCandidate(), pulseCandidate('Second?', 2)]
 const result = projectMultiSourceOutcomeSnapshot(row)
 expect(result.sources.map(source => source.sourceState)).toEqual(['unavailable', 'ok', 'unavailable', 'ok'])
 expect(result.sources[0].candidates[0]).toMatchObject({ collectedAt: null, verdict: null, reasons: ['source-malformed'] })
})

it.each(['pulse', 'scans'] as const)('does not turn missing %s data into empty success or hide the other kind', kind => {
 const row = multi()
 row.scans = [scanRow()]
 row.pulse = [pulseCandidate(), pulseCandidate('Second?', 2)]
 const result = projectMultiSourceOutcomeSnapshot({ ...row, [kind]: null })
 expect(result.sources.map(source => source.sourceState)).toEqual(kind === 'pulse' ? ['ok', 'unavailable', 'ok', 'unavailable'] : ['unavailable', 'ok', 'unavailable', 'ok'])
})

it.each([0, 1, 200, 201, 402])('retains at most 200 observations from each shared kind pool of %i', count => {
 const row = multi()
 row.scans = Array.from({ length: count }, (_, index) => scanRow(index + 1))
 row.pulse = Array.from({ length: count }, (_, index) => pulseCandidate('Example?', index + 1))
 const result = projectMultiSourceOutcomeSnapshot(row)
 expect(result.sources.map(source => source.candidates.length)).toEqual([Math.min(count, 200), Math.min(count, 200), Math.min(count, 200), 0])
 expect(result.sources.every(source => source.truncated === (count > 200))).toBe(true)
 expect(result.sources.every(source => source.sourceState === 'ok')).toBe(true)
})

it('propagates shared Pulse overflow to a starved subject without limiting valid scan entries', () => {
 const row = multi()
 row.scans = [scanRow()]
 row.pulse = Array.from({ length: 201 }, (_, index) => pulseCandidate('Example?', index + 1))
 const input = projectMultiSourceOutcomeSnapshot(row)
 expect(input.sources.map(source => source.truncated)).toEqual([false, true, false, true])
 expect(input.sources[3].candidates).toEqual([])
 const response = evaluateMultiSourceOutcomes(input)
 expect(response.sources[3].windows[0]).toMatchObject({ selected: null, evidenceState: 'evidence-limited', reasons: expect.arrayContaining(['candidate-limit-exceeded']) })
 expect(parseMultiSourceOutcomeResponse(response, multiSourceOutcomeContext(input))).toEqual(response)
})

it('uses the 201st row solely as overflow evidence without decoding a malformed sentinel', () => {
 const row = multi()
 row.scans = [...Array.from({ length: 200 }, (_, index) => scanRow(index + 1)), null]
 row.pulse = [...Array.from({ length: 200 }, (_, index) => pulseCandidate('Example?', index + 1)), null]
 const input = projectMultiSourceOutcomeSnapshot(row)
 expect(input.sources.every(source => source.truncated && source.sourceState === 'ok')).toBe(true)
 expect(input.sources.map(source => source.candidates.length)).toEqual([200, 200, 200, 0])
})

it('keeps cached shared scan envelopes independent by frozen signature and check verdict', () => {
 const baselineEnvelope = scanEnvelope()
 const envelope = (region: string, collectedAt: string, checks = baselineEnvelope.checks) => buildScanEvidence({
  requestedUrl: 'https://example.com', evaluatedUrl: 'https://example.com', industry: 'general_b2b', region,
  sitemapSource: 'fetched', collectedAt, checks, observations: baselineEnvelope.observations,
 })
 const frozen = (value: ReturnType<typeof scanEnvelope>, index = 0): DraftSnapshotV1 => {
  const suggestion = deriveSuggestions({ kind: 'scan-check', scanId: REQUEST_ID, recordedAt: null, envelope: value })[index]
  if (!suggestion || suggestion.evidence.kind !== 'scan-check') throw new Error('Expected scan suggestion')
  return { ...scan(), source: suggestion.source, ruleVersion: suggestion.ruleVersion, evidence: suggestion.evidence,
   limitations: suggestion.limitations, titleKey: suggestion.titleKey, actionKey: suggestion.actionKey, args: suggestion.args }
 }
 const first = frozen(baselineEnvelope), second = frozen(baselineEnvelope, 1)
 const differentScope = frozen(envelope('US', baselineEnvelope.collectedAt!))
 if (second.evidence.kind !== 'scan-check') throw new Error('Expected second scan check')
 const key = second.evidence.checkKey
 const observed = envelope('HK', '2026-09-14T00:00:00.000001Z', {
  ...baselineEnvelope.checks, [key]: { ...baselineEnvelope.checks[key], assessment: 'pass' },
 })
 const row = multi([first, second, differentScope])
 row.scans = [{ ...scanRow(), envelope: observed }]
 const input = projectMultiSourceOutcomeSnapshot(row)
 expect(input.sources.map(source => source.candidates[0].verdict)).toEqual(['fail', 'pass', 'fail'])
 expect(input.sources.map(source => source.candidates[0].reasons.includes('different-methods-or-scope'))).toEqual([false, false, true])
 const result = evaluateMultiSourceOutcomes(input)
 expect(result.sources.map(source => source.windows[0].comparison.outcome)).toEqual(['unchanged', 'improved', 'cannot_determine'])
 expect(result.sources.map(source => source.windows[0].comparison.status)).toEqual(['partially_comparable', 'partially_comparable', 'not_comparable'])
 expect(parseMultiSourceOutcomeResponse(result, multiSourceOutcomeContext(input))).toEqual(result)
})

it('roundtrips duplicate-heavy projection through the global diagnostic ceiling without leaking SQL data', () => {
 const p = pulse(), row = multi([p, p, p])
 row.pulse = Array.from({ length: 200 }, (_, index) => pulseCandidate('Example?', index + 1))
 const input = projectMultiSourceOutcomeSnapshot(row)
 const result = evaluateMultiSourceOutcomes(input)
 expect(result.sources.reduce((sum, source) => sum + source.diagnostics.length, 0)).toBe(400)
 expect(result.sources.map(source => source.diagnostics.length)).toEqual([134, 133, 133])
 expect(result.sources.every(source => source.reasons.includes('diagnostic-limit-exceeded') && !source.reasons.includes('candidate-limit-exceeded'))).toBe(true)
 expect(parseMultiSourceOutcomeResponse(result, multiSourceOutcomeContext(input))).toEqual(result)
 expect(JSON.stringify(result)).not.toMatch(/raw_answer|answerDigest|Example\?|destination/)
})
