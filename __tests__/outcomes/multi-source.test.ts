import { describe, expect, it } from 'vitest'
import { evaluateOutcomes } from '@/lib/outcomes/evaluate'
import { parseOutcomeResponse } from '@/lib/outcomes/dto'
import { evaluateMultiSourceOutcomes, multiSourceOutcomeContext, parseMultiSourceOutcomeResponse, OUTCOME_DIAGNOSTIC_LIMIT_REASON as diagnosticLimit } from '@/lib/outcomes/multi-source'
import type { MultiSourceOutcomeInput, MultiSourceOutcomeResponse, MultiSourceOutcomeSourceInput } from '@/lib/outcomes/multi-source'
import type { SafeEvidence } from '@/lib/outcomes/types'
import { evidence, input } from './fixtures'

const pulse = (id = 'pulse-base'): SafeEvidence => ({ source: { kind: 'pulse-metric', id, checkKey: null },
  recordedAt: '2026-09-01T00:00:00Z', collectedAt: null, verdict: 'success',
  reasons: ['collection-time-unknown', 'pulse-provenance-incomplete'] })
const source = (sourceIndex: number, baseline: SafeEvidence | null = evidence(), candidates: SafeEvidence[] = []): MultiSourceOutcomeSourceInput => ({ sourceIndex, baseline, candidates, sourceState: 'ok', truncated: false })
function multi(sources = [source(0), source(1, pulse()), source(2)]): MultiSourceOutcomeInput {
  const { clientId, itemId, versionId, contentHash, evaluatedAt, anchorState, anchor } = input()
  return { schemaVersion: 2, clientId, itemId, versionId, contentHash, evaluatedAt, anchorState, anchor, sources }
}
function read(value: MultiSourceOutcomeInput) {
  const result = evaluateMultiSourceOutcomes(value)
  expect(parseMultiSourceOutcomeResponse(JSON.parse(JSON.stringify(result)), multiSourceOutcomeContext(value))).toEqual(result)
  return result
}
const pass = (id = 'observation', at = '2026-09-14T00:00:00.000001Z'): SafeEvidence => ({ ...evidence(id, at), verdict: 'pass' })
function crowded(): MultiSourceOutcomeInput {
  const rows = Array.from({ length: 200 }, (_, index) => pulse('pulse-' + index.toString().padStart(3, '0')))
  return multi([source(0, pulse(), rows), source(1, pulse(), rows), source(2, pulse(), rows)])
}

