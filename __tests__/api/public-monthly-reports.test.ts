import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
process.env.REPORT_SHARE_SECRET = 'test-report-share-secret-that-is-at-least-32-characters'

const h = vi.hoisted(() => ({ resolvePublicClientReport: vi.fn(), incrementClientReportCtaClick: vi.fn(), fetchReportLogo: vi.fn() }))
vi.mock('@/lib/reports/store', () => ({
  resolvePublicClientReport: h.resolvePublicClientReport,
  incrementClientReportCtaClick: h.incrementClientReportCtaClick,
}))
vi.mock('@/lib/reports/branding', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/reports/branding')>()
  return { ...actual, fetchReportLogo: h.fetchReportLogo }
})

import { signReportShare } from '@/lib/reports/share'
import { GET as GET_LOGO } from '@/app/api/public/monthly-reports/[slug]/logo/route'
import { GET as GET_CONTACT } from '@/app/api/public/monthly-reports/[slug]/contact/route'

const slug = 'm'.repeat(32), shareVersion = 3
const signature = signReportShare({ slug, shareVersion })
const snapshot = {
  snapshotSchemaVersion: 2, kind: 'monthly', locale: 'en', month: '2026-11',
  period: { start: '2026-10-31T16:00:00.000Z', end: '2026-11-30T16:00:00.000Z' },
  branding: { agencyName: 'Fimmick', logoUrl: 'https://agency.example/logo.png', primaryColor: '#123ABC',
    contactLabel: 'Talk to us', contactUrl: 'https://agency.example/contact', attribution: 'Powered by Fimmick AISO' },
  client: { name: 'Bakery', domain: 'bakery.hk' },
  delivered: { verifiedLive: [], selfReported: [] },
  visibility: { state: 'not_enough_data', reason: 'no_pulse_data' },
  search: { opening: { state: 'not_connected' }, closing: { state: 'not_recorded' } },
  nextMonth: { openWorkItems: [] }, executiveSummary: 'A good month.', builtAt: '2026-12-04T00:00:00.000Z',
}
const stored = (over: Record<string, unknown> = {}) => ({
  report: { id: 'r1', account_id: 'acc', client_id: 'c', status: 'published', public_slug: slug, share_version: shareVersion,
    published_version_id: 'v1', published_at: '2026-12-04T02:00:00.000Z' },
  version: { id: 'v1', report_id: 'r1', account_id: 'acc', client_id: 'c', locale: 'en', snapshot_schema_version: 2, snapshot, ...over },
  account: { id: 'acc', plan: 'pro', status: 'active', stripe_subscription_id: 'sub_1' },
})
const request = (path: 'logo' | 'contact', over: { slug?: string; version?: string; signature?: string } = {}) =>
  new Request(`https://app.example/api/public/monthly-reports/${over.slug ?? slug}/${path}?v=${over.version ?? shareVersion}&s=${over.signature ?? signature}`)
const params = (value = slug) => ({ params: Promise.resolve({ slug: value }) })

beforeEach(() => {
  vi.clearAllMocks()
  h.resolvePublicClientReport.mockResolvedValue(stored())
  h.fetchReportLogo.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png' })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('monthly report public assets', () => {
  it('serves the logo only for a valid signed link', async () => {
    const response = await GET_LOGO(request('logo'), params())
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('is a neutral 404 for a bad signature, an unpublished report or no stored logo', async () => {
    expect((await GET_LOGO(request('logo', { signature: 'x'.repeat(43) }), params())).status).toBe(404)
    h.resolvePublicClientReport.mockResolvedValue(stored({ snapshot: { ...snapshot, branding: { ...snapshot.branding, logoUrl: null } } }))
    expect((await GET_LOGO(request('logo'), params())).status).toBe(404)
    expect(h.fetchReportLogo).not.toHaveBeenCalled()
  })

  it('never becomes an open redirect: the 303 points at the validated stored destination', async () => {
    const response = await GET_CONTACT(request('contact'), params())
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('https://agency.example/contact')
    expect(h.incrementClientReportCtaClick).toHaveBeenCalledWith({ publicSlug: slug, shareVersion })
  })

  it('answers a neutral 404 when the stored contact is missing or unusable', async () => {
    h.resolvePublicClientReport.mockResolvedValue(stored({ snapshot: { ...snapshot, branding: { ...snapshot.branding, contactLabel: null } } }))
    expect((await GET_CONTACT(request('contact'), params())).status).toBe(404)
    h.resolvePublicClientReport.mockResolvedValue(stored({ snapshot: { ...snapshot, branding: { ...snapshot.branding, contactUrl: 'javascript:alert(1)' } } }))
    expect((await GET_CONTACT(request('contact'), params())).status).toBe(404)
    expect(h.incrementClientReportCtaClick).not.toHaveBeenCalled()
  })

  it('does not let a valid scan link read monthly assets', async () => {
    h.resolvePublicClientReport.mockResolvedValue(stored({ snapshot_schema_version: 1 }))
    expect((await GET_LOGO(request('logo'), params())).status).toBe(404)
    expect((await GET_CONTACT(request('contact'), params())).status).toBe(404)
  })
})
