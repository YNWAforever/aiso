import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import type { PublicResultSummary } from '@/lib/result-access'
import type { Scan } from '@/lib/types'
import { buildScanEvidence } from '@/lib/scan-evidence'
import type { OwnedResultEvidence } from '@/lib/result-evidence'

const { getProfileMock, notFoundMock, sqlMock } = vi.hoisted(() => ({
  getProfileMock: vi.fn(),
  notFoundMock: vi.fn(() => { throw new Error('NOT_FOUND') }),
  sqlMock: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getProfile: getProfileMock }))
vi.mock('@/lib/db', () => ({ db: () => sqlMock }))
vi.mock('next/navigation', () => ({ notFound: notFoundMock }))
vi.mock('@/components/result/ResultClient', () => ({ ResultClient: () => null }))

import ResultPage from '@/app/[lang]/result/[id]/page'

const RAW_EVIDENCE = 'SENTINEL_RAW_PRIVATE_EVIDENCE'
const PRIVATE_REMEDIATION = 'SENTINEL_PRIVATE_REMEDIATION'

function scan(id: string, accountId: string | null): Scan {
  return {
    id,
    account_id: accountId,
    url: 'https://example.com',
    domain: 'example.com',
    score: 62,
    grade: 'C',
    industry: 'technology',
    region: 'HK',
    created_at: '2026-07-16T00:00:00.000Z',
    results: {
      c1_robots: { status: 'pass', message: 'robots_ai_allowed', details: RAW_EVIDENCE },
      c2_llms_txt: { status: 'warn', message: 'llms_txt_missing', details: PRIVATE_REMEDIATION },
      c3_bot_access: { status: 'pass', message: 'bots_allowed' },
      c4_structured_data: { status: 'pass', message: 'structured_data_present' },
      c5_extractability: { status: 'pass', message: 'extractable' },
    },
  }
}

type ResultClientProps = {
  lang: string
  summary: PublicResultSummary
  fullScan?: Scan
  ownedEvidence?: OwnedResultEvidence | null
}

async function renderPage(id: string): Promise<ResultClientProps> {
  const element = await ResultPage({ params: Promise.resolve({ lang: 'en', id }) })
  return (element as ReactElement<ResultClientProps>).props
}

function expectSanitized(props: ResultClientProps) {
  const serialized = JSON.stringify(props)
  expect(props.fullScan).toBeUndefined()
  expect(props.ownedEvidence).toBeUndefined()
  expect(props.summary).not.toHaveProperty('results')
  expect(serialized).not.toContain('"results"')
  expect(serialized).not.toContain(RAW_EVIDENCE)
  expect(serialized).not.toContain(PRIVATE_REMEDIATION)
}

describe('public result route access boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns not-found before looking up the viewer profile', async () => {
    sqlMock.mockResolvedValue([])

    await expect(renderPage('missing-scan')).rejects.toThrow('NOT_FOUND')

    expect(getProfileMock).not.toHaveBeenCalled()
  })

  it('keeps the public teaser available when Neon profile lookup has an expected config failure', async () => {
    sqlMock.mockResolvedValue([scan('auth-failure', 'account-1')])
    getProfileMock.mockRejectedValue(
      new TypeError("Cannot read properties of undefined (reading 'endsWith')"),
    )

    expectSanitized(await renderPage('auth-failure'))
  })

  it('logs unexpected profile errors and still fails closed to the public teaser', async () => {
    const error = new Error('unexpected profile database failure')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    sqlMock.mockResolvedValue([scan('unexpected-auth-failure', 'account-1')])
    getProfileMock.mockRejectedValue(error)

    expectSanitized(await renderPage('unexpected-auth-failure'))
    expect(consoleError).toHaveBeenCalledWith(
      '[result] Unexpected profile lookup failure',
      error,
    )
    consoleError.mockRestore()
  })

  it('does not serialize private scan results for an anonymous viewer', async () => {
    sqlMock.mockResolvedValue([scan('anonymous', 'account-1')])
    getProfileMock.mockResolvedValue(null)

    expectSanitized(await renderPage('anonymous'))
  })

  it('does not serialize private scan results for an authenticated non-owner', async () => {
    sqlMock.mockResolvedValue([scan('non-owner', 'account-1')])
    getProfileMock.mockResolvedValue({ account_id: 'account-2' })

    expectSanitized(await renderPage('non-owner'))
  })

  it.each([null, 'account-2'])('withholds the new evidence projection from viewer %s', async viewer => {
    const row = scan('evidence-private', 'account-1')
    Object.assign(row.results, { evidence: buildScanEvidence({
      requestedUrl: 'https://example.com/private?token=SECRET', evaluatedUrl: 'https://example.com',
      industry: 'technology', region: 'HK', sitemapSource: 'unknown', checks: {},
    }) })
    sqlMock.mockResolvedValue([row])
    getProfileMock.mockResolvedValue(viewer ? { account_id: viewer } : null)
    expectSanitized(await renderPage('evidence-private'))
  })

  it('projects validated evidence for the exact owner only, preserving the headline', async () => {
    const row = scan('evidence-owner', 'account-1')
    Object.assign(row.results, { evidence: buildScanEvidence({
      requestedUrl: 'https://example.com/private?token=SECRET', evaluatedUrl: 'https://example.com',
      industry: 'technology', region: 'HK', sitemapSource: 'unknown', checks: {},
    }) })
    sqlMock.mockResolvedValue([row])
    getProfileMock.mockResolvedValue({ account_id: 'account-1' })
    const props = await renderPage('evidence-owner')
    expect(props.ownedEvidence?.checks).toHaveLength(20)
    expect(JSON.stringify(props.ownedEvidence)).not.toMatch(/SECRET|example\.com|comparisonSignature/)
    expect(props.summary.score).toBe(62)
    expect(props.summary.grade).toBe('C')
  })
  it('serializes the full scan only for the exact owning account', async () => {
    sqlMock.mockResolvedValue([scan('owner', 'account-1')])
    getProfileMock.mockResolvedValue({ account_id: 'account-1' })

    const props = await renderPage('owner')
    const serialized = JSON.stringify(props)
    expect(props.fullScan?.account_id).toBe('account-1')
    expect(serialized).toContain('"results"')
    expect(serialized).toContain(RAW_EVIDENCE)
    expect(serialized).toContain(PRIVATE_REMEDIATION)
  })
})
