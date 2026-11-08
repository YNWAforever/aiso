import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTranslator, NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({ reports: vi.fn(), monthly: vi.fn(), client: vi.fn(), shareUrl: vi.fn(), notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }) }))
vi.mock('next-intl/server', () => ({
  getTranslations: async (arg: string | { locale: string; namespace: string }) => typeof arg === 'string'
    ? createTranslator({ locale: 'en', messages: en, namespace: arg as never })
    : createTranslator({ locale: arg.locale, messages: arg.locale === 'zh-HK' ? zh : en, namespace: arg.namespace as never }),
}))
vi.mock('next/navigation', () => ({ notFound: h.notFound }))
vi.mock('@/lib/auth', () => ({ requireAuth: async () => ({ id: 'u1', account_id: 'acc', accounts: { plan: 'pro', status: 'active', stripe_subscription_id: 'sub_1' } }) }))
vi.mock('@/lib/reports/store', () => ({ loadOwnedReportClient: h.client }))
vi.mock('@/lib/reports/service', () => ({ listAuthenticatedClientReports: h.reports }))
vi.mock('@/lib/monthly-report/store', () => ({ listMonthlyReports: h.monthly }))
vi.mock('@/lib/monthly-report/service', () => ({ monthlyShareUrl: h.shareUrl }))

import ClientReportsPage from '@/app/[lang]/dashboard/[clientId]/reports/page'

const CLIENT = '11111111-1111-4111-8111-111111111111'
const render = async ({ kind, locale = 'en' }: { kind?: string; locale?: 'en' | 'zh-HK' } = {}) => {
  const messages = locale === 'zh-HK' ? zh : en
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {await ClientReportsPage({ params: Promise.resolve({ lang: locale, clientId: CLIENT }), searchParams: Promise.resolve(kind ? { kind } : {}) })}
    </NextIntlClientProvider>)
}
const monthlyRow = {
  reportId: 'r1', month: '2026-11', status: 'published' as const, publicSlug: 's'.repeat(32), shareVersion: 3,
  locale: 'en' as const, versionNumber: 2, publishedVersionNumber: 2, publishedLocale: 'en' as const,
  publishedAt: '2026-12-04T02:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  h.client.mockResolvedValue({ id: CLIENT, name: 'Northwind Coffee', domain: 'northwind.example' })
  h.reports.mockResolvedValue({ reports: [] })
  h.monthly.mockResolvedValue([])
  h.shareUrl.mockImplementation((row: { status: string; publicSlug: string; shareVersion: number; publishedLocale: string | null }) =>
    row.status === 'published' && row.publishedLocale ? `/signed/${row.publicSlug}?v=${row.shareVersion}` : null)
})

describe('reports page monthly tab', () => {
  it('defaults to scan reports and offers both tabs', async () => {
    const html = await render()
    expect(html).toContain('Client reports')
    expect(html).toContain('Scan reports')
    expect(html).toContain('Monthly reports')
    expect(h.reports).toHaveBeenCalledWith(CLIENT)
    expect(h.monthly).not.toHaveBeenCalled()
  })

  it('lists monthly reports with month, status, version and a signed share link', async () => {
    h.monthly.mockResolvedValue([monthlyRow])
    const html = await render({ kind: 'monthly' })
    expect(h.monthly).toHaveBeenCalledWith('acc', CLIENT)
    expect(h.reports).not.toHaveBeenCalled()
    expect(html).toContain('November 2026')
    expect(html).toContain('Published')
    expect(html).toContain('Version 2')
    expect(html).toContain('Copy link')
    expect(html).toContain(`/en/dashboard/${CLIENT}/month/report?m=2026-11`)
    // The share URL is signed server-side and handed to the copy control; it is
    // never rendered as text, so wiring is asserted at the resolver call.
    expect(h.shareUrl).toHaveBeenCalledWith(expect.objectContaining({
      status: 'published', publicSlug: monthlyRow.publicSlug, shareVersion: 3, publishedLocale: 'en',
    }))
    // The scan-only create action does not belong on the monthly tab.
    expect(html).not.toContain('Create / share report')
  })

  it('says there are no monthly reports instead of rendering an empty list', async () => {
    const html = await render({ kind: 'monthly' })
    expect(html).toContain('No monthly reports yet')
    expect(html).not.toContain('<ul')
  })

  it('renders the monthly tab in Traditional Chinese', async () => {
    h.monthly.mockResolvedValue([{ ...monthlyRow, locale: 'zh-HK', publishedLocale: 'zh-HK' }])
    const html = await render({ kind: 'monthly', locale: 'zh-HK' })
    expect(html).toContain('2026年11月')
    expect(html).toContain('第 2 版')
    expect(html).toContain('開啟報告')
  })

  it('fails closed to the unavailable card when the month list cannot be read, never an empty list', async () => {
    h.monthly.mockRejectedValue(new Error('PRIVATE_SENTINEL'))
    const html = await render({ kind: 'monthly' })
    expect(html).toContain('Reports are temporarily unavailable')
    expect(html).not.toContain('No monthly reports yet')
    expect(html).not.toContain('PRIVATE_')
  })
})
