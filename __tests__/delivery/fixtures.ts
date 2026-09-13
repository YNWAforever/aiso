import { freezeReview } from '@/lib/change-sets/validation'
import type { ActorSnapshot, VersionDetail } from '@/lib/change-sets/types'
import type { WorkItem } from '@/lib/work-items/schema'

export const ID = '123e4567-e89b-42d3-a456-426614174000'
export const ACTOR_ID = '123e4567-e89b-42d3-a456-426614174001'
export const VERSION_ID = '123e4567-e89b-42d3-a456-426614174002'
export const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174003'
export const member: ActorSnapshot = { profileId: ACTOR_ID, displayName: null, role: 'account_member' }
/** Narrowed to the v1 member: this fixture is always built via freezeReview, never freezeMultiSourceReview. */
export function approvedVersion(): Extract<VersionDetail, { schemaVersion: 1 }> {
  const draft: WorkItem = {
    id: ID, clientId: REQUEST_ID, status: 'draft', revision: 1,
    title: 'Review question coverage', action: 'Review the recorded response.', notes: '保留證據 é', locale: 'en',
    createdAt: '2026-09-06T00:00:00.000Z', updatedAt: '2026-09-06T00:00:00.000Z',
    evidenceSnapshot: {
      schemaVersion: 1, source: { kind: 'pulse-metric', id: ID }, ruleVersion: 'pulse-brand-absent.v1',
      evidence: { kind: 'pulse-metric', id: ID, promptId: null, question: 'Example?', platform: 'chatgpt',
        scanWeek: '2026-08-31', recordedAt: null, result: 'success', hasAnswer: true, brandMentioned: false,
        answerDigest: 'a'.repeat(64), provenance: 'retained-pulse-metric', limitations: ['unknown-answer-coverage'] },
      limitations: ['unknown-answer-coverage'], titleKey: 'review-question-coverage', actionKey: 'review-question-coverage',
      args: { question: 'Example?', platform: 'chatgpt' }, locale: 'en',
      initialTitle: 'Review question coverage', initialAction: 'Review the recorded response.',
    },
  }
  const frozen = freezeReview(draft)
  return { ...frozen.content, contentHash: frozen.contentHash, validation: frozen.validation,
    id: VERSION_ID, versionNumber: 1, submittedBy: { ...member }, submittedAt: '2026-09-06T00:00:00.000Z',
    decision: { decision: 'approved', reason: 'Reviewed', decidedBy: { profileId: ID, displayName: 'Reviewer', role: 'account_approver' }, decidedAt: '2026-09-06T01:00:00.000Z' },
    capabilities: { canDecide: false } }
}
export function attestInput() {
  return { contentHash: 'a'.repeat(64), destination: 'Site', deliveredAt: '2026-09-07T00:00:00.000Z', note: 'Delivered manually', requestId: REQUEST_ID }
}
export function eventRow(): Record<string, unknown> {
  return { id: ID, schema_version: 1, version_id: VERSION_ID, content_hash: 'a'.repeat(64), actor_id: ACTOR_ID,
    actor: { ...member }, recorded_at: '2026-09-07T01:00:00.123456Z', kind: 'attest',
    destination: 'Site', delivered_at: '2026-09-07T00:00:00.000Z', note: 'Delivered manually', target_attestation_id: null, reason: null }
}
