import { describe, expect, it } from 'vitest'
import { fingerprintEvidence, opportunityKey, serializeDraftSnapshot } from '@/lib/opportunities/fingerprint'
import type { DraftSnapshotV1 } from '@/lib/opportunities/types'

const ID = '00000000-0000-4000-8000-000000000001'

function snapshot(action = 'Review the recorded response.'): DraftSnapshotV1 {
  return {
    schemaVersion: 1,
    source: { kind: 'pulse-metric', id: ID },
    ruleVersion: 'pulse-brand-absent.v1',
    evidence: {
      kind: 'pulse-metric', id: ID, promptId: null, question: 'Example?', platform: 'chatgpt',
      scanWeek: '2026-08-31', recordedAt: null, result: 'success', hasAnswer: true,
      brandMentioned: false, answerDigest: 'a'.repeat(64), provenance: 'retained-pulse-metric', limitations: [],
    },
    limitations: [],
    titleKey: 'review-question-coverage',
    actionKey: 'review-question-coverage',
    args: { question: 'Example?', platform: 'chatgpt' },
    locale: 'en',
    initialTitle: 'Review question coverage',
    initialAction: action,
  }
}

describe('fingerprintEvidence', () => {
  it('sorts object keys while preserving semantic values', () => {
    expect(fingerprintEvidence({ a: 1, b: 2 })).toBe(fingerprintEvidence({ b: 2, a: 1 }))
    expect(fingerprintEvidence({ a: 1 })).not.toBe(fingerprintEvidence({ a: 2 }))
  })

  it('preserves array order', () => {
    expect(fingerprintEvidence({ values: [1, 2] })).not.toBe(fingerprintEvidence({ values: [2, 1] }))
  })

  it.each([
    ['undefined', { value: undefined }],
    ['non-finite number', { value: Number.POSITIVE_INFINITY }],
    ['NaN', { value: Number.NaN }],
    ['bigint', { value: BigInt(1) }],
    ['function', { value: () => true }],
    ['symbol', { value: Symbol('x') }],
    ['date object', { value: new Date() }],
    ['sparse array', Array(1)],
  ])('rejects unsupported canonical input: %s', (_name, value) => {
    expect(() => fingerprintEvidence(value)).toThrow(TypeError)
  })

  it('rejects cyclic input', () => {
    const value: Record<string, unknown> = {}
    value.self = value
    expect(() => fingerprintEvidence(value)).toThrow(TypeError)
  })
})

describe('opportunityKey', () => {
  it('distinguishes source kind, id, and check key', () => {
    expect(opportunityKey('pulse-brand-absent.v1', { kind: 'pulse-metric', id: ID }))
      .toBe(`pulse-brand-absent.v1:pulse-metric:${ID}:`)
    expect(opportunityKey('scan-check-gap.v1', { kind: 'scan-check', id: ID, checkKey: 'c1_robots' }))
      .not.toBe(opportunityKey('scan-check-gap.v1', { kind: 'scan-check', id: ID, checkKey: 'c2_llms_txt' }))
    expect(opportunityKey('rule.v1', { kind: 'pulse-metric', id: ID }))
      .not.toBe(opportunityKey('rule.v1', { kind: 'agent-recommendation', id: ID }))
  })
})

describe('serializeDraftSnapshot', () => {
  it('serializes a safe snapshot inside the UTF-8 byte cap', () => {
    const serialized = serializeDraftSnapshot(snapshot())
    expect(Buffer.byteLength(serialized, 'utf8')).toBeLessThanOrEqual(65_536)
    expect(JSON.parse(serialized)).toEqual(snapshot())
  })

  it('rejects a snapshot over 65536 UTF-8 bytes', () => {
    expect(() => serializeDraftSnapshot(snapshot('界'.repeat(22_000)))).toThrow(RangeError)
  })

  it('rejects unsupported snapshot values instead of silently dropping them', () => {
    const unsafe = { ...snapshot(), unexpected: undefined }
    expect(() => serializeDraftSnapshot(unsafe as DraftSnapshotV1)).toThrow(TypeError)
  })
  it('rejects fields outside the snapshot allowlist, including raw answers', () => {
    const safe = snapshot()
    const unsafe = { ...safe, evidence: { ...safe.evidence, rawAnswer: 'secret answer' } }
    expect(() => serializeDraftSnapshot(unsafe as DraftSnapshotV1)).toThrow(TypeError)
  })
})
