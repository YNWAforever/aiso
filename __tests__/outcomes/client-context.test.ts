import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { approvedVersion, ACTOR_ID, ID, REQUEST_ID } from '../delivery/fixtures'
import { approvedMultiSourceVersion, versionRow } from '../delivery/multi-source-fixtures'
import { freezeMultiSourceReview } from '@/lib/change-sets/validation'
import { projectMultiSourceOutcomeSnapshot } from '@/lib/outcomes/sources'
import { evaluateMultiSourceOutcomes } from '@/lib/outcomes/multi-source'
import { evaluateOutcomes } from '@/lib/outcomes/evaluate'
import { parseSelectedOutcome, selectedOutcomeExpectation, selectedOutcomeReadKey } from '@/lib/outcomes/client-context'
import type { SelectedOutcomeExpectation } from '@/lib/outcomes/client-context'
import type { VersionDetail } from '@/lib/change-sets/types'

const client = '123e4567-e89b-42d3-a456-426614174004'
function sample() {
  const version = approvedMultiSourceVersion(), raw = versionRow(version)
  const input = projectMultiSourceOutcomeSnapshot({ member: true, owned: true, evaluated_at: '2026-09-21T00:00:00.000001Z',
    version: { ...raw, account_id: ACTOR_ID, client_id: client, decision_record: { ...raw.decision_record as object, id: REQUEST_ID } },
    events: [], scans: [], pulse: [] })
  return { version, value: evaluateMultiSourceOutcomes(input), expected: selectedOutcomeExpectation(client, ID, version) }
}
const key = (expected: SelectedOutcomeExpectation, viewer = ACTOR_ID, refresh = 0, retry = 0) => selectedOutcomeReadKey(expected, viewer, refresh, retry)

