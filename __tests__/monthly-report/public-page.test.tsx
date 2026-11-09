import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'

vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({ scan: vi.fn(), monthly: vi.fn(), review: vi.fn(), view: vi.fn(), notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }) }))
vi.mock('@/lib/reports/public', () => ({ resolvePublishedClientReport: h.scan }))
vi.mock('@/lib/monthly-report/public', () => ({ resolvePublishedMonthlyReport: h.monthly, resolveReviewMonthlyReport: h.review }))
vi.mock('@/lib/reports/store', () => ({ incrementClientReportView: h.view }))
vi.mock('next/navigation', () => ({ notFound: h.notFound }))

import PublicReportPage from '@/app/[lang]/r/[slug]/page'

const slug = 'm'.repeat(32)
const props = (lang = 'en', extra: Record<string, string> = {}) => ({
  params: Promise.resolve({ lang, slug }),
  searchParams: Promise.resolve({ v: '3', s: 'b'.repeat(43), ...extra } as { v: string; s: string; review?: string }),
})
/** The monthly branch renders a client-side print control, so it needs an intl provider. */
const render = async (lang = 'en', extra: Record<string, string> = {}) => renderToStaticMarkup(
  <NextIntlClientProvider locale={lang} messages={en}>{await PublicReportPage(props(lang, extra))}</NextIntlClientProvider>,
)
const report = {
  snapshotSchemaVersion: 2, kind: 'monthly', locale: 'en', month: '2026-11', period: { start: 'a', end: 'b' },
  branding: { agencyName: 'Fimmick', primaryColor: '#123ABC', contactLabel: null, attribution: 'Powered by Fimmick AISO' },
  client: { name: 'Bakery', domain: 'bakery.hk' },
  delivered: { verifiedLive: [{ title: 'Add FAQ schema', recordedAt: '2026-11-06T01:00:00.000Z', versionId: '0' }], selfReported: [] },
  visibility: { state: 'not_enough_data', reason: 'movement_rule_pending' },
  search: { opening: { state: 'not_connected' }, closing: { state: 'not_recorded' } }, nextMonth: { openWorkItems: [] },
  executiveSummary: 'A good month.', builtAt: 'x',
}

beforeEach(() => {
  vi.clearAllMocks()
  h.scan.mockResolvedValue(null)
  h.review.mockResolvedValue(null)
  h.monthly.mockResolvedValue({ report, publishedAt: '2026-12-04T02:00:00.000Z', logoProxyUrl: null, contactProxyUrl: null })
})

describe('public report page: review links (Phase 3, advisory)', () => {
  const reviewPayload = { report, reportId: 'r1', versionId: 'v2', versionNumber: 2, month: '2026-11',
    status: 'draft' as const, locale: 'en' as const, publishedAt: null, existing: null, logoProxyUrl: null, contactProxyUrl: null }

  it('shows the decision form for the latest draft and never claims it is published', async () => {
    h.review.mockResolvedValue(reviewPayload)
    const html = await render('en', { review: 'token' })
    expect(h.review).toHaveBeenCalledWith({ slug, review: 'token' })
    for (const text of ['Client review', 'Approve', 'Request changes', 'Send decision', 'Bakery · Monthly report']) {
      expect(html).toContain(text)
    }
    expect(html).not.toContain(' · Published')
  })

  it('replaces the form with the recorded decision once one exists', async () => {
    h.review.mockResolvedValue({ ...reviewPayload, existing: {
      decision: 'approved', reviewerName: 'Mei', comment: null, decidedAt: '2026-12-04T02:00:00.000Z',
    } })
    const html = await render('en', { review: 'token' })
    expect(html).toContain('Approved by Mei on')
    expect(html).not.toContain('Send decision')
  })

  it('falls back to the published share resolution when the review token does not resolve', async () => {
    const html = await render('en', { review: 'expired-token' })
    expect(h.monthly).toHaveBeenCalled()
    expect(html).toContain('Bakery · Monthly report')
  })
})

describe('public report page: monthly reports', () => {
  it('falls back to a published monthly report on the same signed link, and counts the view', async () => {
    const html = await render()
    expect(h.monthly).toHaveBeenCalledWith({ slug, version: '3', signature: 'b'.repeat(43) })
    expect(h.view).toHaveBeenCalledWith({ publicSlug: slug, shareVersion: 3 })
    for (const text of ['Fimmick', 'Bakery · Monthly report', 'A good month.', 'Add FAQ schema', 'Not enough data yet.', 'Powered by Fimmick AISO']) {
      expect(html).toContain(text)
    }
    expect(html).toContain('border-color:#123ABC')
  })

  it('offers the same Download PDF affordance as the scan report, hidden from the printout itself', async () => {
    const html = await render()
    expect(html).toContain('Download PDF')
    // The button is chrome: it must not appear on the page it prints.
    expect(html).toMatch(/<button[^>]*class="[^"]*print:hidden[^"]*"[^>]*>.*Download PDF/)
  })

  it('renders the agency logo and contact link through the signed proxy URLs only', async () => {
    const logoProxyUrl = `/api/public/monthly-reports/${slug}/logo?v=3&s=${'b'.repeat(43)}`
    const contactProxyUrl = `/api/public/monthly-reports/${slug}/contact?v=3&s=${'b'.repeat(43)}`
    h.monthly.mockResolvedValue({ report: { ...report, branding: { ...report.branding, contactLabel: 'Talk to us' } },
      publishedAt: '2026-12-04T02:00:00.000Z', logoProxyUrl, contactProxyUrl })
    const html = await render()
    expect(html).toContain(`src="${logoProxyUrl.replaceAll('&', '&amp;')}"`)
    expect(html).toContain(`href="${contactProxyUrl.replaceAll('&', '&amp;')}"`)
    expect(html).toContain('Talk to us')
    // The raw destinations never reach the page.
    expect(html).not.toContain('agency.example')
  })

  it('keeps the page neutral when neither kind resolves, and never asks the monthly resolver for a scan report', async () => {
    h.monthly.mockResolvedValue(null)
    await expect(PublicReportPage(props())).rejects.toThrow('NEXT_NOT_FOUND')
    h.scan.mockResolvedValue({ dto: {}, assets: {} })
    h.monthly.mockClear()
    await PublicReportPage(props()).catch(() => null)
    expect(h.monthly).not.toHaveBeenCalled()
  })
})
