import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.stubEnv('REPORT_SHARE_SECRET', 'r'.repeat(43))

import { signReportShare } from '@/lib/reports/share'
import {
  REVIEW_LINK_TTL_DAYS, buildReviewUrl, reviewLinkExpiry, reviewTokenHash,
  signReviewToken, verifyReviewToken,
} from '@/lib/monthly-report/review-token'

/**
 * Phase 3's review signature. The properties that matter: a token decides only
 * the version it was minted for, it cannot outlive its bounded TTL, a public
 * share signature cannot be reused as a review token, and the database only ever
 * sees a hash.
 */
const reportId = '11111111-1111-4111-8111-111111111111'
const versionId = '22222222-2222-4222-8222-222222222222'
const now = new Date('2026-11-09T12:00:00Z')

describe('review tokens', () => {
  it('round-trips for the version it was minted for', () => {
    const token = signReviewToken({ reportId, versionId, expiresAt: reviewLinkExpiry(now) })
    expect(verifyReviewToken({ reportId, versionId, token, now })).toBe(true)
  })

  it('expires exactly at its expiry, and refuses a token that claims a longer life than the TTL', () => {
    const expiresAt = reviewLinkExpiry(now)
    const token = signReviewToken({ reportId, versionId, expiresAt })
    expect(verifyReviewToken({ reportId, versionId, token, now: new Date(expiresAt * 1000) })).toBe(false)
    const longLived = signReviewToken({ reportId, versionId, expiresAt: Math.floor(now.getTime() / 1000) + 10 * REVIEW_LINK_TTL_DAYS * 86_400 })
    expect(verifyReviewToken({ reportId, versionId, token: longLived, now })).toBe(false)
  })

  it('cannot be moved to another version, report, or expiry', () => {
    const expiresAt = reviewLinkExpiry(now)
    const token = signReviewToken({ reportId, versionId, expiresAt })
    expect(verifyReviewToken({ reportId, versionId: '33333333-3333-4333-8333-333333333333', token, now })).toBe(false)
    expect(verifyReviewToken({ reportId: '44444444-4444-4444-8444-444444444444', versionId, token, now })).toBe(false)
    const [expiry, signature] = token.split('.')
    const tampered = `${Number(expiry) + 60}.${signature}`
    expect(verifyReviewToken({ reportId, versionId, token: tampered, now })).toBe(false)
  })

  it('refuses malformed tokens and a public share signature reused as a review token', () => {
    for (const token of ['', 'not-a-token', '123.', `${reviewLinkExpiry(now)}.short`, `${reviewLinkExpiry(now)}.${'x'.repeat(43)}`]) {
      expect(verifyReviewToken({ reportId, versionId, token, now })).toBe(false)
    }
    const shareSignature = signReportShare({ slug: 's'.repeat(32), shareVersion: 1 })
    expect(verifyReviewToken({ reportId, versionId, token: `${reviewLinkExpiry(now)}.${shareSignature}`, now })).toBe(false)
  })

  it('hashes to the 64-character form the migration CHECK requires', () => {
    const hash = reviewTokenHash(signReviewToken({ reportId, versionId, expiresAt: reviewLinkExpiry(now) }))
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).toHaveLength(64)
  })

  it('builds a review URL for the report locale and slug, with no share signature needed', () => {
    const url = new URL(buildReviewUrl('https://aiso.example', {
      locale: 'zh-HK', publicSlug: 's'.repeat(32), reportId, versionId, expiresAt: reviewLinkExpiry(now),
    }))
    expect(url.pathname).toBe(`/zh-HK/r/${'s'.repeat(32)}`)
    expect(url.searchParams.get('s')).toBeNull()
    expect(verifyReviewToken({ reportId, versionId, token: url.searchParams.get('review')!, now })).toBe(true)
    expect(() => buildReviewUrl('http://aiso.example', { locale: 'en', publicSlug: 's'.repeat(32), reportId, versionId }))
      .toThrow(/HTTPS/)
    expect(() => buildReviewUrl('https://aiso.example', { locale: 'en', publicSlug: 'short', reportId, versionId }))
      .toThrow(/slug/)
  })
})