describe('frozen multi-source outcome policy', () => {
  it('keeps frozen duplicate ordinals, shared clock/anchor and independent source policies without an aggregate', () => {
    const value = multi([source(0, evidence(), [pass()]), source(1, pulse(), [pulse('later')]), source(2, evidence(), [pass()])])
    const before = JSON.stringify(value), result = read(value)
    expect(JSON.stringify(value)).toBe(before)
    expect(result.sources.map(row => row.sourceIndex)).toEqual([0, 1, 2])
    expect(result.sources[0]).toEqual({ ...result.sources[2], sourceIndex: 0 })
    expect(result.sources[0].windows[0]).toMatchObject({ timeState: 'observation-available', evidenceState: 'available', provisional: true,
      comparison: { status: 'partially_comparable', outcome: 'improved' } })
    expect(result.sources[1].windows[0]).toMatchObject({ selected: null, evidenceState: 'timing-unknown',
      comparison: { status: 'not_comparable', outcome: 'cannot_determine' } })
    expect(result.sources[1].reasons).not.toContain('improved')
    expect(Object.keys(result).sort()).toEqual(['anchor', 'anchorState', 'clientId', 'contentHash', 'evaluatedAt', 'itemId', 'policyVersion', 'schemaVersion', 'sources', 'versionId'].sort())
    expect(result.anchor).toEqual(value.anchor)
  })
  it.each([
    ['2026-09-13T23:59:59.999999Z', false], ['2026-09-14T00:00:00.000000Z', true],
    ['2026-09-20T23:59:59.999999Z', true], ['2026-09-21T00:00:00.000000Z', false],
  ])('retains half-open UTC microsecond D7 boundaries at %s', (at, selected) => {
    const value = multi([source(0, evidence(), [pass('boundary', at)])])
    value.evaluatedAt = '2026-09-21T00:00:00.000000Z'
    expect(read(value).sources[0].windows[0].selected?.source.id ?? null).toBe(selected ? 'boundary' : null)
  })
  it('selects independently for D7/D28/D56 and breaks exact microsecond ties by original observed ID', () => {
    const value = multi([source(0, evidence(), [pass('b'), pass('a'), pass('d28', '2026-10-05T00:00:00Z'), pass('d56', '2026-11-02T00:00:00Z'), pass('future', '2026-11-04T00:00:00Z')])])
    value.evaluatedAt = '2026-11-03T00:00:00Z'
    expect(read(value).sources[0].windows.map(row => row.selected?.source.id)).toEqual(['a', 'd28', 'd56'])
  })
  it.each(['no-delivery', 'withdrawn'] as const)('keeps every frozen entry but suppresses windows after %s', anchorState => {
    const value = { ...multi(), anchorState, anchor: null }
    const result = read(value)
    expect(result.sources).toHaveLength(3)
    expect(result.sources.every(row => row.windows.length === 0)).toBe(true)
    expect(result.sources.every(row => row.reasons.includes(anchorState === 'withdrawn' ? 'anchor-withdrawn' : 'no-delivery'))).toBe(true)
  })
  it('uses at most400 diagnostic occurrences across duplicate frozen entries with deterministic fair allocation', () => {
    const value = crowded(), result = read(value)
    expect(result.sources.map(row => row.diagnostics.length)).toEqual([134, 133, 133])
    expect(result.sources.flatMap(row => row.diagnostics)).toHaveLength(400)
    for (const row of result.sources) {
      expect(row.reasons).toContain(diagnosticLimit)
      expect(row.reasons).not.toContain('candidate-limit-exceeded')
      expect(row.truncated).toBe(true)
      expect(row.windows.every(window => window.selected === null && window.evidenceState === 'evidence-limited')).toBe(true)
      expect(row.diagnostics[0].source.id).toBe('pulse-000')
    }
    expect(read(value)).toEqual(result)
  })
  it('does not let Pulse diagnostic loss suppress an unaffected retained scan observation', () => {
    const value = crowded()
    value.sources.unshift(source(0, evidence(), [pass()]))
    value.sources.forEach((row, index) => { row.sourceIndex = index })
    const result = read(value)
    expect(result.sources[0]).toMatchObject({ truncated: false, diagnostics: [] })
    expect(result.sources[0].windows[0]).toMatchObject({ selected: { source: { id: 'observation' } }, evidenceState: 'available' })
    expect(result.sources.slice(1).every(row => row.reasons.includes(diagnosticLimit))).toBe(true)
  })
  it('propagates an overflowing kind to every matching frozen entry including zero assigned candidates', () => {
    const value = multi([source(0, evidence(), Array.from({ length: 201 }, (_, index) => evidence('unknown-' + index, null))), source(1), source(2, pulse())])
    const result = read(value)
    expect(result.sources.slice(0, 2).every(row => row.truncated && row.reasons.includes('candidate-limit-exceeded'))).toBe(true)
    expect(result.sources[0].reasons).not.toContain(diagnosticLimit)
    expect(result.sources[1].windows.every(row => row.evidenceState === 'evidence-limited')).toBe(true)
    expect(result.sources[2].truncated).toBe(false)
  })
  it('propagates an explicit shared query sentinel even if all retained source candidate lists are empty', () => {
    const value = multi(); value.sources[0].truncated = true
    const result = read(value)
    expect(result.sources[0].truncated).toBe(true); expect(result.sources[2].truncated).toBe(true)
    expect(result.sources[1].truncated).toBe(false)
  })
  it('isolates an unavailable observation source while retaining the other source result', () => {
    const value = multi([source(0), source(1, evidence('another-baseline'), [pass()])])
    value.sources[0].sourceState = 'unavailable'
    const result = read(value)
    expect(result.sources[0].windows[0]).toMatchObject({ evidenceState: 'unavailable', selected: null })
    expect(result.sources[1].windows[0]).toMatchObject({ evidenceState: 'available', selected: { source: { id: 'observation' } } })
  })
  it('keeps temporal invalid-baseline evidence distinct from a movement comparison', () => {
    const value = multi([source(0, evidence('late-baseline', '2026-09-08T00:00:00Z'), [pass()])])
    expect(read(value).sources[0].windows[0]).toMatchObject({ evidenceState: 'invalid-baseline', reasons: expect.arrayContaining(['baseline-after-delivery', 'final-path-identity-withheld']) })
  })
  it.each(['scan: legacy /1', '🔎'.repeat(36)])('preserves normalized opaque historical frozen ID %s without widening V1 grammar', id => {
    const value = multi([source(0, evidence(id), [pass()])])
    expect(read(value).sources[0].baseline?.source.id).toBe(id)
    const old = input({ baseline: value.sources[0].baseline, candidates: value.sources[0].candidates })
    expect(() => parseOutcomeResponse(evaluateOutcomes(old))).toThrow()
  })
  it('admits a null baseline only when the independently trusted frozen context explicitly admits null', () => {
    const value = multi([source(0, null)])
    const result = read(value)
    expect(result.sources[0].windows[0].evidenceState).toBe('invalid-baseline')
    expect(() => parseMultiSourceOutcomeResponse(result, { ...multiSourceOutcomeContext(value), sourceRefs: [evidence().source] })).toThrow()
  })
})

