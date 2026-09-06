import { describe, expect, it } from 'vitest'
import { buildScanEvidence } from '@/lib/scan-evidence'
import { fingerprintEvidence, opportunityKey, serializeDraftSnapshot } from '@/lib/opportunities/fingerprint'
import { deriveSuggestions } from '@/lib/opportunities/rules'
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

function scanSnapshot(args: Record<string, unknown> = { checkKey: 'c1_robots', assessment: 'warn' }): DraftSnapshotV1 {
  const envelope = buildScanEvidence({
    requestedUrl: 'https://example.com', evaluatedUrl: 'https://example.com',
    industry: 'technology', region: 'HK', sitemapSource: 'fetched',
    checks: { c1_robots: { assessment: 'warn', collection: 'complete' } },
    observations: [{ check: 'page', collection: 'complete', httpStatus: 200, target: { origin: 'https://example.com' } }],
  })
  const suggestion = deriveSuggestions({ kind: 'scan-check', scanId: ID, recordedAt: null, envelope })[0]
  if (suggestion.evidence.kind !== 'scan-check') throw new Error('expected scan suggestion')
  return {
    schemaVersion: 1, source: suggestion.source, ruleVersion: suggestion.ruleVersion,
    evidence: suggestion.evidence, limitations: suggestion.limitations,
    titleKey: suggestion.titleKey, actionKey: suggestion.actionKey,
    args: args as Record<string, string>, locale: 'en',
    initialTitle: 'Review check', initialAction: 'Review the recorded check.',
  }
}
describe('fingerprintEvidence', () => {
  it('sorts object keys while preserving semantic values', () => {
    expect(fingerprintEvidence({ a: 1, b: 2 })).toBe(fingerprintEvidence({ b: 2, a: 1 }))
    expect(fingerprintEvidence({ a: 1 })).not.toBe(fingerprintEvidence({ a: 2 }))
  })

  it('preserves own __proto__ data keys without collapsing them into an empty object', () => {
    const first = JSON.parse('{"__proto__":{"value":1}}')
    const second = JSON.parse('{"__proto__":{"value":2}}')
    expect(fingerprintEvidence(first)).not.toBe(fingerprintEvidence(second))
    expect(fingerprintEvidence(first)).not.toBe(fingerprintEvidence({}))
    expect(fingerprintEvidence(JSON.parse('{"z":1,"__proto__":{"value":1}}')))
      .toBe(fingerprintEvidence(JSON.parse('{"__proto__":{"value":1},"z":1}')))
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
    const oversized = scanSnapshot()
    if (oversized.evidence.kind !== 'scan-check') throw new Error('expected scan snapshot')
    oversized.evidence.comparison.checkVersions = Object.fromEntries(
      Object.keys(oversized.evidence.comparison.checkVersions).map(key => [key, '界'.repeat(1_200)]),
    ) as typeof oversized.evidence.comparison.checkVersions
    expect(() => serializeDraftSnapshot(oversized)).toThrow(RangeError)
  })

  it('rejects unsupported snapshot values instead of silently dropping them', () => {
    const unsafe = { ...snapshot(), unexpected: undefined }
    expect(() => serializeDraftSnapshot(unsafe as DraftSnapshotV1)).toThrow(TypeError)
  })
  it.each([
    ['Pulse missing platform', { question: 'Example?' }],
    ['Pulse unexpected key', { question: 'Example?', platform: 'chatgpt', rawAnswer: 'secret' }],
    ['Pulse non-string value', { question: 'Example?', platform: { rawAnswer: 'secret' } }],
  ])('rejects invalid rule-specific arguments: %s', (_name, args) => {
    expect(() => serializeDraftSnapshot({ ...snapshot(), args } as DraftSnapshotV1)).toThrow(TypeError)
  })

  it('accepts the complete bounded arguments for both supported rules', () => {
    expect(() => serializeDraftSnapshot(snapshot())).not.toThrow()
    expect(() => serializeDraftSnapshot(scanSnapshot())).not.toThrow()
  })
  it.each([
    [{ checkKey: 'c1_robots' }, 'missing assessment'],
    [{ checkKey: 'c1_robots', assessment: 'warn', rawAnswer: 'secret' }, 'unexpected key'],
    [{ checkKey: 'not-a-check', assessment: 'warn' }, 'unknown check key'],
    [{ checkKey: 'c1_robots', assessment: 'pass' }, 'ineligible assessment'],
    [{ checkKey: 'c1_robots', assessment: { rawAnswer: 'secret' } }, 'non-string value'],
  ])('rejects scan rule arguments with %s', (args, _label) => {
    expect(() => serializeDraftSnapshot(scanSnapshot(args))).toThrow(TypeError)
  })
  it.each([
    ['initialTitle', { initialTitle: { rawAnswer: 'secret' } }],
    ['Pulse evidence question', { evidence: { ...snapshot().evidence, question: { rawAnswer: 'secret' } } }],
    ['limitations', { limitations: [{ rawAnswer: 'secret' }] }],
  ])('rejects objects hidden in scalar or string-array field %s', (_name, override) => {
    expect(() => serializeDraftSnapshot({ ...snapshot(), ...override } as DraftSnapshotV1)).toThrow(TypeError)
  })
  it.each([
    ['Pulse evidence limitations', () => ({ ...snapshot(), evidence: { ...snapshot().evidence, limitations: [{ rawAnswer: 'secret' }] } })],
    ['source id', () => ({ ...snapshot(), source: { kind: 'pulse-metric', id: { rawAnswer: 'secret' } } })],
    ['scan check version', () => { const value = scanSnapshot(); if (value.evidence.kind === 'scan-check') value.evidence.check.version = { rawAnswer: 'secret' } as never; return value }],
    ['scan URL origin', () => { const value = scanSnapshot(); if (value.evidence.kind === 'scan-check') value.evidence.requested.origin = { rawAnswer: 'secret' } as never; return value }],
    ['scan comparison industry', () => { const value = scanSnapshot(); if (value.evidence.kind === 'scan-check') value.evidence.comparison.industry = { rawAnswer: 'secret' } as never; return value }],
    ['scan check-version value', () => { const value = scanSnapshot(); if (value.evidence.kind === 'scan-check') (value.evidence.comparison.checkVersions as Record<string, unknown>).c1_robots = { rawAnswer: 'secret' }; return value }],
    ['scan observation collection', () => { const value = scanSnapshot(); if (value.evidence.kind === 'scan-check') value.evidence.observations[0].collection = { rawAnswer: 'secret' } as never; return value }],
    ['scan signal value', () => { const value = scanSnapshot(); if (value.evidence.kind === 'scan-check') value.evidence.observations[0].signals.mimeType = { rawAnswer: 'secret' } as never; return value }],
    ['scan limited flag', () => { const value = scanSnapshot(); if (value.evidence.kind === 'scan-check') value.evidence.limited = { rawAnswer: 'secret' } as never; return value }],
  ])('rejects structured values hidden in nested safe snapshot field %s', (_name, build) => {
    expect(() => serializeDraftSnapshot(build() as DraftSnapshotV1)).toThrow(TypeError)
  })
  it.each([
    ['Pulse evidence with scan rule', { ...snapshot(), ruleVersion: 'scan-check-gap.v1', args: { checkKey: 'c1_robots', assessment: 'warn' } }],
    ['scan evidence with Pulse rule', { ...scanSnapshot(), ruleVersion: 'pulse-brand-absent.v1', args: { question: 'Example?', platform: 'chatgpt' } }],
  ])('rejects mismatched rule and evidence identity: %s', (_name, value) => {
    expect(() => serializeDraftSnapshot(value as DraftSnapshotV1)).toThrow(TypeError)
  })
  it.each([
    ['Pulse question mismatch', () => ({ ...snapshot(), args: { question: 'Different?', platform: 'chatgpt' } })],
    ['Pulse platform mismatch', () => ({ ...snapshot(), args: { question: 'Example?', platform: 'other' } })],
    ['scan check key mismatch', () => scanSnapshot({ checkKey: 'c2_llms_txt', assessment: 'warn' })],
    ['scan assessment mismatch', () => scanSnapshot({ checkKey: 'c1_robots', assessment: 'fail' })],
    ['scan ineligible applicability', () => { const value = scanSnapshot(); if (value.evidence.kind === 'scan-check') value.evidence.check.applicability = 'not-verifiable'; return value }],
    ['scan incomplete collection', () => { const value = scanSnapshot(); if (value.evidence.kind === 'scan-check') value.evidence.check.collection = 'partial'; return value }],
    ['scan selected-check version mismatch', () => { const value = scanSnapshot(); if (value.evidence.kind === 'scan-check') value.evidence.check.version = 'forged.v1'; return value }],
    ['scan duplicated method mismatch', () => { const value = scanSnapshot(); if (value.evidence.kind === 'scan-check') value.evidence.comparison.pillarMethod = 'other.v1'; return value }],
    ['scan evaluated-origin mismatch', () => { const value = scanSnapshot(); if (value.evidence.kind === 'scan-check') value.evidence.comparison.evaluatedOrigin = 'https://other.example'; return value }],
    ['scan limitations mismatch', () => { const value = scanSnapshot(); value.limitations = ['different']; return value }],
    ['Pulse limitations mismatch', () => ({ ...snapshot(), limitations: ['different'] })],
  ])('rejects inconsistent generated arguments and evidence: %s', (_name, build) => {
    expect(() => serializeDraftSnapshot(build() as DraftSnapshotV1)).toThrow(TypeError)
  })
  it('rejects fields outside the snapshot allowlist, including raw answers', () => {
    const safe = snapshot()
    const unsafe = { ...safe, evidence: { ...safe.evidence, rawAnswer: 'secret answer' } }
    expect(() => serializeDraftSnapshot(unsafe as DraftSnapshotV1)).toThrow(TypeError)
  })
})
