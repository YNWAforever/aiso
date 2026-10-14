/**
 * app/[lang]/dashboard/[clientId]/result/[scanId]/page.tsx
 *
 * This page renders a scan inside a specific brand workspace. Its lookup
 * must match id, account_id, AND client_id — a scan id from another brand
 * (or an anonymous public-funnel scan with client_id null) must not render
 * here. See app/[lang]/dashboard/[clientId]/page.tsx for the sibling
 * ?scanId= deep-link that established this pattern.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement } from 'react'
import type { Scan } from '@/lib/types'
import { buildScanEvidence } from '@/lib/scan-evidence'
import { FixPackClient } from '@/components/FixPackClient'
import { ScoreRing } from '@/components/ScoreRing'

const { requireAuthMock, notFoundMock, sqlMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  notFoundMock: vi.fn(() => { throw new Error('NOT_FOUND') }),
  sqlMock: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }))
vi.mock('@/lib/db', () => ({ db: () => sqlMock }))
vi.mock('next/navigation', () => ({ notFound: notFoundMock }))
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}))

import DashboardResultPage from '@/app/[lang]/dashboard/[clientId]/result/[scanId]/page'

const PROFILE = { account_id: 'account-1' }

function scan(overrides: Partial<Scan> = {}): Scan {
  return {
    id: 'scan-1',
    account_id: 'account-1',
    url: 'https://example.com',
    domain: 'example.com',
    score: 62,
    grade: 'C',
    industry: 'technology',
    region: 'HK',
    created_at: '2026-07-16T00:00:00.000Z',
    results: {
      c1_robots: { status: 'pass', message: 'robots_ai_allowed' },
      c2_llms_txt: { status: 'warn', message: 'llms_txt_missing' },
      c3_bot_access: { status: 'pass', message: 'bots_allowed' },
      c4_structured_data: { status: 'pass', message: 'structured_data_present' },
      c5_extractability: { status: 'pass', message: 'extractable' },
    },
    ...overrides,
  } as Scan
}

// React element trees can carry circular references (e.g. a component's
// module `default` export pointing back at itself) that plain
// JSON.stringify chokes on. This replacer drops anything already seen.
function safeStringify(value: unknown): string {
  const seen = new WeakSet()
  return JSON.stringify(value, (_key, val) => {
    if (typeof val === 'object' && val !== null) {
      if (seen.has(val)) return '[circular]'
      seen.add(val)
    }
    return val
  })
}

function renderPage(overrides: { lang?: string; clientId?: string; scanId?: string } = {}) {
  return DashboardResultPage({
    params: Promise.resolve({
      lang: overrides.lang ?? 'en',
      clientId: overrides.clientId ?? 'client-1',
      scanId: overrides.scanId ?? 'scan-1',
    }),
  })
}
function renderedElements(value: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(value)) return value.flatMap(renderedElements)
  if (!isValidElement<Record<string, unknown>>(value)) return []
  return [value, ...renderedElements(value.props.children)]
}

function collectionEvidence(collection: 'complete' | 'failed' = 'complete') {
  return buildScanEvidence({
    requestedUrl: 'https://example.com', evaluatedUrl: 'https://example.com',
    industry: null, region: null, sitemapSource: 'unknown',
    checks: { c1_robots: { collection: 'complete', assessment: 'fail' } },
    observations: [{ check: 'page', collection, httpStatus: collection === 'complete' ? 200 : 503,
      target: { origin: 'https://example.com' } }],
  })
}

describe('dashboard result database score normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireAuthMock.mockResolvedValue(PROFILE)
  })

  it.each([
    { stored: 14.17, expected: 14.17 },
    { stored: '14.17', expected: 14.17 },
    { stored: 0, expected: 0 },
    { stored: '0', expected: 0 },
  ])('retains a completed scan score and its generation actions: $stored', async ({ stored, expected }) => {
    sqlMock.mockResolvedValue([scan({
      score: stored as unknown as number,
      results: { ...scan().results, evidence: collectionEvidence() },
    })])
    const elements = renderedElements(await renderPage())
    expect(elements.find(element => element.type === ScoreRing)?.props.score).toBe(expected)
    expect(elements.find(element => element.type === FixPackClient)?.props.scanId).toBe('scan-1')
    expect(elements.some(element => element.props.href === '/en/dashboard/client-1/reports/new?scanId=scan-1')).toBe(true)
  })

  it.each([
    { stored: null, collection: 'complete' as const },
    { stored: 'not-a-score', collection: 'complete' as const },
    { stored: '14.17', collection: 'failed' as const },
  ])('withholds score and generation actions for unavailable evidence: $stored / $collection', async ({ stored, collection }) => {
    sqlMock.mockResolvedValue([scan({
      score: stored as unknown as number,
      results: { ...scan().results, evidence: collectionEvidence(collection) },
    })])
    const elements = renderedElements(await renderPage())
    expect(elements.some(element => element.type === ScoreRing)).toBe(false)
    expect(elements.some(element => element.type === FixPackClient)).toBe(false)
    expect(elements.some(element => element.props.href === '/en/dashboard/client-1/reports/new?scanId=scan-1')).toBe(false)
  })
})

describe('dashboard result page brand scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireAuthMock.mockResolvedValue(PROFILE)
  })

  it('scopes the scan lookup to id, account_id, AND client_id', async () => {
    sqlMock.mockResolvedValue([scan()])

    await renderPage({ clientId: 'client-1', scanId: 'scan-1' })

    expect(sqlMock).toHaveBeenCalledTimes(1)
    const [strings, ...params] = sqlMock.mock.calls[0]!
    const query = (strings as unknown as string[]).join('?')
    expect(query).toMatch(/from scans/i)
    expect(query).toMatch(/account_id = \?/i)
    expect(query).toMatch(/client_id = \?/i)
    expect(params).toEqual(['scan-1', 'account-1', 'client-1'])
  })

  it('renders not-found for a scan id belonging to a different brand', async () => {
    // The composite WHERE clause enforces this at the DB layer — a scan
    // whose client_id is a different brand never matches, so the driver
    // legitimately returns zero rows for this account+client combination.
    sqlMock.mockResolvedValue([])

    await expect(renderPage({ clientId: 'brand-b', scanId: 'scan-from-brand-a' }))
      .rejects.toThrow('NOT_FOUND')
  })

  it('renders not-found for an anonymous scan (client_id null) requested inside a workspace', async () => {
    // client_id is null on anonymous public-funnel scans, and `client_id =
    // 'client-1'` never matches a null column, so the query legitimately
    // excludes it — it must not render inside any workspace.
    sqlMock.mockResolvedValue([])

    await expect(renderPage({ clientId: 'client-1', scanId: 'anon-scan' }))
      .rejects.toThrow('NOT_FOUND')
  })

  it('renders the scan when it belongs to the requested brand', async () => {
    sqlMock.mockResolvedValue([scan({ id: 'scan-1', domain: 'brand-a.example' })])

    const element = await renderPage({ clientId: 'client-1', scanId: 'scan-1' })

    expect(notFoundMock).not.toHaveBeenCalled()
    expect(safeStringify(element)).toContain('brand-a.example')
  })

  it('renders an error state rather than not-found when the database query fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    sqlMock.mockRejectedValue(new Error('connection terminated unexpectedly'))

    const element = await renderPage() as ReactElement
    const serialized = safeStringify(element)

    expect(notFoundMock).not.toHaveBeenCalled()
    expect(serialized).toContain('dashboard.workspace_load_error_title')
    expect(serialized).toContain('dashboard.workspace_load_error_body')
    consoleError.mockRestore()
  })

  it('redacts any connection string from the logged error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    sqlMock.mockRejectedValue(new Error('failed: postgresql://user:secretpass@host/db'))

    await renderPage()

    const logged = consoleError.mock.calls.map(call => call.join(' ')).join(' ')
    expect(logged).not.toContain('secretpass')
    consoleError.mockRestore()
  })
})
