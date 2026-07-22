import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

process.env.REPORT_SHARE_SECRET = 'test-report-share-secret-that-is-at-least-32-characters'
process.env.NEXT_PUBLIC_APP_URL = 'https://reports.example'

const h = vi.hoisted(() => ({
  getProfile: vi.fn(),
  callOpenRouter: vi.fn(),
  loadOwnedReportClient: vi.fn(),
  loadOwnedReportScan: vi.fn(),
  loadPreviousReportScan: vi.fn(),
  loadReportRecommendations: vi.fn(),
  loadReportBranding: vi.fn(),
  loadOwnedClientReportById: vi.fn(),
  loadOwnedClientReport: vi.fn(),
  listClientReports: vi.fn(),
  listClientReportVersions: vi.fn(),
  createClientReport: vi.fn(),
  appendClientReportVersion: vi.fn(),
  publishClientReportLatest: vi.fn(),
  revokeClientReport: vi.fn(),
  rotateClientReportLink: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getProfile: h.getProfile }))
vi.mock('@/lib/openrouter', () => ({ callOpenRouter: h.callOpenRouter }))
vi.mock('@/lib/reports/store', () => ({
  ...h,
  ReportStoreError: class ReportStoreError extends Error {
    readonly code?: string
  },
}))

import { GET as GET_REPORTS, POST as POST_REPORTS } from '@/app/api/clients/[clientId]/reports/route'
import { POST as POST_VERSION } from '@/app/api/client-reports/[reportId]/versions/route'
import { POST as POST_AI } from '@/app/api/client-reports/[reportId]/ai-summary/route'
import { POST as POST_PUBLISH } from '@/app/api/client-reports/[reportId]/publish/route'
import { POST as POST_REVOKE } from '@/app/api/client-reports/[reportId]/revoke/route'
import { POST as POST_ROTATE } from '@/app/api/client-reports/[reportId]/rotate-link/route'

const proProfile = {
  id: 'profile-1',
  account_id: 'account-1',
  accounts: {
    plan: 'pro', status: 'active', stripe_subscription_id: 'sub_pro', trial_ends_at: null,
  },
}
const client = { id: 'client-1', accountId: 'account-1', name: 'Example Client', domain: 'example.com' }
const currentScan = {
  id: 'scan-current',
  accountId: 'account-1',
  domain: 'www.example.com',
  createdAt: '2026-07-21T08:00:00.000Z',
  score: 82,
  grade: 'A',
  results: { c1_robots: { status: 'pass' }, c2_llms_txt: { status: 'warn' } },
}
const previousScan = {
  id: 'scan-previous',
  accountId: 'account-1',
  domain: 'example.com',
  createdAt: '2026-07-20T08:00:00.000Z',
  score: 75,
  grade: 'B',
  results: { c1_robots: { status: 'warn' }, c2_llms_txt: { status: 'warn' } },
}
const branding = {
  accountId: 'account-1',
  agencyName: 'Acme Agency',
  logoUrl: null,
  primaryColor: '#123ABC',
  contactLabel: null,
  contactUrl: null,
  updatedBy: 'profile-1',
}
const snapshot = {
  snapshotSchemaVersion: 1 as const,
  locale: 'en' as const,
  branding: { ...branding, attribution: 'Powered by Fimmick AISO' as const },
  client: { name: 'Example Client', domain: 'example.com' },
  evidence: { scanDate: currentScan.createdAt, evidenceTimestamp: currentScan.createdAt },
  score: { current: 82, grade: 'A', comparisonState: 'comparable' as const, previous: 75, delta: 7, previousScanDate: previousScan.createdAt },
  changes: [
    { key: 'c1_robots', label: 'Robots access', kind: 'improved' as const },
    { key: 'c2_llms_txt', label: 'LLMs.txt', kind: 'unchanged' as const },
  ],
  priorityFixes: [],
  executiveSummary: 'The current score is 82, a signed change of +7, with 1 evidence changes recorded.',
  methodology: 'Scores and changes are based only on the reportable checks captured in the selected scans.',
}
const report = {
  id: 'report-1',
  account_id: 'account-1',
  client_id: 'client-1',
  status: 'published' as const,
  public_slug: 'a'.repeat(32),
  share_version: 2,
  latest_version_id: 'version-2',
  published_version_id: 'version-1',
  view_count: 8,
  cta_click_count: 3,
  first_viewed_at: '2026-07-21T09:00:00.000Z',
  last_viewed_at: '2026-07-21T10:00:00.000Z',
  published_at: '2026-07-21T08:30:00.000Z',
  revoked_at: null,
  created_by: 'profile-1',
  created_at: '2026-07-21T08:00:00.000Z',
  updated_at: '2026-07-21T10:00:00.000Z',
}
const versions = [
  {
    id: 'version-2', report_id: 'report-1', account_id: 'account-1', client_id: 'client-1',
    version_number: 2, source_scan_id: 'scan-current', previous_scan_id: 'scan-previous',
    locale: 'en' as const, executive_summary: snapshot.executiveSummary,
    snapshot_schema_version: 1 as const, snapshot, created_by: 'profile-1', created_at: '2026-07-21T10:00:00.000Z',
  },
  {
    id: 'version-1', report_id: 'report-1', account_id: 'account-1', client_id: 'client-1',
    version_number: 1, source_scan_id: 'scan-previous', previous_scan_id: null,
    locale: 'en' as const, executive_summary: snapshot.executiveSummary,
    snapshot_schema_version: 1 as const, snapshot, created_by: 'profile-1', created_at: '2026-07-21T08:00:00.000Z',
  },
]

