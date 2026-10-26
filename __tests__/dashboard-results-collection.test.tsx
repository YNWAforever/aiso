import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement } from 'react'
import { createTranslator } from 'next-intl'
import { buildScanEvidence } from '@/lib/scan-evidence'
import { ResultsStep } from '@/components/dashboard/ResultsStep'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({ lang: 'en' as 'en' | 'zh-HK', sql: vi.fn(), choices: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: async () => ({ account_id: 'account-a', accounts: { plan: 'free' } }) }))
vi.mock('@/lib/db', () => ({ db: () => h.sql }))
vi.mock('@/lib/workspace/scan-choices', () => ({ loadOwnedScanChoices: h.choices }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND') } }))
vi.mock('next-intl/server', () => ({ getTranslations: async (namespace: 'dashboard' | 'reports' | 'portfolio') => createTranslator({ locale: h.lang, messages: h.lang === 'en' ? en : zh, namespace }) }))
import Page from '@/app/[lang]/dashboard/[clientId]/page'

function elements(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...elements(node.props.children)]
}
function text(node: unknown): string {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(text).join(' ')
  return isValidElement<{ children?: unknown }>(node) ? text(node.props.children) : ''
}
function evidence(collection: 'complete' | 'failed' | 'blocked', httpStatus: number) {
  return buildScanEvidence({ requestedUrl: 'https://example.com', evaluatedUrl: 'https://example.com', industry: null, region: null, sitemapSource: 'unknown', checks: {},
    observations: [{ check: 'page', collection, httpStatus, target: { origin: 'https://example.com' } }],
  })
}
async function render(score: unknown, collectionEvidence: unknown, selected = true) {
  h.sql.mockImplementation(async (strings: TemplateStringsArray) => {
    const query = strings.join('?')
    if (query.includes('from clients')) return [{ id: 'client-a', brand_name: 'Example', domain: 'example.com' }]
    if (query.includes('from scans')) return [{ id: 'selected_scan', account_id: 'account-a', domain: 'example.com', score, grade: 'F', created_at: '2026-10-01T08:00:00.000Z', results: { evidence: collectionEvidence } }]
    return []
  })
  return Page({ params: Promise.resolve({ lang: h.lang, clientId: 'client-a' }), searchParams: Promise.resolve({ step: 'results', ...(selected ? { scanId: 'selected_scan' } : {}) }) })
}
beforeEach(() => { vi.clearAllMocks(); h.choices.mockResolvedValue([]) })

describe.each(['en', 'zh-HK'] as const)('dashboard Results collection status in %s', lang => {
  beforeEach(() => { h.lang = lang })

  it.each([
    ['failed', 403, '14.17', true],
    ['blocked', 429, 0, true],
    ['failed', 503, 52, false],
  ] as const)('withholds the stored score for %s HTTP %s and offers the same scan for retry', async (collection, httpStatus, score, selected) => {
    const page = await render(score, evidence(collection, httpStatus), selected)
    const rendered = elements(page)
    expect(rendered.some(element => element.type === ResultsStep)).toBe(false)
    expect(text(page)).toContain((lang === 'en' ? en : zh).portfolio.scanIncomplete)
    expect(rendered.find(element => element.props.href === `/${lang}/dashboard/client-a?step=scan&scanId=selected_scan`)).toBeDefined()
    expect(rendered.some(element => typeof element.props.href === 'string' && element.props.href.includes('/reports/new'))).toBe(false)
  })

  it.each([undefined, { schemaVersion: 'unsupported' }])('explains unavailable collection evidence instead of showing a score: %j', async collectionEvidence => {
    const page = await render('14.17', collectionEvidence)
    expect(elements(page).some(element => element.type === ResultsStep)).toBe(false)
    expect(text(page)).toContain((lang === 'en' ? en : zh).portfolio.scanUnknown)
    expect(elements(page).some(element => element.props.href === `/${lang}/dashboard/client-a?step=scan&scanId=selected_scan`)).toBe(true)
  })

  it.each([null, 'NaN', 'Infinity'])('keeps an owned scan with an unusable score distinct from an absent selection: %s', async score => {
    const page = await render(score, evidence('complete', 200))
    expect(text(page)).toContain((lang === 'en' ? en : zh).portfolio.scanUnknown)
    expect(text(page)).not.toContain((lang === 'en' ? en : zh).dashboard.no_scan_selected)
    expect(elements(page).some(element => element.props.href === `/${lang}/dashboard/client-a?step=scan&scanId=selected_scan`)).toBe(true)
  })

  it('keeps an absent scan selection distinct from unavailable collection', async () => {
    h.sql.mockImplementation(async (strings: TemplateStringsArray) => strings.join('?').includes('from clients') ? [{ id: 'client-a', domain: 'example.com' }] : [])
    const page = await Page({ params: Promise.resolve({ lang, clientId: 'client-a' }), searchParams: Promise.resolve({ step: 'results', scanId: 'missing-scan' }) })
    expect(text(page)).toContain((lang === 'en' ? en : zh).dashboard.no_scan_selected)
    expect(text(page)).not.toContain((lang === 'en' ? en : zh).portfolio.scanUnknown)
  })

  it.each([['14.17', 14.17], ['0', 0]] as const)('preserves a verified stored score of %s', async (stored, expected) => {
    const page = await render(stored, evidence('complete', 200))
    const results = elements(page).find(element => element.type === ResultsStep)
    expect(results?.props.scan).toMatchObject({ id: 'selected_scan', score: expected })
  })
})
