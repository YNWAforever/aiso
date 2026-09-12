import { describe, expect, it, vi } from 'vitest'
import { buildScanEvidence } from '@/lib/scan-evidence'
import type { DraftSnapshotV1 } from '@/lib/opportunities/types'
import { deriveSuggestions } from '@/lib/opportunities/rules'
import type { WorkItem } from '@/lib/work-items/schema'
import { assertReviewPackageSize, freezeMultiSourceReview, freezeReview } from '@/lib/change-sets/validation'

vi.mock('server-only', () => ({}))

const ID = '123e4567-e89b-42d3-a456-426614174000'

function evidence(): DraftSnapshotV1 {
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
    initialAction: 'Review the recorded response.',
  }
}

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: ID, clientId: '123e4567-e89b-42d3-a456-426614174002', status: 'draft',
    title: 'Review question coverage', action: 'Review the recorded response.', notes: '',
    locale: 'en', revision: 1, createdAt: '2026-09-06T00:00:00.000Z', updatedAt: '2026-09-06T00:00:00.000Z',
    evidenceSnapshot: evidence(), ...overrides,
  }
}

function scanEvidence(): DraftSnapshotV1 {
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
    titleKey: suggestion.titleKey, actionKey: suggestion.actionKey, args: suggestion.args,
    locale: 'en', initialTitle: 'Review check', initialAction: 'Review the recorded check.',
  }
}

function evidenceAroundLimit(): { below: DraftSnapshotV1; above: DraftSnapshotV1 } {
  const base = evidence()
  const limitations = Array.from({ length: 40 }, (_, index) => `${index}`.padStart(3, '0') + '😀'.repeat(157))
  let below: DraftSnapshotV1 | null = null
  for (let emojiCount = 0; emojiCount <= 4_000; emojiCount += 1) {
    const candidate = {
      ...base, limitations,
      evidence: { ...base.evidence, limitations },
      initialAction: '😀'.repeat(emojiCount) + 'a'.repeat(4_000 - emojiCount),
    }
    const bytes = new TextEncoder().encode(JSON.stringify(candidate)).byteLength
    if (bytes < 65_536) below = candidate
    else if (below !== null) return { below, above: candidate }
  }
  throw new Error('could not construct evidence boundary fixtures')
}

function payloadAtFormattedSize(target: number): unknown {
  const overhead = new TextEncoder().encode(JSON.stringify({ payload: '' }, null, 2)).byteLength
  return { payload: 'x'.repeat(target - overhead) }
}