function request(path: string, body: unknown, raw = false) {
  return new Request('https://reports.example' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ? String(body) : JSON.stringify(body),
  })
}

const reportsContext = { params: Promise.resolve({ clientId: 'client-1' }) }
const reportContext = { params: Promise.resolve({ reportId: 'report-1' }) }

function validInvocations() {
  return [
    ['list', () => GET_REPORTS(new Request('https://reports.example/api/clients/client-1/reports'), reportsContext)],
    ['create', () => POST_REPORTS(request('/api/clients/client-1/reports', { scanId: 'scan-current', locale: 'en' }), reportsContext)],
    ['version', () => POST_VERSION(request('/api/client-reports/report-1/versions', { locale: 'en', executiveSummary: snapshot.executiveSummary }), reportContext)],
    ['AI', () => POST_AI(request('/api/client-reports/report-1/ai-summary', {}), reportContext)],
    ['publish', () => POST_PUBLISH(request('/api/client-reports/report-1/publish', {}), reportContext)],
    ['revoke', () => POST_REVOKE(request('/api/client-reports/report-1/revoke', {}), reportContext)],
    ['rotate', () => POST_ROTATE(request('/api/client-reports/report-1/rotate-link', {}), reportContext)],
  ] as const
}

describe('authenticated client report APIs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.getProfile.mockResolvedValue(proProfile)
    h.callOpenRouter.mockResolvedValue('The score of 82 shows stronger measured visibility, while the +7 change leaves 1 area requiring focused follow-up.')
    h.loadOwnedReportClient.mockResolvedValue(client)
    h.loadOwnedReportScan.mockResolvedValue(currentScan)
    h.loadPreviousReportScan.mockResolvedValue(previousScan)
    h.loadReportRecommendations.mockResolvedValue([])
    h.loadReportBranding.mockResolvedValue(branding)
    h.loadOwnedClientReportById.mockResolvedValue(report)
    h.loadOwnedClientReport.mockResolvedValue(report)
    h.listClientReports.mockResolvedValue([report])
    h.listClientReportVersions.mockResolvedValue(versions)
    h.createClientReport.mockResolvedValue({ ...report, status: 'draft', latest_version_id: 'version-1', published_version_id: null, published_at: null })
    h.appendClientReportVersion.mockResolvedValue(report)
    h.publishClientReportLatest.mockResolvedValue(report)
    h.revokeClientReport.mockResolvedValue({ ...report, status: 'revoked', public_slug: 'b'.repeat(32), share_version: 3, revoked_at: '2026-07-21T11:00:00.000Z' })
    h.rotateClientReportLink.mockResolvedValue({ ...report, public_slug: 'c'.repeat(32), share_version: 3 })
  })

  it.each(validInvocations())('returns 401 and no-store for unauthenticated %s requests', async (_name, invoke) => {
    h.getProfile.mockResolvedValue(null)

    const response = await invoke()

    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it.each(['free', 'basic', 'past_due'] as const)('fails closed for effective %s entitlement on every report operation', async kind => {
    const accounts = kind === 'free'
      ? { plan: 'pro', status: 'active', stripe_subscription_id: null, trial_ends_at: null }
      : kind === 'basic'
        ? { plan: 'basic', status: 'active', stripe_subscription_id: 'sub_basic', trial_ends_at: null }
        : { plan: 'pro', status: 'past_due', stripe_subscription_id: 'sub_pro', trial_ends_at: null }
    h.getProfile.mockResolvedValue({ ...proProfile, accounts })

    for (const [, invoke] of validInvocations()) {
      const response = await invoke()
      expect(response.status).toBe(403)
      expect(response.headers.get('cache-control')).toBe('no-store')
    }
    expect(h.createClientReport).not.toHaveBeenCalled()
    expect(h.publishClientReportLatest).not.toHaveBeenCalled()
  })

  it.each(validInvocations())('returns a safe 503 when the auth service fails for %s', async (_name, invoke) => {
    h.getProfile.mockRejectedValue(new Error('sensitive auth provider detail'))

    const response = await invoke()
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body).toEqual({ error: 'service_unavailable' })
    expect(JSON.stringify(body)).not.toContain('sensitive')
  })

  it('returns neutral 404s for wrong clients and account-scoped report misses', async () => {
    h.loadOwnedReportClient.mockResolvedValue(null)
    expect((await validInvocations()[0][1]()).status).toBe(404)
    expect((await validInvocations()[1][1]()).status).toBe(404)

    h.loadOwnedReportClient.mockResolvedValue(client)
    h.loadOwnedClientReportById.mockResolvedValue(null)
    for (const [, invoke] of validInvocations().slice(2)) {
      expect((await invoke()).status).toBe(404)
    }
  })

  it('treats a cross-account report row as a neutral 404 before any full-tuple read or mutation', async () => {
    h.loadOwnedClientReportById.mockResolvedValue({ ...report, account_id: 'account-2' })

    const response = await POST_PUBLISH(request('/api/client-reports/report-1/publish', {}), reportContext)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'not_found' })
    expect(h.loadOwnedReportClient).not.toHaveBeenCalled()
    expect(h.publishClientReportLatest).not.toHaveBeenCalled()
  })

  it.each([
    ['create commercial fields', () => POST_REPORTS(request('/api/clients/client-1/reports', {
      scanId: 'scan-current',
      locale: 'en',
      score: 100,
      delta: 25,
      fixes: [],
      branding: { agencyName: 'Attacker' },
      snapshot: {},
      status: 'published',
      viewCount: 999,
      signedUrl: 'https://attacker.example',
    }), reportsContext)],
    ['version snapshot', () => POST_VERSION(request('/api/client-reports/report-1/versions', { locale: 'en', executiveSummary: snapshot.executiveSummary, snapshot }), reportContext)],
    ['AI identifiers', () => POST_AI(request('/api/client-reports/report-1/ai-summary', { clientId: 'client-2' }), reportContext)],
    ['publish identifiers', () => POST_PUBLISH(request('/api/client-reports/report-1/publish', { clientId: 'client-2' }), reportContext)],
    ['revoke share data', () => POST_REVOKE(request('/api/client-reports/report-1/revoke', { shareVersion: 99 }), reportContext)],
    ['rotate status', () => POST_ROTATE(request('/api/client-reports/report-1/rotate-link', { status: 'published' }), reportContext)],
    ['malformed JSON', () => POST_VERSION(request('/api/client-reports/report-1/versions', '{', true), reportContext)],
  ])('rejects malformed or untrusted fields: %s', async (_name, invoke) => {
    const response = await invoke()

    expect(response.status).toBe(400)
  })

  it('lists only safe metadata and includes a signed URL only for the published report', async () => {
    const response = await GET_REPORTS(new Request('https://reports.example/api/clients/client-1/reports'), reportsContext)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.reports[0]).toMatchObject({
      id: 'report-1',
      clientId: 'client-1',
      status: 'published',
      latestVersionNumber: 2,
      publishedVersionNumber: 1,
      viewCount: 8,
      ctaClickCount: 3,
      firstViewedAt: report.first_viewed_at,
      lastViewedAt: report.last_viewed_at,
      publishedAt: report.published_at,
    })
    expect(body.reports[0].signedUrl).toMatch(/^https:\/\/reports\.example\/en\/reports\//)
    expect(body.reports[0]).not.toHaveProperty('publicSlug')
    expect(body.reports[0]).not.toHaveProperty('shareVersion')
  })

  it('rebuilds create facts and branding from owned rows and preserves the server-selected previous scan id', async () => {
    const draft = { ...report, status: 'draft' as const, latest_version_id: 'version-1', published_version_id: null, published_at: null }
    h.createClientReport.mockResolvedValue(draft)
    h.listClientReportVersions.mockResolvedValue([{ ...versions[0], id: 'version-1', version_number: 1 }])

    const response = await POST_REPORTS(request('/api/clients/client-1/reports', {
      scanId: 'scan-current',
      locale: 'zh-HK',
      executiveSummary: '這份報告顯示目前可量度證據有所改善，同時仍有一項需要團隊優先跟進的重點工作，並建議在下一個檢視週期再次核對相關結果。',
    }), reportsContext)

    expect(response.status).toBe(201)
    const write = h.createClientReport.mock.calls[0]?.[0]
    expect(write).toMatchObject({
      accountId: 'account-1',
      clientId: 'client-1',
      sourceScanId: 'scan-current',
      previousScanId: 'scan-previous',
      locale: 'zh-HK',
      createdBy: 'profile-1',
    })
    expect(write.snapshot.score).toMatchObject({ current: 82, previous: 75, delta: 7 })
    expect(write.snapshot.branding).toMatchObject({ agencyName: 'Acme Agency', primaryColor: '#123ABC' })
  })

  it('rejects a current scan outside the owned client domain without writing', async () => {
    h.loadOwnedReportScan.mockResolvedValue(null)

    const response = await POST_REPORTS(request('/api/clients/client-1/reports', { scanId: 'scan-current', locale: 'en' }), reportsContext)

    expect(response.status).toBe(404)
    expect(h.createClientReport).not.toHaveBeenCalled()
  })

  it('appends a latest draft while preserving the published version pointer and signed URL', async () => {
    const nextVersion = { ...versions[0], id: 'version-3', version_number: 3, executive_summary: 'An updated summary with enough detail to remain valid for the client report workflow.' }
    h.listClientReportVersions.mockResolvedValue([nextVersion, ...versions])
    h.appendClientReportVersion.mockResolvedValue({ ...report, latest_version_id: 'version-3', published_version_id: 'version-1' })

    const response = await POST_VERSION(request('/api/client-reports/report-1/versions', {
      locale: 'en',
      executiveSummary: nextVersion.executive_summary,
    }), reportContext)
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(h.appendClientReportVersion).toHaveBeenCalledWith(expect.objectContaining({
      reportId: 'report-1',
      accountId: 'account-1',
      clientId: 'client-1',
      sourceScanId: 'scan-current',
      previousScanId: 'scan-previous',
    }))
    expect(body.report).toMatchObject({ latestVersionNumber: 3, publishedVersionNumber: 1 })
    expect(body.report.signedUrl).toMatch(/^https:\/\/reports\.example\/en\/reports\//)
  })

  it('returns AI polish without mutating report versions', async () => {
    const response = await POST_AI(request('/api/client-reports/report-1/ai-summary', {}), reportContext)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ polished: true, code: 'ai_polished' })
    expect(h.callOpenRouter).toHaveBeenCalledTimes(1)
    expect(h.appendClientReportVersion).not.toHaveBeenCalled()
  })

  it('validates the full report/version tuple before publishing and performs no fallible read after the RPC', async () => {
    const response = await POST_PUBLISH(request('/api/client-reports/report-1/publish', {}), reportContext)

    expect(response.status).toBe(200)
    expect(h.listClientReportVersions).toHaveBeenCalledTimes(1)
    expect(h.listClientReportVersions.mock.invocationCallOrder[0])
      .toBeLessThan(h.publishClientReportLatest.mock.invocationCallOrder[0])
  })

  it.each([
    ['publish', POST_PUBLISH, h.publishClientReportLatest, 'a'],
    ['rotate', POST_ROTATE, h.rotateClientReportLink, 'c'],
  ] as const)('%s returns a newly signed URL and safe metadata without raw share fields', async (name, handler, mutation, slugChar) => {
    const response = await handler(request('/api/client-reports/report-1/' + name, {}), reportContext)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mutation).toHaveBeenCalledWith({ accountId: 'account-1', clientId: 'client-1', reportId: 'report-1' })
    expect(body.signedUrl).toContain('/en/reports/' + slugChar.repeat(32))
    expect(body.report).not.toHaveProperty('publicSlug')
    expect(body.report).not.toHaveProperty('shareVersion')
  })

  it('revoke returns no usable URL or share material', async () => {
    const response = await POST_REVOKE(request('/api/client-reports/report-1/revoke', {}), reportContext)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ report: expect.objectContaining({ id: 'report-1', status: 'revoked' }) })
    expect(JSON.stringify(body)).not.toMatch(/signedUrl|public_slug|publicSlug|share_version|shareVersion/)
  })
})