import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({ rows: [] as unknown[], calls: [] as { text: string; values: unknown[] }[] }))
vi.mock('@/lib/db', () => ({
  db: () => (strings: TemplateStringsArray, ...values: unknown[]) => {
    h.calls.push({ text: strings.join('?'), values })
    return Promise.resolve(h.rows)
  },
}))

import { listMonthlyReports } from '@/lib/monthly-report/store'

const ACCOUNT = '10000000-0000-4000-8000-000000000001'
const CLIENT = '30000000-0000-4000-8000-000000000001'

beforeEach(() => { h.calls = []; h.rows = [] })

describe('listMonthlyReports', () => {
  it('lists only monthly reports of this account and client, newest month first', async () => {
    const list = await listMonthlyReports(ACCOUNT, CLIENT)
    expect(list).toEqual([])
    expect(h.calls[0].text).toContain("r.kind = 'monthly'")
    expect(h.calls[0].text).toContain('r.account_id')
    expect(h.calls[0].text).toContain('r.client_id')
    expect(h.calls[0].text).toContain('order by r.report_month desc')
    expect(h.calls[0].values).toEqual([ACCOUNT, CLIENT])
  })

  it('maps a published row, including the published version and its locale, without inventing values', async () => {
    h.rows = [{
      report_id: 'r1', status: 'published', public_slug: 's'.repeat(32), share_version: 3,
      published_at: '2026-12-04T02:00:00.000Z', month: '2026-11-01', version_number: 4,
      locale: 'zh-HK', published_version_number: 2, published_locale: 'zh-HK',
    }]
    expect(await listMonthlyReports(ACCOUNT, CLIENT)).toEqual([{
      reportId: 'r1', month: '2026-11', status: 'published', publicSlug: 's'.repeat(32), shareVersion: 3,
      locale: 'zh-HK', versionNumber: 4, publishedVersionNumber: 2, publishedLocale: 'zh-HK',
      publishedAt: '2026-12-04T02:00:00.000Z',
    }])
  })

  it('leaves an unpublished row without a published version or share state', async () => {
    h.rows = [{
      report_id: 'r2', status: 'draft', public_slug: 't'.repeat(32), share_version: 1,
      published_at: null, month: '2026-11-01', version_number: 1, locale: 'legacy',
      published_version_number: null, published_locale: null,
    }]
    expect(await listMonthlyReports(ACCOUNT, CLIENT)).toEqual([{
      reportId: 'r2', month: '2026-11', status: 'draft', publicSlug: 't'.repeat(32), shareVersion: 1,
      locale: 'en', versionNumber: 1, publishedVersionNumber: null, publishedLocale: null, publishedAt: null,
    }])
  })
})
