import { describe, expect, it } from 'vitest'
import { parseApproverAccess, parseReviewDecision } from '@/lib/approvals/input'

const PROFILE_ID = '123e4567-e89b-42d3-a456-426614174000'
const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174001'

describe('approval input contracts', () => {
  it('normalizes decision reasons and request UUIDs', () => {
    expect(parseReviewDecision({ decision: 'approved', reason: ' Cafe\u0301 ', requestId: REQUEST_ID.toUpperCase() }))
      .toEqual({ decision: 'approved', reason: 'Café', requestId: REQUEST_ID })
  })

  it('counts decision reason boundaries by Unicode code point', () => {
    expect(parseReviewDecision({ decision: 'changes_requested', reason: '😀'.repeat(2_000), requestId: REQUEST_ID }).reason)
      .toHaveLength(4_000)
    expect(() => parseReviewDecision({ decision: 'approved', reason: '😀'.repeat(2_001), requestId: REQUEST_ID }))
      .toThrow('INVALID_APPROVAL_INPUT')
  })

  it.each([
    null,
    [],
    {},
    { decision: 'approved', reason: ' ', requestId: REQUEST_ID },
    { decision: 'pending', reason: 'Review', requestId: REQUEST_ID },
    { decision: 'approved', reason: 'Review', requestId: 'bad' },
    { decision: 'approved', reason: 'Review', requestId: REQUEST_ID, actorId: PROFILE_ID },
  ])('rejects invalid review decision input %#', (input) => {
    expect(() => parseReviewDecision(input)).toThrow('INVALID_APPROVAL_INPUT')
  })

  it('accepts grant revision zero and normalizes its fields', () => {
    expect(parseApproverAccess({
      profileId: PROFILE_ID.toUpperCase(), action: 'grant', reason: ' Review duty ', expectedRevision: 0, requestId: REQUEST_ID.toUpperCase(),
    })).toEqual({ profileId: PROFILE_ID, action: 'grant', reason: 'Review duty', expectedRevision: 0, requestId: REQUEST_ID })
  })

  it.each([
    null,
    [],
    { profileId: PROFILE_ID, action: 'grant', reason: 'Review duty', expectedRevision: -1, requestId: REQUEST_ID },
    { profileId: PROFILE_ID, action: 'grant', reason: 'Review duty', expectedRevision: 1.5, requestId: REQUEST_ID },
    { profileId: PROFILE_ID, action: 'grant', reason: 'Review duty', expectedRevision: Number.MAX_SAFE_INTEGER + 1, requestId: REQUEST_ID },
    { profileId: PROFILE_ID, action: 'remove', reason: 'Review duty', expectedRevision: 0, requestId: REQUEST_ID },
    { profileId: 'bad', action: 'revoke', reason: 'Review duty', expectedRevision: 1, requestId: REQUEST_ID },
    { profileId: PROFILE_ID, action: 'grant', reason: '', expectedRevision: 0, requestId: REQUEST_ID },
    { profileId: PROFILE_ID, action: 'grant', reason: 'Review duty', expectedRevision: 0, requestId: REQUEST_ID, accountId: PROFILE_ID },
  ])('rejects invalid approver access input %#', (input) => {
    expect(() => parseApproverAccess(input)).toThrow('INVALID_APPROVAL_INPUT')
  })
})
