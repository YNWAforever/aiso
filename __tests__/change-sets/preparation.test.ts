import { expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { freezeReview, freezeMultiSourceReview } from '@/lib/change-sets/validation'
import { versionDTO } from '@/lib/change-sets/store'
import { fingerprintEvidence } from '@/lib/opportunities/fingerprint'
import { createDeliveryExport } from '@/lib/delivery/export'
import type { VersionDetail } from '@/lib/change-sets/types'
import { draft, saved } from './fixtures'

const preparation = () => ({
  schemaVersion: 1 as const,
  targetUrl: 'https://example.test/services',
  acceptanceCriteria: 'Synthetic owner checks the exact page description after manual application.',
})

it('freezes work details in both single and multi-source versions and detaches later edits', () => {
  const item = draft(), details = preparation()
  const single = freezeReview(item, details)
  const multi = freezeMultiSourceReview(item, [item.evidenceSnapshot], details)
  expect(single.content).toHaveProperty('preparation', {
    schemaVersion: 1, targetUrl: 'https://example.test/services',
    acceptanceCriteria: 'Synthetic owner checks the exact page description after manual application.',
  })
  expect(multi.content).toHaveProperty('preparation', preparation())
  const retainedHash = single.contentHash
  details.targetUrl = 'https://example.test/changed-later'
  details.acceptanceCriteria = 'Later criteria'
  expect(single.content).toHaveProperty('preparation.targetUrl', 'https://example.test/services')
  expect(multi.content).toHaveProperty('preparation.acceptanceCriteria', preparation().acceptanceCriteria)
  expect(fingerprintEvidence(single.content)).toBe(retainedHash)
  expect(freezeReview(item, details).contentHash).not.toBe(retainedHash)
})

it('distinguishes a recorded empty preparation from a legacy version that recorded no preparation', async () => {
  const legacy = freezeReview(draft())
  const empty = freezeReview(draft(), { schemaVersion: 1, targetUrl: null, acceptanceCriteria: '' })
  expect(legacy.content).not.toHaveProperty('preparation')
  expect(empty.content).toHaveProperty('preparation', { schemaVersion: 1, targetUrl: null, acceptanceCriteria: '' })
  expect(empty.contentHash).not.toBe(legacy.contentHash)
  expect(versionDTO(await saved())).not.toHaveProperty('preparation')
})

it.each([
  null,
  { ...preparation(), schemaVersion: 2 },
  { ...preparation(), targetUrl: 'javascript:alert(1)' },
  { ...preparation(), targetUrl: 'https://user:synthetic-only@example.test/path' },
  { ...preparation(), targetUrl: '' },
  { ...preparation(), acceptanceCriteria: 'x'.repeat(4001) },
  { schemaVersion: 1, targetUrl: null },
  { ...preparation(), verified: true },
])('rejects invalid frozen preparation without returning its input', details => {
  expect(() => freezeReview(draft(), details as never)).toThrow('REVIEW_VALIDATION_FAILED')
})

it('validates and displays only the retained preparation, rejecting tampered fields or hash', async () => {
  const row = await saved(), frozen = freezeReview(draft(), preparation())
  const prepared = { ...row, content: frozen.content, content_hash: frozen.contentHash, validation: frozen.validation }
  expect(versionDTO(prepared)).toHaveProperty('preparation.targetUrl', 'https://example.test/services')
  expect(() => versionDTO({ ...prepared, content: { ...frozen.content, preparation: { ...preparation(), targetUrl: 'https://example.test/tampered' } } }))
    .toThrow('CHANGE_SET_UNAVAILABLE')
  expect(() => versionDTO({ ...prepared, content: { ...frozen.content, preparation: { ...preparation(), verified: true } } }))
    .toThrow('CHANGE_SET_UNAVAILABLE')
})

it('keeps legacy content hashes unchanged for both stored schema versions', () => {
  const item = draft()
  const one = freezeReview(item), two = freezeMultiSourceReview(item, [item.evidenceSnapshot])
  expect(one.contentHash).toBe('e313ab64c58f8d1be5b196c97bf0d9d9227e013a914c0f7c08bf11461bc92845')
  expect(two.contentHash).toBe('b6c40554095f9114d2193f7d3174bdc5190825c270cbb12def28a52aefb47649')
  expect(one.content).not.toHaveProperty('preparation')
  expect(two.content).not.toHaveProperty('preparation')
})

it('approved single-source export retains the exact submitted preparation', async () => {
  const row = await saved(), frozen = freezeReview(draft(), preparation())
  const decoded = versionDTO({ ...row, content: frozen.content, content_hash: frozen.contentHash, validation: frozen.validation })
  const version: VersionDetail = {
    ...decoded,
    decision: {
      decision: 'approved', reason: 'Synthetic reviewed version only.',
      decidedBy: { profileId: '99999999-9999-4999-8999-999999999999', displayName: 'Synthetic reviewer', role: 'account_approver' },
      decidedAt: '2026-09-07T00:00:00.000Z',
    },
  }
  expect(JSON.parse(createDeliveryExport(version, 'json').body).content).toHaveProperty('preparation', preparation())
})
