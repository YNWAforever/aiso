import { describe, expect, it } from 'vitest'
import { reviewMemberSupport } from '@/lib/change-sets/review-support'

const viewer = 'abcdefab-cdef-4abc-8def-abcdefabcdef'
const submitter = '22222222-2222-4222-8222-222222222222'
const other = '33333333-3333-4333-8333-333333333333'
const member = (profileId: string, active = true, approver = true) => ({ profileId, active, approver })
const read = (members: unknown[], self = viewer) => ({ self, members })

describe('account member information for review help', () => {
  it('does not count the viewer or submitter as another account approver', () => {
    expect(reviewMemberSupport(read([member(viewer), member(submitter)]), viewer, submitter)).toBe('none')
    expect(reviewMemberSupport(read([member(viewer)]), viewer, viewer)).toBe('none')
  })
  it('reports only the presence of another active account approver', () => {
    expect(reviewMemberSupport(read([member(viewer, true, false), member(other)]), viewer, submitter)).toBe('other')
  })
  it.each([[false, true], [true, false], [false, false]])('excludes another member with active=%s, approver=%s', (active, approver) => {
    expect(reviewMemberSupport(read([member(viewer), member(other, active, approver)]), viewer, submitter)).toBe('none')
  })
  it('normalizes the session, viewer, submitter and member UUIDs', () => {
    expect(reviewMemberSupport(read([member(viewer.toUpperCase()), member(other)], viewer.toUpperCase()), viewer, submitter.toUpperCase())).toBe('other')
  })
  it('does not interpret platform admin or other unused fields as an approver grant', () => {
    const payload = { ...read([member(viewer), { ...member(other, true, false), is_admin: true }]), invitations: 'unused', limit: 'unused' }
    expect(reviewMemberSupport(payload, viewer, submitter)).toBe('none')
  })
  it.each([
    null, [], {}, { self: viewer, members: null }, read([]), read([member(viewer, false)]),
    read([member(other)]), read([member(viewer)], other), read([member(viewer), null]),
    read([member(viewer), { ...member(other), active: 'true' }]),
    read([member(viewer), { ...member(other), approver: 1 }]),
    read([member(viewer), { ...member(other), profileId: 'invalid' }]),
    read([member(viewer), member(viewer.toUpperCase())]),
    read([member(viewer), member(other), member(other.toUpperCase())]),
  ])('keeps malformed, mismatched, duplicate or inactive-self reads unknown: %#', payload => {
    expect(reviewMemberSupport(payload, viewer, submitter)).toBe('unknown')
  })
  it.each([['invalid', submitter], [viewer, 'invalid']])('requires both expected frozen identities', (expectedViewer, expectedSubmitter) => {
    expect(reviewMemberSupport(read([member(viewer), member(other)]), expectedViewer, expectedSubmitter)).toBe('unknown')
  })
})