describe('freezeReview', () => {
  it('freezes only review content and records deterministic passing validation', () => {
    expect(freezeReview(item())).toMatchObject({
      content: {
        schemaVersion: 1, workItemId: ID, draftRevision: 1,
        title: 'Review question coverage', action: 'Review the recorded response.', notes: '', locale: 'en',
        evidenceSnapshot: evidence(),
      },
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      validation: {
        policyVersion: 'change-set-review.v1',
        checks: [
          { code: 'text', status: 'pass' }, { code: 'locale', status: 'pass' },
          { code: 'evidence', status: 'pass' }, { code: 'content_size', status: 'pass' },
        ],
      },
    })
  })

  it('deeply detaches frozen output from later input mutation', () => {
    const source = item()
    const frozen = freezeReview(source)
    source.title = 'Changed'
    source.evidenceSnapshot.args.question = 'Changed?'
    expect(frozen.content.title).toBe('Review question coverage')
    expect(frozen.content.evidenceSnapshot.args.question).toBe('Example?')
  })

  it('freezes the released scan-check-gap source', () => {
    const frozen = freezeReview(item({ evidenceSnapshot: scanEvidence() }))
    expect(frozen.content.evidenceSnapshot.ruleVersion).toBe('scan-check-gap.v1')
    expect(frozen.validation.checks.find((check) => check.code === 'evidence')).toEqual({ code: 'evidence', status: 'pass' })
  })

  it('changes the hash for title or revision changes', () => {
    const original = freezeReview(item()).contentHash
    expect(freezeReview(item({ title: 'Another title' })).contentHash).not.toBe(original)
    expect(freezeReview(item({ revision: 2 })).contentHash).not.toBe(original)
  })

  it('does not change the hash when nested input object key order changes', () => {
    const reordered = JSON.parse(JSON.stringify(evidence())) as DraftSnapshotV1
    reordered.args = { platform: 'chatgpt', question: 'Example?' }
    expect(freezeReview(item({ evidenceSnapshot: reordered })).contentHash).toBe(freezeReview(item()).contentHash)
  })

  it.each([
    ['unsupported locale', () => item({ locale: 'fr' as WorkItem['locale'] })],
    ['non-normalized text', () => item({ title: ' Review question coverage ' })],
    ['unsupported source rule', () => item({ evidenceSnapshot: { ...evidence(), ruleVersion: 'stored-recommendation.v1' } })],
    ['nested evidence corruption', () => item({ evidenceSnapshot: { ...evidence(), evidence: { ...evidence().evidence, rawAnswer: 'secret' } } as unknown as DraftSnapshotV1 })],
  ])('returns a stable failure code without raw content for %s', (_name, build) => {
    let failure: unknown
    try { freezeReview(build()) } catch (error) { failure = error }
    expect(failure).toEqual(new Error('REVIEW_VALIDATION_FAILED'))
    expect(String(failure)).not.toContain('secret')
  })

  it('keeps maximum existing text fields below the independent 128 KiB package limit', () => {
    const frozen = freezeReview(item({
      title: 'x'.repeat(160), action: 'x'.repeat(4_000), notes: 'x'.repeat(8_000),
    }))
    expect(new TextEncoder().encode(JSON.stringify(frozen.content)).byteLength).toBeLessThanOrEqual(131_072)
  })

  it('accepts evidence immediately below 65536 bytes and rejects it immediately above', () => {
    const { below, above } = evidenceAroundLimit()
    expect(new TextEncoder().encode(JSON.stringify(below)).byteLength).toBeLessThan(65_536)
    expect(new TextEncoder().encode(JSON.stringify(above)).byteLength).toBeGreaterThan(65_536)
    expect(() => freezeReview(item({ evidenceSnapshot: below }))).not.toThrow()
    expect(() => freezeReview(item({ evidenceSnapshot: above }))).toThrow('REVIEW_VALIDATION_FAILED')
  })

  it('independently enforces the formatted 131072-byte review package ceiling', () => {
    expect(() => assertReviewPackageSize(payloadAtFormattedSize(131_071))).not.toThrow()
    expect(() => assertReviewPackageSize(payloadAtFormattedSize(131_072))).not.toThrow()
    expect(() => assertReviewPackageSize(payloadAtFormattedSize(131_073))).toThrow('REVIEW_VALIDATION_FAILED')
  })
})

describe('freezeMultiSourceReview', () => {
  const base = { id: item().id, revision: item().revision, title: item().title, action: item().action, notes: item().notes, locale: item().locale }

  it('builds schemaVersion 2 content carrying every snapshot, ordered as given', () => {
    const first = item().evidenceSnapshot, second = scanEvidence()
    const frozen = freezeMultiSourceReview(base, [first, second])
    expect(frozen.content.schemaVersion).toBe(2)
    expect(frozen.content.evidenceSnapshots).toEqual([first, second])
  })

  it('refuses an empty snapshot array', () => {
    // A work item with zero live sources is a piece of work with no evidence
    // behind it -- withdrawSource already refuses to create that state by
    // refusing to withdraw the last source; this is the same invariant,
    // enforced again here rather than trusted from the caller.
    expect(() => freezeMultiSourceReview(base, [])).toThrow('REVIEW_VALIDATION_FAILED')
  })

  it('is sensitive to a change in any one snapshot, and to snapshot order', () => {
    const first = item().evidenceSnapshot, second = scanEvidence()
    const original = freezeMultiSourceReview(base, [first, second]).contentHash
    expect(freezeMultiSourceReview(base, [second, first]).contentHash).not.toBe(original)
    expect(freezeMultiSourceReview(base, [first, scanEvidence()]).contentHash).toBe(original)
  })

  it('deeply detaches frozen output from later input mutation, same as freezeReview', () => {
    const snapshots = [item().evidenceSnapshot]
    const frozen = freezeMultiSourceReview(base, snapshots)
    snapshots[0]!.args.question = 'Changed?'
    expect(frozen.content.evidenceSnapshots[0]!.args.question).toBe('Example?')
  })

  it('rejects the same malformed inputs freezeReview rejects: bad locale, forged text edits', () => {
    expect(() => freezeMultiSourceReview({ ...base, locale: 'fr' as never }, [item().evidenceSnapshot])).toThrow('REVIEW_VALIDATION_FAILED')
    expect(() => freezeMultiSourceReview({ ...base, title: 'a'.repeat(2000) }, [item().evidenceSnapshot])).toThrow('REVIEW_VALIDATION_FAILED')
  })
})
