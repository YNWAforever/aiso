import { describe, expect, it, vi } from 'vitest'
import type { DraftSnapshotV1 } from '@/lib/opportunities/types'
import type { WorkItem } from '@/lib/work-items/schema'
import { freezeReview } from '@/lib/change-sets/validation'

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

  it('accepts evidence at the independent 64 KiB boundary and a package below 128 KiB', () => {
    const frozen = freezeReview(item({
      title: 'x'.repeat(160), action: 'x'.repeat(4_000), notes: 'x'.repeat(8_000),
    }))
    expect(new TextEncoder().encode(JSON.stringify(frozen.content)).byteLength).toBeLessThanOrEqual(131_072)
  })
})
