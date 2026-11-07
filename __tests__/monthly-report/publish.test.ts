import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

process.env.REPORT_SHARE_SECRET = 'test-report-share-secret-that-is-at-least-32-characters'
const m = vi.hoisted(() => ({ load: vi.fn(), publish: vi.fn(), revoke: vi.fn(), profile: null as unknown, rows: [] as unknown[] }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth', () => ({ getProfile: vi.fn(async () => m.profile) }))
vi.mock('@/lib/monthly-report/store', async () => {
  const actual = await vi.importActual<typeof import('@/lib/monthly-report/store')>('@/lib/monthly-report/store')
  return { ...actual, loadMonthlyReport: m.load, publishMonthlyReport: m.publish, revokeMonthlyReport: m.revoke }
})
vi.mock('@/lib/db', () => ({ db: () => async () => m.rows }))

import { POST as PUBLISH } from '@/app/api/clients/[clientId]/months/[month]/report/publish/route'
import { POST as REVOKE } from '@/app/api/clients/[clientId]/months/[month]/report/revoke/route'
import { monthlyShareUrl } from '@/lib/monthly-report/service'
import { verifyReportShare } from '@/lib/reports/share'

const CLIENT = '11111111-1111-4111-8111-111111111111'
const VERSION = '22222222-2222-4222-8222-222222222222'
const ctx = { params: Promise.resolve({ clientId: CLIENT, month: '2026-11' }) }
const publish = (body: unknown) => PUBLISH(new Request('http://localhost', { method: 'POST', body: JSON.stringify(body) }), ctx)
const draft = (over: Record<string, unknown> = {}) => ({ reportId: 'r1', status: 'draft', publicSlug: 'p'.repeat(32), shareVersion: 1, publishedVersionId: null,
  publishedLocale: null, versionId: VERSION, versionNumber: 2, snapshot: { locale: 'zh-HK' }, ...over })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-12-05T00:00:00Z'))
  m.profile = { id: 'u1', account_id: 'acc-1', accounts: { plan: 'pro', status: 'active', stripe_subscription_id: 'sub_1' } }
  m.load.mockReset(); m.load.mockResolvedValue(draft())
  m.publish.mockReset(); m.publish.mockResolvedValue({ status: 'published', publicSlug: 's'.repeat(32), shareVersion: 2 })
  m.revoke.mockReset(); m.revoke.mockResolvedValue({ status: 'revoked', publicSlug: 'x'.repeat(32), shareVersion: 3 })
})
afterEach(() => { vi.useRealTimers() })

describe('publishing a monthly report', () => {
  it('publishes exactly the reviewed version and returns a signed link in its language', async () => {
    const res = await publish({ versionId: VERSION })
    expect(res.status).toBe(200)
    const { shareUrl } = await res.json()
    expect(m.publish.mock.calls[0][0]).toEqual({ accountId: 'acc-1', clientId: CLIENT, reportId: 'r1', reviewedVersionId: VERSION })
    const url = new URL(shareUrl)
    expect(url.pathname).toBe(`/zh-HK/r/${'s'.repeat(32)}`)
    expect(verifyReportShare({ slug: 's'.repeat(32), shareVersion: 2, signature: url.searchParams.get('s')! })).toBe(true)
  })

  it('refuses a stale review, before or inside the publish', async () => {
    expect((await publish({ versionId: '33333333-3333-4333-8333-333333333333' })).status).toBe(409)
    expect(m.publish).not.toHaveBeenCalled()
    m.publish.mockRejectedValue(new Error('reviewed version is stale'))
    expect((await publish({ versionId: VERSION })).status).toBe(409)
  })

  it('refuses a bad body, an unknown month report, and 503s a failed write', async () => {
    for (const body of [{}, { versionId: 'nope' }, { versionId: VERSION, status: 'published' }]) expect((await publish(body)).status).toBe(400)
    m.load.mockResolvedValue(null)
    expect((await publish({ versionId: VERSION })).status).toBe(404)
    m.load.mockResolvedValue(draft()); m.publish.mockRejectedValue(new Error('db'))
    expect((await publish({ versionId: VERSION })).status).toBe(503)
  })

  it('stops sharing only a published report', async () => {
    expect((await REVOKE(new Request('http://localhost', { method: 'POST' }), ctx)).status).toBe(404)
    m.load.mockResolvedValue(draft({ status: 'published' }))
    expect((await REVOKE(new Request('http://localhost', { method: 'POST' }), ctx)).status).toBe(200)
    expect(m.revoke.mock.calls[0][0]).toEqual({ accountId: 'acc-1', clientId: CLIENT, reportId: 'r1' })
  })

  it('shows a share link only while published, in the published version\'s language', () => {
    expect(monthlyShareUrl(draft())).toBeNull()
    const url = monthlyShareUrl(draft({ status: 'published', publishedLocale: 'en' }))!
    expect(new URL(url).pathname).toBe(`/en/r/${'p'.repeat(32)}`)
  })

  it('never accepts a publish result that is not a monthly report', async () => {
    const { publishMonthlyReport: realPublish } = await vi.importActual<typeof import('@/lib/monthly-report/store')>('@/lib/monthly-report/store')
    m.rows = [{ result: { report: { status: 'published', kind: 'scan', public_slug: 'a'.repeat(32), share_version: 1 } } }]
    await expect(realPublish({ accountId: 'a', clientId: 'c', reportId: 'r', reviewedVersionId: VERSION })).rejects.toThrow(/UNCONFIRMED/)
    m.rows = [{ result: { report: { status: 'published', kind: 'monthly', public_slug: 'a'.repeat(32), share_version: 1 } } }]
    await expect(realPublish({ accountId: 'a', clientId: 'c', reportId: 'r', reviewedVersionId: VERSION })).resolves.toEqual({ status: 'published', publicSlug: 'a'.repeat(32), shareVersion: 1 })
  })
})
