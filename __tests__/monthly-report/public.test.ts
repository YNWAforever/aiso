import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
process.env.REPORT_SHARE_SECRET = 'test-report-share-secret-that-is-at-least-32-characters'

const h = vi.hoisted(() => ({ resolvePublicClientReport: vi.fn() }))
vi.mock('@/lib/reports/store', () => ({ resolvePublicClientReport: h.resolvePublicClientReport }))

import { signReportShare } from '@/lib/reports/share'
import { resolvePublishedMonthlyReport } from '@/lib/monthly-report/public'

const slug = 'm'.repeat(32), shareVersion = 3
const signature = signReportShare({ slug, shareVersion })
const snapshot = {
  snapshotSchemaVersion: 2, kind: 'monthly', locale: 'en', month: '2026-11',
  period: { start: '2026-10-31T16:00:00.000Z', end: '2026-11-30T16:00:00.000Z' },
  branding: { agencyName: 'Fimmick', logoUrl: 'https://agency.example/logo.png', primaryColor: '#123ABC', contactLabel: 'Talk to us',
    contactUrl: 'https://agency.example/contact', attribution: 'Powered by Fimmick AISO', internal: 'SENTINEL_BRANDING' },
  client: { name: 'Bakery', domain: 'bakery.hk' },
  delivered: { verifiedLive: [{ title: 'Add FAQ schema', recordedAt: '2026-11-06T01:00:00.000Z', versionId: 'SENTINEL_VERSION_ID' }], selfReported: [] },
  visibility: { state: 'not_enough_data', reason: 'movement_rule_pending' },
  search: { opening: { state: 'not_connected' }, closing: { state: 'not_recorded' } },
  nextMonth: { openWorkItems: [{ title: 'Open item', secret: 'SENTINEL_ITEM' }] },
  executiveSummary: 'A good month.', builtAt: '2026-12-04T00:00:00.000Z', extra: 'SENTINEL_TOP',
}
const stored = (over: { report?: object; version?: object; account?: object } = {}) => ({
  report: { id: 'r1', account_id: 'acc', client_id: 'c', status: 'published', public_slug: slug, share_version: shareVersion,
    published_version_id: 'v1', published_at: '2026-12-04T02:00:00.000Z', ...over.report },
  version: { id: 'v1', report_id: 'r1', account_id: 'acc', client_id: 'c', locale: 'en', snapshot_schema_version: 2, snapshot, ...over.version },
  account: { id: 'acc', plan: 'pro', status: 'active', stripe_subscription_id: 'sub_1', ...over.account },
})
const resolve = (over: Partial<{ slug: unknown; version: unknown; signature: unknown }> = {}) =>
  resolvePublishedMonthlyReport({ slug, version: String(shareVersion), signature, ...over })

beforeEach(() => { h.resolvePublicClientReport.mockReset(); h.resolvePublicClientReport.mockResolvedValue(stored()); vi.spyOn(console, 'warn').mockImplementation(() => {}) })

describe('resolvePublishedMonthlyReport', () => {
  it('reads nothing for a bad signature, a malformed version or a non-string slug', async () => {
    expect(await resolve({ signature: 'x'.repeat(43) })).toBeNull()
    expect(await resolve({ version: '0' })).toBeNull()
    expect(await resolve({ version: '3.5' })).toBeNull()
    expect(await resolve({ slug: 42 })).toBeNull()
    expect(h.resolvePublicClientReport).not.toHaveBeenCalled()
  })

  it('looks up only monthly reports, and serves a published one through the allow-list', async () => {
    const result = await resolve()
    expect(h.resolvePublicClientReport).toHaveBeenCalledWith({ publicSlug: slug, shareVersion, kind: 'monthly' })
    expect(result?.publishedAt).toBe('2026-12-04T02:00:00.000Z')
    expect(result?.report).toMatchObject({ kind: 'monthly', month: '2026-11', client: { name: 'Bakery' }, executiveSummary: 'A good month.',
      branding: { agencyName: 'Fimmick', primaryColor: '#123ABC', contactLabel: 'Talk to us' },
      delivered: { verifiedLive: [{ title: 'Add FAQ schema', recordedAt: '2026-11-06T01:00:00.000Z' }] } })
    const json = JSON.stringify(result)
    for (const leak of ['SENTINEL_', 'agency.example', 'logoUrl', 'contactUrl']) expect(json).not.toContain(leak)
  })

  it.each([
    ['a draft', { report: { status: 'draft' } }],
    ['another share version', { report: { share_version: 4 } }],
    ['an unpublished version', { report: { published_version_id: 'v2' } }],
    ['a version of another report', { version: { report_id: 'r9' } }],
    ['a version of another account', { version: { account_id: 'acc-2' } }],
    ['a scan snapshot', { version: { snapshot_schema_version: 1 } }],
    ['a locale mismatch', { version: { locale: 'zh-HK' } }],
    ['an owner without client reports', { account: { plan: 'free', stripe_subscription_id: null } }],
    ['a malformed snapshot', { version: { snapshot: { ...snapshot, kind: 'scan' } } }],
  ])('answers a neutral null for %s', async (_label, over) => {
    h.resolvePublicClientReport.mockResolvedValue(stored(over))
    expect(await resolve()).toBeNull()
  })

  it('answers a neutral null when the lookup itself fails', async () => {
    h.resolvePublicClientReport.mockRejectedValue(new Error('db'))
    expect(await resolve()).toBeNull()
  })

  it('copies only public search fields, including missing states, without leaking nested stored metadata', async () => {
    h.resolvePublicClientReport.mockResolvedValue(stored({ version: { snapshot: { ...snapshot,
      search: {
        opening: { state: 'ok', from: '2026-10-04', through: '2026-10-31', days: 2, clicks: 17, impressions: 241,
          privateBinding: 'SENTINEL_SEARCH_OPENING' },
        closing: { state: 'not_recorded', internal: 'SENTINEL_SEARCH_CLOSING' },
      },
    } } }))
    const result = await resolve()
    expect(result?.report.search).toEqual({
      opening: { state: 'ok', from: '2026-10-04', through: '2026-10-31', days: 2, clicks: 17, impressions: 241 },
      closing: { state: 'not_recorded' },
    })
    expect(JSON.stringify(result)).not.toContain('SENTINEL_SEARCH')
  })
})
