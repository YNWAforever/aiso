import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTranslator, NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

process.env.REPORT_SHARE_SECRET = 'test-report-share-secret-that-is-at-least-32-characters'
const h = vi.hoisted(() => ({ report: null as unknown, recorded: [] as string[] }))
vi.mock('server-only', () => ({}))
// getTranslations('ns') follows the request (dashboard) locale, here en; getTranslations({ locale, namespace }) follows the argument.
vi.mock('next-intl/server', () => ({
  getTranslations: async (arg: string | { locale: string; namespace: string }) => typeof arg === 'string'
    ? createTranslator({ locale: 'en', messages: en, namespace: arg as never })
    : createTranslator({ locale: arg.locale, messages: arg.locale === 'zh-HK' ? zh : en, namespace: arg.namespace as never }),
}))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND') }, useRouter: () => ({ refresh: () => {} }) }))
vi.mock('@/lib/auth', () => ({ requireAuth: async () => ({ account_id: 'acc', accounts: { plan: 'pro', status: 'active', stripe_subscription_id: 'sub_1' } }) }))
vi.mock('@/lib/db', () => ({ db: () => async () => [{ brand_name: 'Bakery', domain: 'bakery.hk' }] }))
vi.mock('@/lib/monthly-report/store', () => ({ loadMonthlyReport: async () => h.report }))
vi.mock('@/lib/brand-month/store', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/brand-month/store')>()
  return { ...actual, readRecordedSnapshotKinds: async () => h.recorded }
})

import MonthlyReportPage from '@/app/[lang]/dashboard/[clientId]/month/report/page'

const CLIENT = '11111111-1111-4111-8111-111111111111'
const snapshot = (locale: 'en' | 'zh-HK', summary: string) => ({
  snapshotSchemaVersion: 2, kind: 'monthly', locale, month: '2026-11', period: { start: 'a', end: 'b' },
  branding: { agencyName: 'Fimmick', logoUrl: null, primaryColor: '#111827', contactLabel: null, contactUrl: null, attribution: 'Powered by Fimmick AISO' },
  client: { name: 'Bakery', domain: 'bakery.hk' }, delivered: { verifiedLive: [], selfReported: [] },
  visibility: { state: 'not_enough_data', reason: 'movement_rule_pending' },
  search: { opening: { state: 'not_connected' }, closing: { state: 'not_recorded' } }, nextMonth: { openWorkItems: [] },
  executiveSummary: summary, builtAt: 'x',
})
const render = async (m = '2026-11') => renderToStaticMarkup(
  <NextIntlClientProvider locale="en" messages={en}>{await MonthlyReportPage({ params: Promise.resolve({ lang: 'en', clientId: CLIENT }), searchParams: Promise.resolve({ m }) })}</NextIntlClientProvider>)

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-12-05T00:00:00Z')); h.report = null; h.recorded = ['opening', 'closing'] })

describe('monthly report page', () => {
  it('renders a zh-HK report in zh-HK from the English dashboard, with the page chrome in English', async () => {
    h.report = { reportId: 'r1', status: 'draft', versionId: 'v2', versionNumber: 2, snapshot: snapshot('zh-HK', '十一月摘要。') }
    const html = await render()
    expect(html).toContain('lang="zh-HK"')
    expect(html).toContain('本月已交付')
    expect(html).toContain('數據尚未足夠。')
    expect(html).not.toContain('Delivered this month')
    expect(html).toContain('Draft · version 2')
    expect(html).toContain('Save draft')
  })

  it('fills the editor with the stored summary, including one the server wrote by default', async () => {
    h.report = { reportId: 'r1', status: 'draft', versionId: 'v1', versionNumber: 1, snapshot: snapshot('en', 'November 2026: 0 changes verified live and 0 self-reported.') }
    const html = await render()
    expect(html).toMatch(/<textarea[^>]*>November 2026: 0 changes verified live and 0 self-reported\.<\/textarea>/)
  })

  it('opens a month older than the lookback only to stop sharing its report, and 404s one with no report', async () => {
    h.report = { reportId: 'r1', status: 'published', versionId: 'v1', versionNumber: 1, publicSlug: 'p'.repeat(32), shareVersion: 1,
      publishedVersionId: 'v1', publishedLocale: 'en', snapshot: snapshot('en', 'Old month.') }
    const html = await render('2024-03')
    expect(html).toContain('Stop sharing')
    expect(html).not.toContain('Save draft')
    expect(html).not.toContain('Publish this version')
    h.report = null
    await expect(render('2024-03')).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(render('2027-01')).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('offers to record the month figures before drafting, and stays quiet once they are recorded', async () => {
    // Production had never recorded a snapshot, so a drafted report would freeze
    // "Not recorded" into a published document with no way to fix it from here.
    h.report = null
    h.recorded = []
    const html = await render()
    expect(html).toContain('Record month figures')
    expect(html).toContain('This month&#x27;s opening and closing figures have not been recorded yet')
    h.recorded = ['opening', 'closing']
    expect(await render()).not.toContain('Record month figures')
  })
})
