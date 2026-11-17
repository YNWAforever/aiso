import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CombinedReport } from '@/components/reports/CombinedReport'
import type { CombinedReportData } from '@/lib/reports/combined'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  entitlement: vi.fn(),
  load: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NOT_FOUND') }),
}))

vi.mock('@/lib/auth', () => ({ requireAuth: h.auth }))
vi.mock('@/lib/tier', () => ({ resolveCommercialEntitlement: h.entitlement }))
vi.mock('@/lib/reports/combined', () => ({ loadCombinedReport: h.load }))
vi.mock('next/navigation', () => ({ notFound: h.notFound }))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }))

import Page from '@/app/[lang]/report/[clientId]/combined/page'

const report: CombinedReportData = {
  client: { name: 'Sino Group', domain: 'sino.com' },
  branding: null,
  scan: { state: 'none' },
  pulse: { state: 'none' },
  activeQuestions: 4,
  generatedAt: '2026-11-18T02:00:00.000Z',
}

function find(node: unknown, type: unknown): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) return node.map(item => find(item, type)).find(Boolean)
  if (!isValidElement<{ children?: unknown }>(node)) return
  return node.type === type ? node as ReactElement<Record<string, unknown>> : find(node.props.children, type)
}

const render = () => Page({ params: Promise.resolve({ lang: 'en', clientId: 'client-1' }) })

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ account_id: 'account-1', accounts: {} })
  h.entitlement.mockReturnValue({ features: { client_reports_online: true } })
  h.load.mockResolvedValue(report)
})

describe('combined report page', () => {
  it('loads the owned report and renders it with the client id', async () => {
    const page = await render()
    expect(find(page, CombinedReport)?.props).toMatchObject({ report, clientId: 'client-1' })
    expect(h.load).toHaveBeenCalledWith({ accountId: 'account-1', clientId: 'client-1', locale: 'en' })
  })

  it('shows the upgrade state before reading any report data', async () => {
    h.entitlement.mockReturnValue({ features: { client_reports_online: false } })
    const html = renderToStaticMarkup(await render() as ReactElement)
    expect(html).toContain('upgrade_title')
    expect(h.load).not.toHaveBeenCalled()
  })

  it('returns not found for a brand outside the account instead of leaking scan data', async () => {
    h.load.mockResolvedValue(null)
    await expect(render()).rejects.toThrow('NOT_FOUND')
  })
})
