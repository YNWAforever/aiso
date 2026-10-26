import { beforeEach, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement } from 'react'
import { ScanPicker } from '@/components/dashboard/ScanPicker'
import { ReportBuilder } from '@/components/reports/ReportBuilder'
import Link from 'next/link'
import { ScanStep } from '@/components/dashboard/ScanStep'
import { renderWithIntl } from '@/__tests__/helpers/intl'
import { safeReturnTo } from '@/lib/auth-return-to'
import { normalizeAuthNext } from '@/lib/auth-navigation'
import type { Scan } from '@/lib/types'

const h = vi.hoisted(() => ({ auth: vi.fn(), client: vi.fn(), scans: vi.fn(), scan: vi.fn(), previous: vi.fn(), recommendations: vi.fn(), branding: vi.fn(), snapshot: vi.fn(), query: new URLSearchParams() }))
vi.mock('@/lib/auth', () => ({ requireAuth: h.auth }))
vi.mock('@/lib/workspace/scan-choices', () => ({ loadOwnedScanChoices: h.scans }))
vi.mock('@/lib/reports/store', () => ({ loadOwnedReportClient: h.client, loadOwnedReportScan: h.scan, loadPreviousReportScan: h.previous, loadReportRecommendations: h.recommendations, loadReportBranding: h.branding }))
vi.mock('@/lib/reports/snapshot', () => ({ buildClientReportSnapshot: h.snapshot }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND') }, useSearchParams: () => h.query, useRouter: () => ({ push: vi.fn() }) }))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }))
import Page from '@/app/[lang]/dashboard/[clientId]/reports/new/page'

const choices = [{ id: 'older-scan', domain: 'example.com', score: 52, grade: 'C', created_at: '2026-10-01' }]
const render = (query = {}) => Page({ params: Promise.resolve({ lang: 'en', clientId: 'brand-a' }), searchParams: Promise.resolve(query) })
function find(node: unknown, type: unknown): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) return node.map(item => find(item, type)).find(Boolean)
  if (!isValidElement<{ children?: unknown }>(node)) return
  return node.type === type ? node as ReactElement<Record<string, unknown>> : find(node.props.children, type)
}
beforeEach(() => {
  vi.clearAllMocks()
  h.query = new URLSearchParams()
  h.auth.mockResolvedValue({ account_id: 'account-a', accounts: { plan: 'pro', status: 'active', stripe_subscription_id: 'sub' } })
  h.client.mockResolvedValue({ id: 'brand-a', name: 'Example', domain: 'example.com' })
  h.scans.mockResolvedValue(choices)
  h.scan.mockResolvedValue({ id: 'older-scan' })
  h.branding.mockResolvedValue({ agencyName: 'Agency' })
  h.previous.mockResolvedValue(null)
  h.recommendations.mockResolvedValue([])
  h.snapshot.mockReturnValue({})
})
it('shows owned scan choices directly when starting a report without a scan', async () => {
  const picker = find(await render(), ScanPicker)
  expect(picker?.props).toMatchObject({ action: '/en/dashboard/brand-a/reports/new', scans: choices })
  expect(h.scans).toHaveBeenCalledWith({ accountId: 'account-a', clientId: 'brand-a' })
  expect(h.scan).not.toHaveBeenCalled()
})
it('opens the builder for exactly the picked scan and keeps the picker available', async () => {
  const page = await render({ scanId: 'older-scan' })
  expect(find(page, ReportBuilder)?.props.scanId).toBe('older-scan')
  expect(find(page, ScanPicker)?.props.selectedScanId).toBe('older-scan')
})
it('rejects a scan from another brand even when its domain matches', async () => {
  await expect(render({ scanId: 'other-brand-scan' })).rejects.toThrow('NOT_FOUND')
  expect(h.scan).not.toHaveBeenCalled()
})
it('rejects ambiguous scan selections instead of silently rendering another report', async () => {
  await expect(render({ scanId: ['older-scan', 'newer-scan'] })).rejects.toThrow('NOT_FOUND')
})
it('does not offer an owned scan from a different domain that reports cannot accept', async () => {
  h.scans.mockResolvedValue([...choices, { ...choices[0], id: 'other-domain-scan', domain: 'other.example' }])
  const page = await render()
  expect(find(page, ScanPicker)?.props.scans).toEqual(choices)
})
it('explains an owned but unsupported domain selection without switching to another scan', async () => {
  h.scans.mockResolvedValue([...choices, { ...choices[0], id: 'other-domain-scan', domain: 'other.example' }])
  const page = await render({ scanId: 'other-domain-scan' })
  expect(find(page, ReportBuilder)).toBeUndefined()
  expect(find(page, ScanPicker)?.props.scans).toEqual(choices)
  expect(h.scan).not.toHaveBeenCalled()
})
it('offers the current brand URL when all owned scans are for other domains', async () => {
  h.scans.mockResolvedValue([{ ...choices[0], domain: 'other.example' }])
  const page = await render({ scanId: 'older-scan' })
  expect(find(page, ScanPicker)?.props.scans).toEqual([])
  expect(find(page, Link)?.props.href).toBe('/en/dashboard/brand-a?step=scan&url=https%3A%2F%2Fexample.com')
})
it('offers a new scan when the brand has no completed scans', async () => {
  h.scans.mockResolvedValue([])
  const page = await render()
  expect(find(page, ScanPicker)?.props.scans).toEqual([])
  expect(find(page, Link)?.props.href).toBe('/en/dashboard/brand-a?step=scan&url=https%3A%2F%2Fexample.com')
})

it.each([
  ['en', false], ['en', true], ['zh-HK', false], ['zh-HK', true],
] as const)('prefills the report recovery site after re-login in %s (other-domain history: %s)', async (lang, hasHistory) => {
  const clientId = '11111111-1111-4111-8111-111111111111'
  const otherScan = { id: 'older-scan', url: 'https://other.example/guide', domain: 'other.example', industry: 'technology', region: 'HK' } as Scan
  const history = hasHistory ? [{ ...choices[0], domain: 'other.example' }] : []
  h.client.mockResolvedValue({ id: clientId, name: 'Brand', domain: 'www.brand.example' })
  h.scans.mockResolvedValue(history)
  const page = await Page({ params: Promise.resolve({ lang, clientId }), searchParams: Promise.resolve(hasHistory ? { scanId: 'older-scan' } : {}) })
  const href = find(page, Link)?.props.href as string
  expect(href).toBe(`/${lang}/dashboard/${clientId}?step=scan&url=https%3A%2F%2Fbrand.example`)
  const returned = normalizeAuthNext(lang, safeReturnTo(href, lang))
  h.query = new URL(returned, 'https://auth.fixture').searchParams
  const html = renderWithIntl(<ScanStep lang={lang} clientId={clientId} client={{ domain: 'www.brand.example', industry: 'legal' }} scan={hasHistory ? otherScan : null} scanHistory={history} />, lang)
  expect(html).toContain('value="https://brand.example"')
  expect(html).not.toContain('value="https://other.example/guide"')
})
