import { beforeEach, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement } from 'react'
import Link from 'next/link'
import { buildScanEvidence } from '@/lib/scan-evidence'
import { ReportBuilder } from '@/components/reports/ReportBuilder'
import { ScanPicker } from '@/components/dashboard/ScanPicker'

vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({ sql: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: () => h.sql }))
vi.mock('@/lib/auth', () => ({ requireAuth: async () => ({ account_id: 'account-a', accounts: { plan: 'pro', status: 'active', stripe_subscription_id: 'sub' } }) }))
vi.mock('@/lib/reports/store', () => ({ loadOwnedReportClient: async () => ({ id: 'brand-a', name: 'Brand', domain: 'brand.example' }) }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND') } }))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }))
import Page from '@/app/[lang]/dashboard/[clientId]/reports/new/page'

const scanId = '11111111-1111-4111-8111-111111111111'
function elements(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...elements(node.props.children)]
}
beforeEach(() => { vi.clearAllMocks() })

it.each([
  ['en', 'other.example', 'legacy'], ['zh-HK', 'other.example', 'legacy'],
  ['en', 'brand.example', 'failed'], ['zh-HK', 'brand.example', 'failed'],
] as const)('recovers an owned %s report selection for %s with %s evidence through the real choice loader', async (lang, domain, state) => {
  const evidence = state === 'legacy' ? undefined : buildScanEvidence({ requestedUrl: `https://${domain}`, evaluatedUrl: `https://${domain}`, industry: null, region: null, sitemapSource: 'unknown', checks: {},
    observations: [{ check: 'page', collection: 'failed', httpStatus: 403, target: { origin: `https://${domain}` } }],
  })
  h.sql.mockImplementation(async (strings: TemplateStringsArray) => strings.join('?').includes('results->')
    ? [{ id: scanId, domain, score: '14.17', grade: 'F', created_at: '2026-10-01', evidence }]
    : [{ id: scanId }])
  const page = await Page({ params: Promise.resolve({ lang, clientId: 'brand-a' }), searchParams: Promise.resolve({ scanId }) })
  const rendered = elements(page)
  expect(rendered.some(element => element.type === ReportBuilder)).toBe(false)
  expect(rendered.find(element => element.type === ScanPicker)?.props.scans).toEqual([])
  expect(rendered.find(element => element.type === Link)?.props.href).toBe(`/${lang}/dashboard/brand-a?step=scan&url=https%3A%2F%2Fbrand.example`)
})

it.each([scanId, 'malformed-scan-id'])('keeps a foreign or invalid report selection unavailable: %s', async id => {
  h.sql.mockResolvedValue([])
  await expect(Page({ params: Promise.resolve({ lang: 'en', clientId: 'brand-a' }), searchParams: Promise.resolve({ scanId: id }) })).rejects.toThrow('NOT_FOUND')
})