describe('closed V2 response and independent frozen-context binding', () => {
  const valid = () => multi([source(0, evidence(), [pass()]), source(1, pulse(), [pulse('later')]), source(2, evidence(), [pass()])])
  const mutations: [string, (value: MultiSourceOutcomeResponse) => void][] = [
    ['schema', value => { Object.assign(value, { schemaVersion: 1 }) }],
    ['policy', value => { Object.assign(value, { policyVersion: 'stored-outcomes.v1' }) }],
    ['extra top-level score', value => { Object.assign(value, { score: 100 }) }],
    ['client', value => { value.clientId = 'foreign' }], ['item', value => { value.itemId = 'foreign' }],
    ['version', value => { value.versionId = 'foreign' }], ['hash', value => { value.contentHash = 'b'.repeat(64) }],
    ['missing ordinal', value => { value.sources.pop() }], ['repeated ordinal', value => { value.sources[1].sourceIndex = 0 }],
    ['negative ordinal', value => { value.sources[0].sourceIndex = -1 }],
    ['extra source verdict', value => { Object.assign(value.sources[0], { outcome: 'improved' }) }],
    ['source id', value => { value.sources[0].baseline!.source.id = 'different' }],
    ['source subject', value => { value.sources[0].baseline!.source.checkKey = 'c2_llms_txt' }],
    ['unknown reason', value => { value.sources[0].reasons.push('guaranteed-growth') }],
    ['unexpected evidence prose', value => { Object.assign(value.sources[0].baseline!, { answer: 'private prose' }) }],
    ['invalid calendar', value => { value.sources[0].baseline!.recordedAt = '2026-02-30T00:00:00Z' }],
    ['invalid active anchor', value => { value.anchor = null }],
    ['forged movement', value => { value.sources[0].windows[0].comparison.outcome = 'regressed' }],
    ['shifted window', value => { value.sources[0].windows[0].startsAt = '2026-09-14T00:00:00.000001Z' }],
    ['window order', value => { value.sources[0].windows.reverse() }],
    ['spurious diagnostic limit', value => { value.sources[0].truncated = true; value.sources[0].reasons.push(diagnosticLimit) }],
  ]
  it.each(mutations)('rejects %s without accepting desired-looking summary fields', (_name, mutate) => {
    const value = valid(), result = structuredClone(evaluateMultiSourceOutcomes(value))
    mutate(result)
    expect(() => parseMultiSourceOutcomeResponse(result, multiSourceOutcomeContext(value))).toThrow()
  })
  it('rejects a valid-shaped response for another frozen ordering even with unchanged common IDs/hash', () => {
    const value = valid(), other = structuredClone(value)
    ;[other.sources[0].baseline, other.sources[1].baseline] = [other.sources[1].baseline, other.sources[0].baseline]
    expect(() => parseMultiSourceOutcomeResponse(evaluateMultiSourceOutcomes(other), multiSourceOutcomeContext(value))).toThrow()
  })
  it.each([1, -1])('rejects a global diagnostic count offset of %i from400 with limitation metadata', change => {
    const value = crowded(), result = evaluateMultiSourceOutcomes(value)
    if (change === 1) result.sources[0].diagnostics.push(pulse('extra-diagnostic'))
    else result.sources[0].diagnostics.pop()
    expect(() => parseMultiSourceOutcomeResponse(result, multiSourceOutcomeContext(value))).toThrow()
  })
  it('rejects duplicate diagnostics and inconsistent same-kind overflow claims', () => {
    const value = crowded(), result = evaluateMultiSourceOutcomes(value)
    result.sources[0].diagnostics[1] = result.sources[0].diagnostics[0]
    expect(() => parseMultiSourceOutcomeResponse(result, multiSourceOutcomeContext(value))).toThrow()
    const another = valid(), limited = evaluateMultiSourceOutcomes(another)
    limited.sources[0].truncated = true; limited.sources[0].reasons.push('candidate-limit-exceeded')
    expect(() => parseMultiSourceOutcomeResponse(limited, multiSourceOutcomeContext(another))).toThrow()
  })
  it('rejects individually valid source windows that hide a globally overflowing visible candidate union', () => {
    const unknown = Array.from({ length: 200 }, (_, index) => evidence('raw-scan-' + index, null))
    const baseline = evidence('second-baseline'); baseline.source.checkKey = 'c2_llms_txt'
    const selected = pass('additional-raw-scan'); selected.source.checkKey = 'c2_llms_txt'
    const value = multi([source(0, evidence(), unknown), source(1, baseline, [selected])])
    const actual = evaluateMultiSourceOutcomes(value)
    expect(actual.sources.every(row => row.truncated)).toBe(true)
    const forged = { ...actual, sources: value.sources.map(row => {
      const scalar = evaluateOutcomes({ ...input(), ...row })
      const { baseline, windows, diagnostics, truncated, reasons } = scalar
      return { sourceIndex: row.sourceIndex, baseline, windows, diagnostics, truncated, reasons }
    }) }
    expect(forged.sources[1].windows[0].comparison.outcome).toBe('improved')
    expect(forged.sources.every(row => !row.truncated)).toBe(true)
    expect(() => parseMultiSourceOutcomeResponse(forged, multiSourceOutcomeContext(value))).toThrow()
  })
  it('counts one visible raw scan ID once across different frozen check keys', () => {
    const rows = Array.from({ length: 200 }, (_, index) => evidence('shared-raw-scan-' + index, null))
    const baseline = evidence(); baseline.source.checkKey = 'c2_llms_txt'
    const otherRows = rows.map(row => ({ ...row, source: { ...row.source, checkKey: 'c2_llms_txt' } }))
    const result = read(multi([source(0, evidence(), rows), source(1, baseline, otherRows)]))
    expect(result.sources.map(row => row.diagnostics.length)).toEqual([200, 200])
    expect(result.sources.every(row => !row.truncated)).toBe(true)
  })
  it('rejects a 400-diagnostic response that starves a limited later source outside the round-robin contract', () => {
    const value = crowded(), result = evaluateMultiSourceOutcomes(value)
    const full = evaluateMultiSourceOutcomes({ ...value, sources: [{ ...value.sources[0], sourceIndex: 0 }] }).sources[0]
    result.sources[0] = { ...structuredClone(full), sourceIndex: 0 }
    result.sources[1] = { ...structuredClone(full), sourceIndex: 1 }
    result.sources[2].diagnostics = []
    expect(result.sources.map(row => row.diagnostics.length)).toEqual([200, 200, 0])
    expect(() => parseMultiSourceOutcomeResponse(result, multiSourceOutcomeContext(value))).toThrow()
  })
  it('accepts an uneven round-robin allocation when one original diagnostic list is actually short', () => {
    const value = crowded(); value.sources[0].candidates = value.sources[0].candidates.slice(0, 1)
    const result = read(value)
    expect(result.sources.map(row => row.diagnostics.length)).toEqual([1, 200, 199])
    expect(result.sources.map(row => row.reasons.includes(diagnosticLimit))).toEqual([false, false, true])
  })
  it('leaves V1 decoding narrow and requires actual nonempty V2 sources', () => {
    const value = valid(), result = evaluateMultiSourceOutcomes(value)
    expect(() => parseOutcomeResponse(result)).toThrow()
    expect(parseOutcomeResponse(evaluateOutcomes(input()))).toEqual(evaluateOutcomes(input()))
    expect(() => evaluateMultiSourceOutcomes(multi([]))).toThrow()
    expect(() => parseMultiSourceOutcomeResponse({ ...result, sources: [] }, { ...multiSourceOutcomeContext(value), sourceRefs: [] })).toThrow()
  })
})
