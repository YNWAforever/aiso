import { describe, expect, it } from 'vitest'
import { buildScanEvidence, type EvidenceCheckKey } from '@/lib/scan-evidence'
import type { Observation } from '@/lib/observations/types'
import { deriveSuggestions } from '@/lib/opportunities/rules'
import type { SourceEvidence } from '@/lib/opportunities/types'

const ID = '00000000-0000-4000-8000-000000000001'
const SCAN = '00000000-0000-4000-8000-000000000002'

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    id: ID,
    sourceKind: 'pulse-metric',
    promptId: null,
    question: 'How visible is Example?',
    platform: 'chatgpt',
    scanWeek: '2026-08-31',
    recordedAt: '2026-09-01T01:02:03.000Z',
    collectedAt: null,
    model: null,
    market: null,
    result: 'success',
    hasAnswer: true,
    brandMentioned: false,
    currentPrompt: null,
    limitations: ['model-unrecorded', 'market-unrecorded'],
    ...overrides,
  }
}

function pulse(overrides: Partial<Observation> = {}, answerDigest = 'a'.repeat(64)): SourceEvidence {
  return { kind: 'pulse-metric', observation: observation(overrides), answerDigest }
}

function envelope(checks: Partial<Record<EvidenceCheckKey, { assessment: 'pass' | 'warn' | 'fail' | 'not-applicable' | 'not-verifiable'; collection: 'complete' | 'partial' | 'blocked' | 'failed' | 'unsupported' | 'unknown' }>> = {}) {
  return buildScanEvidence({
    requestedUrl: 'https://example.com/private/path?secret=yes',
    evaluatedUrl: 'https://example.com/private/path?secret=yes',
    industry: 'technology',
    region: 'HK',
    sitemapSource: 'fetched',
    checks,
    observations: [{
      check: 'page',
      observedAt: '2026-09-01T01:01:01.000Z',
      collection: 'complete',
      httpStatus: 200,
      target: { origin: 'https://example.com', pathRedacted: true, queryRedacted: true, fragmentRedacted: false, originNormalized: true },
      signals: { mimeType: 'text/html' },
    }],
    collectedAt: '2026-09-01T01:01:01.000Z',
  })
}

function scan(evidence: unknown): SourceEvidence {
  return { kind: 'scan-check', scanId: SCAN, recordedAt: '2026-09-01T02:00:00.000Z', envelope: evidence }
}

describe('deriveSuggestions', () => {
  it('derives the versioned Pulse absent-brand review from one successful recorded answer', () => {
    const [suggestion] = deriveSuggestions(pulse())
    expect(suggestion).toMatchObject({
      key: `pulse-brand-absent.v1:pulse-metric:${ID}:`,
      ruleVersion: 'pulse-brand-absent.v1',
      source: { kind: 'pulse-metric', id: ID },
      titleKey: 'review-question-coverage',
      actionKey: 'review-question-coverage',
      args: { question: 'How visible is Example?', platform: 'chatgpt' },
      savedDraftId: null,
      evidence: { kind: 'pulse-metric', id: ID, brandMentioned: false },
    })
    expect(suggestion.evidence).not.toHaveProperty('answerDigest')
    expect(JSON.stringify(suggestion)).not.toContain('rawAnswer')
    expect(JSON.stringify(suggestion)).not.toContain('secret answer')

    const injected = pulse() as Extract<SourceEvidence, { kind: 'pulse-metric' }>
    injected.observation = { ...injected.observation, rawAnswer: 'secret answer' } as Observation
    expect(JSON.stringify(deriveSuggestions(injected))).not.toContain('secret answer')
  })

  it.each([
    ['incomplete result', { result: 'incomplete' as const }],
    ['missing answer', { hasAnswer: false }],
    ['unknown classification', { brandMentioned: null }],
    ['present brand', { brandMentioned: true }],
  ])('excludes Pulse evidence with %s', (_name, overrides) => {
    expect(deriveSuggestions(pulse(overrides))).toEqual([])
  })

  it('changes the Pulse fingerprint when only the internal answer digest changes', () => {
    const first = deriveSuggestions(pulse({}, 'a'.repeat(64)))[0]
    const second = deriveSuggestions(pulse({}, 'b'.repeat(64)))[0]
    expect(first.evidence).toEqual(second.evidence)
    expect(first.fingerprint).not.toBe(second.fingerprint)
  })
  it('excludes Pulse evidence with an invalid internal answer digest', () => {
    expect(deriveSuggestions(pulse({}, 'not-a-digest'))).toEqual([])
  })

  it.each(['warn', 'fail'] as const)('derives a scan review for a complete applicable %s check', assessment => {
    const [suggestion] = deriveSuggestions(scan(envelope({ c1_robots: { assessment, collection: 'complete' } })))
    expect(suggestion).toMatchObject({
      key: `scan-check-gap.v1:scan-check:${SCAN}:c1_robots`,
      ruleVersion: 'scan-check-gap.v1',
      source: { kind: 'scan-check', id: SCAN, checkKey: 'c1_robots' },
      titleKey: 'review-check',
      actionKey: 'review-check',
      args: { checkKey: 'c1_robots', assessment },
      evidence: {
        kind: 'scan-check',
        scanId: SCAN,
        checkKey: 'c1_robots',
        check: { applicability: 'applicable', collection: 'complete', assessment },
      },
    })
    expect(suggestion.evidence).not.toHaveProperty('checks')
    expect(JSON.stringify(suggestion)).not.toContain('/private/path')
    expect(JSON.stringify(suggestion)).not.toContain('secret=yes')
  })

  it.each([
    ['pass', 'complete'],
    ['warn', 'partial'],
    ['fail', 'blocked'],
    ['not-applicable', 'complete'],
    ['not-verifiable', 'unknown'],
  ] as const)('excludes scan check assessment %s with collection %s', (assessment, collection) => {
    expect(deriveSuggestions(scan(envelope({ c1_robots: { assessment, collection } })))).toEqual([])
  })

  it('fails closed for an invalid scan envelope', () => {
    const invalid = { ...envelope({ c1_robots: { assessment: 'warn', collection: 'complete' } }), scannerVersion: 'forged' }
    expect(deriveSuggestions(scan(invalid))).toEqual([])
  })

  it('does not derive a stored recommendation while recommendation access is unresolved', () => {
    const recommendation: SourceEvidence = {
      kind: 'agent-recommendation', recommendationId: ID, scanId: SCAN,
      recordedAt: '2026-09-01T02:00:00.000Z', platform: 'chatgpt', category: 'content',
      priority: 'high', text: 'Publish a concise FAQ.',
    }
    expect(deriveSuggestions(recommendation)).toEqual([])
  })
})
