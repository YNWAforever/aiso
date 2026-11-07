import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTranslator, NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

const h = vi.hoisted(() => ({ report: null as unknown }))
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
const render = async () => renderToStaticMarkup(
  <NextIntlClientProvider locale="en" messages={en}>{await MonthlyReportPage({ params: Promise.resolve({ lang: 'en', clientId: CLIENT }), searchParams: Promise.resolve({ m: '2026-11' }) })}</NextIntlClientProvider>)

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-12-05T00:00:00Z')) })

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
})
