import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.stubEnv('REPORT_SHARE_SECRET', 'r'.repeat(43))
vi.stubEnv('PUBLIC_SCAN_RATE_LIMIT_SECRET', 's'.repeat(43))

const h = vi.hoisted(() => ({
  target: null as unknown,
  reviews: [] as unknown[],
  recorded: { state: 'recorded', decidedAt: '2026-12-05T02:00:00.000Z' } as unknown,
  allowed: true,
}))
vi.mock('@/lib/monthly-report/store', () => ({
  loadMonthlyReviewTarget: async () => h.target,
  readMonthlyReviews: async () => h.reviews,
  recordMonthlyReviewDecision: async () => h.recorded,
}))
vi.mock('@/lib/security/durable-rate-limit', () => ({
  consumeFromNeon: async () => ({ allowed: h.allowed, remaining: h.allowed ? 9 : 0, resetAt: Date.now() + 60_000 }),
  deriveRateLimitKey: (_domain: string, identity: string) => `key:${identity}`,
  resolveRateLimitSecret: () => 's'.repeat(43),
  defaultRateLimitRuntime: () => ({ nodeEnv: 'test', secret: 's'.repeat(43) }),
}))
vi.mock('@/lib/tier', () => ({ resolveCommercialEntitlement: () => ({ features: { client_reports_online: true } }) }))
vi.mock('@/lib/app-origin', () => ({ appOrigin: () => 'https://aiso.example' }))

import { monthlyReviewLink, readReviewState, submitMonthlyReview } from '@/lib/monthly-report/review'
import { reviewLinkExpiry, signReviewToken } from '@/lib/monthly-report/review-token'

const reportId = '11111111-1111-4111-8111-111111111111'
const versionId = '22222222-2222-4222-8222-222222222222'
const slug = 's'.repeat(32)
const now = new Date('2026-12-05T00:00:00Z')
const token = signReviewToken({ reportId, versionId, expiresAt: reviewLinkExpiry(now) })
const target = {
  reportId, versionId, accountId: 'acc', clientId: 'client', month: '2026-11', status: 'draft',
  publicSlug: slug, shareVersion: 1, versionNumber: 2, locale: 'en' as const, snapshot: {},
  publishedAt: null, account: { plan: 'pro', status: 'active', stripe_subscription_id: 'sub_1' },
}
const body = (extra: Record<string, unknown> = {}) => ({ slug, review: token, decision: 'approved', ...extra })

beforeEach(() => {
  h.target = target; h.reviews = []; h.recorded = { state: 'recorded', decidedAt: '2026-12-05T02:00:00.000Z' }; h.allowed = true
})

describe('submitMonthlyReview', () => {
  it('records an approval for the report current version', async () => {
    expect(await submitMonthlyReview(body({ reviewerName: ' Mei ', comment: ' Looks good ' }), now))
      .toEqual({ state: 'recorded', decision: 'approved', decidedAt: '2026-12-05T02:00:00.000Z' })
  })

  it('requires a comment on changes requested and otherwise makes no write', async () => {
    expect(await submitMonthlyReview(body({ decision: 'changes_requested' }), now)).toEqual({ state: 'invalid' })
    expect(await submitMonthlyReview(body({ decision: 'changes_requested', comment: '   ' }), now)).toEqual({ state: 'invalid' })
    expect(await submitMonthlyReview(body({ decision: 'changes_requested', comment: 'Fix the first section' }), now))
      .toMatchObject({ state: 'recorded', decision: 'changes_requested' })
  })

  it.each([
    ['a different version', signReviewToken({ reportId, versionId: '33333333-3333-4333-8333-333333333333', expiresAt: reviewLinkExpiry(now) })],
    ['an expired link', signReviewToken({ reportId, versionId, expiresAt: Math.floor(now.getTime() / 1000) - 1 })],
  ])('refuses %s without writing', async (_label, review) => {
    expect(await submitMonthlyReview(body({ review }), now)).toEqual({ state: 'not_found' })
  })

  it('refuses when the report is unknown, the decision is already recorded, or the allowance is spent', async () => {
    h.target = null
    expect(await submitMonthlyReview(body(), now)).toEqual({ state: 'not_found' })
    h.target = target; h.recorded = { state: 'already' }
    expect(await submitMonthlyReview(body(), now)).toEqual({ state: 'already', decision: 'approved' })
    h.allowed = false
    expect(await submitMonthlyReview(body(), now)).toMatchObject({ state: 'rate_limited' })
  })

  it.each([
    [{}], [{ slug, decision: 'approved' }], [{ slug: 'short', review: token, decision: 'approved' }],
    [{ slug, review: '', decision: 'approved' }], [{ slug, review: token, decision: 'maybe' }],
    [{ slug, review: token, decision: 'approved', reviewerName: '   ' }],
    [{ slug, review: token, decision: 'approved', comment: 'x'.repeat(2001) }],
  ])('rejects a malformed body %j before any lookup', async input => {
    expect(await submitMonthlyReview(input, now)).toEqual({ state: 'invalid' })
  })
})

describe('review state and link', () => {
  const review = (versionIdValue: string, versionNumber: number, decision: 'approved' | 'changes_requested' = 'approved') => ({
    versionId: versionIdValue, versionNumber, decision, reviewerName: null, comment: null, decidedAt: '2026-12-05T02:00:00.000Z',
  })

  it('reports a decision on the current version, and an earlier one as earlier', async () => {
    h.reviews = [review(versionId, 2)]
    expect(await readReviewState({ accountId: 'acc', clientId: 'client', reportId, latestVersionId: versionId }))
      .toMatchObject({ current: { versionNumber: 2 }, earlier: null })

    h.reviews = [review('v1', 1, 'changes_requested')]
    expect(await readReviewState({ accountId: 'acc', clientId: 'client', reportId, latestVersionId: versionId }))
      .toMatchObject({ current: null, earlier: { versionNumber: 1, decision: 'changes_requested' } })
  })

  it('builds a review link in the report locale against the app origin', () => {
    const url = new URL(monthlyReviewLink({ locale: 'zh-HK', publicSlug: slug, reportId, versionId }))
    expect(url.origin).toBe('https://aiso.example')
    expect(url.pathname).toBe(`/zh-HK/r/${slug}`)
    expect(url.searchParams.get('review')).toMatch(/^(\d{10})\.[A-Za-z0-9_-]{43}$/)
  })
})