describe('selected frozen outcome context', () => {
  it('decodes a genuine Node-frozen/projected mixed V2 packet using independent selected-side refs', () => {
    const { version, value, expected } = sample()
    expect(expected.context.sourceRefs).toEqual([
      { kind: 'scan-check', id: version.evidenceSnapshots[0].evidence.kind === 'scan-check' ? version.evidenceSnapshots[0].evidence.scanId : '', checkKey: version.evidenceSnapshots[0].evidence.kind === 'scan-check' ? version.evidenceSnapshots[0].evidence.checkKey : null },
      { kind: 'pulse-metric', id: ID, checkKey: null },
      { kind: 'scan-check', id: version.evidenceSnapshots[2].evidence.kind === 'scan-check' ? version.evidenceSnapshots[2].evidence.scanId : '', checkKey: version.evidenceSnapshots[2].evidence.kind === 'scan-check' ? version.evidenceSnapshots[2].evidence.checkKey : null },
    ])
    expect(parseSelectedOutcome(JSON.parse(JSON.stringify(value)), expected)).toEqual(value)
    expect(value.sources.map(source => source.sourceIndex)).toEqual([0, 1, 2])
  })
  it('gets the exact Scan check key from frozen evidence when the optional source key is absent', () => {
    const { version } = sample()
    const snapshot = version.evidenceSnapshots[0]
    delete snapshot.source.checkKey
    const expected = selectedOutcomeExpectation(client, ID, version)
    expect(expected.context.sourceRefs[0]?.checkKey).toBe(snapshot.evidence.kind === 'scan-check' ? snapshot.evidence.checkKey : null)
  })
  it('preserves opaque frozen source IDs byte-for-byte without UUID coercion, trimming or lowercasing', () => {
    const { version } = sample(), snapshot = structuredClone(version.evidenceSnapshots[0]), opaque = '保留|"Upper😀'
    if (snapshot.evidence.kind !== 'scan-check') throw Error('Expected actual Scan snapshot')
    snapshot.source.id = opaque; snapshot.evidence.scanId = opaque
    const frozen = freezeMultiSourceReview({ id: version.workItemId, revision: version.draftRevision, title: version.title,
      action: version.action, notes: version.notes, locale: version.locale }, [snapshot])
    const changed = { ...version, ...frozen.content, contentHash: frozen.contentHash, validation: frozen.validation }
    expect(selectedOutcomeExpectation(client, ID, changed).context.sourceRefs[0]?.id).toBe(opaque)
  })
  it.each(['kind', 'id', 'check'] as const)('fails a contradictory selected frozen source %s closed', field => {
    const { version } = sample(), source = version.evidenceSnapshots[0].source
    if (field === 'kind') source.kind = 'pulse-metric'
    if (field === 'id') source.id = 'another-source'
    if (field === 'check') source.checkKey = 'c4_structured_data'
    expect(() => selectedOutcomeExpectation(client, ID, version)).toThrow()
  })
  it('normalizes only UUID scope aliases and rejects a selected version from another item', () => {
    const { version } = sample()
    expect(selectedOutcomeExpectation(client.toUpperCase(), ID.toUpperCase(), version)).toEqual(selectedOutcomeExpectation(client, ID, version))
    expect(() => selectedOutcomeExpectation(client, REQUEST_ID, version)).toThrow()
  })
  it('keeps V1 null-baseline states and its original wire policy admitted', () => {
    const version = approvedVersion(), expected = selectedOutcomeExpectation(client, ID, version)
    const value = evaluateOutcomes({ ...expected.context, evaluatedAt: '2026-09-21T00:00:00Z', anchorState: 'no-delivery', anchor: null,
      baseline: null, candidates: [], sourceState: 'ok', truncated: false })
    expect(parseSelectedOutcome(value, expected)).toEqual(value)
    expect(value.schemaVersion).toBe(1)
    expect(() => parseSelectedOutcome({ ...value, contentHash: 'b'.repeat(64) }, expected)).toThrow()
  })
  it.each(['clientId', 'itemId', 'versionId', 'contentHash'] as const)('rejects V1 reply %s outside the selected scope', field => {
    const version = approvedVersion(), expected = selectedOutcomeExpectation(client, ID, version)
    const value = evaluateOutcomes({ ...expected.context, evaluatedAt: '2026-09-21T00:00:00Z', anchorState: 'no-delivery', anchor: null,
      baseline: null, candidates: [], sourceState: 'ok', truncated: false })
    expect(() => parseSelectedOutcome({ ...value, [field]: field === 'contentHash' ? 'b'.repeat(64) : '123e4567-e89b-42d3-a456-426614174099' }, expected)).toThrow()
  })
  it.each(['schema', 'hash', 'count', 'ordinal', 'source', 'order', 'extra', 'policy'] as const)('keeps the V2 decoder bound to selected context against a forged %s', mutation => {
    const { value, expected } = sample(), raw = structuredClone(value)
    if (mutation === 'schema') Object.assign(raw, { schemaVersion: 1 })
    if (mutation === 'hash') raw.contentHash = 'b'.repeat(64)
    if (mutation === 'count') raw.sources.pop()
    if (mutation === 'ordinal') raw.sources[0].sourceIndex = 2
    if (mutation === 'source') raw.sources[0].baseline!.source.id = 'foreign-source'
    if (mutation === 'order') [raw.sources[0], raw.sources[1]] = [{ ...raw.sources[1], sourceIndex: 0 }, { ...raw.sources[0], sourceIndex: 1 }]
    if (mutation === 'extra') Object.assign(raw, { aggregate: 'improved' })
    if (mutation === 'policy') Object.assign(raw, { policyVersion: 'stored-outcomes.v1' })
    expect(() => parseSelectedOutcome(raw, expected)).toThrow()
  })
  it('does not select a decoder from the reply or accept a V2 body for a selected V1 version', () => {
    const { value } = sample()
    expect(() => parseSelectedOutcome(value, selectedOutcomeExpectation(client, ID, approvedVersion()))).toThrow()
  })
  it('changes the value-based read fence for every protected context field, viewer and explicit retry', () => {
    const { expected } = sample(), original = key(expected)
    for (const field of ['clientId', 'itemId', 'versionId', 'contentHash'] as const) {
      const changed = structuredClone(expected); changed.context[field] += '-changed'
      expect(key(changed)).not.toBe(original)
    }
    for (const change of [
      (value: SelectedOutcomeExpectation) => { value.schemaVersion = 1 },
      (value: SelectedOutcomeExpectation) => { value.context.sourceRefs = value.context.sourceRefs.slice(0, -1) },
      (value: SelectedOutcomeExpectation) => { value.context.sourceRefs = [...value.context.sourceRefs].reverse().slice(1).concat(value.context.sourceRefs[0]) },
      (value: SelectedOutcomeExpectation) => { value.context.sourceRefs[0]!.id += '-changed' },
      (value: SelectedOutcomeExpectation) => { value.context.sourceRefs[0]!.checkKey = 'c4_structured_data' },
    ]) {
      const changed = structuredClone(expected); change(changed); expect(key(changed)).not.toBe(original)
    }
    expect(key(expected, REQUEST_ID)).not.toBe(original)
    expect(key(expected, ACTOR_ID, 1)).not.toBe(original)
    expect(key(expected, ACTOR_ID, 0, 1)).not.toBe(original)
  })
  it('retains the fence for reconstructed values and unrelated decision metadata changes', () => {
    const { version, expected } = sample()
    const changed = structuredClone(version)
    changed.decision!.reason = 'An unrelated returned decision explanation'
    expect(key(selectedOutcomeExpectation(client, ID, changed))).toBe(key(expected))
    expect(key(JSON.parse(JSON.stringify(expected)))).toBe(key(expected))
  })
  it('rejects absent viewer identity and invalid retry counters instead of silently borrowing another viewer', () => {
    const { expected } = sample()
    expect(() => key(expected, '')).toThrow()
    expect(() => key(expected, ACTOR_ID, -1)).toThrow()
    expect(() => key(expected, ACTOR_ID, 0, Number.NaN)).toThrow()
  })
  it('fails invalid selected schema, hash and empty source packages before a read can start', () => {
    const { version } = sample()
    for (const changed of [{ ...version, contentHash: 'not-a-hash' }, { ...version, schemaVersion: 3 }, { ...version, evidenceSnapshots: [] }]) {
      expect(() => selectedOutcomeExpectation(client, ID, changed as VersionDetail)).toThrow()
    }
  })
})
