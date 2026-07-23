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
  id: '11111111-1111-4111-8111-111111111111',
  account_id: '22222222-2222-4222-8222-222222222222',
  accounts: {
    plan: 'pro', status: 'active', stripe_subscription_id: 'sub_pro', trial_ends_at: null,
  },
}
const client = { id: '33333333-3333-4333-8333-333333333333', accountId: '22222222-2222-4222-8222-222222222222', name: 'Example Client', domain: 'example.com' }
const currentScan = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  accountId: '22222222-2222-4222-8222-222222222222',
  domain: 'www.example.com',
  createdAt: '2026-07-21T08:00:00.000Z',
  score: 82,
  grade: 'A',
  results: { c1_robots: { status: 'pass' }, c2_llms_txt: { status: 'warn' } },
}
const previousScan = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  accountId: '22222222-2222-4222-8222-222222222222',
  domain: 'example.com',
  createdAt: '2026-07-20T08:00:00.000Z',
  score: 75,
  grade: 'B',
  results: { c1_robots: { status: 'warn' }, c2_llms_txt: { status: 'warn' } },
}
const branding = {
  accountId: '22222222-2222-4222-8222-222222222222',
  agencyName: 'Acme Agency',
  logoUrl: null,
  primaryColor: '#123ABC',
  contactLabel: null,
  contactUrl: null,
  updatedBy: '11111111-1111-4111-8111-111111111111',
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
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  account_id: '22222222-2222-4222-8222-222222222222',
  client_id: '33333333-3333-4333-8333-333333333333',
  status: 'published' as const,
  public_slug: 'a'.repeat(32),
  share_version: 2,
  latest_version_id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
  published_version_id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
  view_count: 8,
  cta_click_count: 3,
  first_viewed_at: '2026-07-21T09:00:00.000Z',
  last_viewed_at: '2026-07-21T10:00:00.000Z',
  published_at: '2026-07-21T08:30:00.000Z',
  revoked_at: null,
  created_by: '11111111-1111-4111-8111-111111111111',
  created_at: '2026-07-21T08:00:00.000Z',
  updated_at: '2026-07-21T10:00:00.000Z',
}
const versions = [
  {
    id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2', report_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', account_id: '22222222-2222-4222-8222-222222222222', client_id: '33333333-3333-4333-8333-333333333333',
    version_number: 2, source_scan_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', previous_scan_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    locale: 'en' as const, executive_summary: snapshot.executiveSummary,
    snapshot_schema_version: 1 as const, snapshot, created_by: '11111111-1111-4111-8111-111111111111', created_at: '2026-07-21T10:00:00.000Z',
  },
  {
    id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', report_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', account_id: '22222222-2222-4222-8222-222222222222', client_id: '33333333-3333-4333-8333-333333333333',
    version_number: 1, source_scan_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', previous_scan_id: null,
    locale: 'en' as const, executive_summary: snapshot.executiveSummary,
    snapshot_schema_version: 1 as const, snapshot, created_by: '11111111-1111-4111-8111-111111111111', created_at: '2026-07-21T08:00:00.000Z',
  },
]

function request(path: string, body: unknown, raw = false) {
  return new Request('https://reports.example' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ? String(body) : JSON.stringify(body),
  })
}

const reportsContext = { params: Promise.resolve({ clientId: '33333333-3333-4333-8333-333333333333' }) }
const reportContext = { params: Promise.resolve({ reportId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1' }) }

function validInvocations() {
  return [
    ['list', () => GET_REPORTS(new Request('https://reports.example/api/clients/33333333-3333-4333-8333-333333333333/reports'), reportsContext)],
    ['create', () => POST_REPORTS(request('/api/clients/33333333-3333-4333-8333-333333333333/reports', { scanId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', locale: 'en' }), reportsContext)],
    ['version', () => POST_VERSION(request('/api/client-reports/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1/versions', { locale: 'en', executiveSummary: snapshot.executiveSummary }), reportContext)],
    ['AI', () => POST_AI(request('/api/client-reports/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1/ai-summary', {}), reportContext)],
    ['publish', () => POST_PUBLISH(request('/api/client-reports/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1/publish', {}), reportContext)],
    ['revoke', () => POST_REVOKE(request('/api/client-reports/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1/revoke', {}), reportContext)],
    ['rotate', () => POST_ROTATE(request('/api/client-reports/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1/rotate-link', {}), reportContext)],
  ] as const
}

describe('authenticated client report APIs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.REPORT_SHARE_SECRET = 'test-report-share-secret-that-is-at-least-32-characters'
    process.env.NEXT_PUBLIC_APP_URL = 'https://reports.example'
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
    h.createClientReport.mockResolvedValue({
      report: { ...report, status: 'draft', latest_version_id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', published_version_id: null, published_at: null },
      version: versions[1],
    })
    h.appendClientReportVersion.mockResolvedValue({
      report,
      version: { ...versions[0], id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3', version_number: 3 },
    })
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
    h.loadOwnedClientReportById.mockResolvedValue({ ...report, account_id: '22222222-2222-4222-8222-222222222223' })

    const response = await POST_PUBLISH(request('/api/client-reports/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1/publish', {}), reportContext)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'not_found' })
    expect(h.loadOwnedReportClient).not.toHaveBeenCalled()
    expect(h.publishClientReportLatest).not.toHaveBeenCalled()
  })

  it.each([
    ['list client path', () => GET_REPORTS(new Request('https://reports.example/api/clients/client-1/reports'), { params: Promise.resolve({ clientId: 'client-1' }) })],
    ['create client path', () => POST_REPORTS(request('/api/clients/client-1/reports', { scanId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', locale: 'en' }), { params: Promise.resolve({ clientId: 'client-1' }) })],
    ['create scan body', () => POST_REPORTS(request('/api/clients/33333333-3333-4333-8333-333333333333/reports', { scanId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAA1', locale: 'en' }), reportsContext)],
    ['version report path', () => POST_VERSION(request('/api/client-reports/report-1/versions', { locale: 'en', executiveSummary: snapshot.executiveSummary }), { params: Promise.resolve({ reportId: 'report-1' }) })],
    ['AI report path', () => POST_AI(request('/api/client-reports/report-1/ai-summary', {}), { params: Promise.resolve({ reportId: 'report-1' }) })],
    ['publish report path', () => POST_PUBLISH(request('/api/client-reports/report-1/publish', {}), { params: Promise.resolve({ reportId: 'report-1' }) })],
    ['revoke report path', () => POST_REVOKE(request('/api/client-reports/report-1/revoke', {}), { params: Promise.resolve({ reportId: 'report-1' }) })],
    ['rotate report path', () => POST_ROTATE(request('/api/client-reports/report-1/rotate-link', {}), { params: Promise.resolve({ reportId: 'report-1' }) })],
  ] as const)('rejects a non-canonical UUID before service/store access: %s', async (_name, invoke) => {
    const response = await invoke()

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_request' })
    expect(h.getProfile).not.toHaveBeenCalled()
    expect(h.loadOwnedReportClient).not.toHaveBeenCalled()
    expect(h.loadOwnedReportScan).not.toHaveBeenCalled()
    expect(h.loadOwnedClientReportById).not.toHaveBeenCalled()
  })
  it.each([
    ['create commercial fields', () => POST_REPORTS(request('/api/clients/33333333-3333-4333-8333-333333333333/reports', {
      scanId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
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
    ['version snapshot', () => POST_VERSION(request('/api/client-reports/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1/versions', { locale: 'en', executiveSummary: snapshot.executiveSummary, snapshot }), reportContext)],
    ['AI identifiers', () => POST_AI(request('/api/client-reports/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1/ai-summary', { clientId: '33333333-3333-4333-8333-333333333334' }), reportContext)],
    ['publish identifiers', () => POST_PUBLISH(request('/api/client-reports/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1/publish', { clientId: '33333333-3333-4333-8333-333333333334' }), reportContext)],
    ['revoke share data', () => POST_REVOKE(request('/api/client-reports/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1/revoke', { shareVersion: 99 }), reportContext)],
    ['rotate status', () => POST_ROTATE(request('/api/client-reports/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1/rotate-link', { status: 'published' }), reportContext)],
    ['malformed JSON', () => POST_VERSION(request('/api/client-reports/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1/versions', '{', true), reportContext)],
  ])('rejects malformed or untrusted fields: %s', async (_name, invoke) => {
    const response = await invoke()

    expect(response.status).toBe(400)
  })

  it('lists only safe metadata and includes a signed URL only for the published report', async () => {
    const response = await GET_REPORTS(new Request('https://reports.example/api/clients/33333333-3333-4333-8333-333333333333/reports'), reportsContext)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.reports[0]).toMatchObject({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      clientId: '33333333-3333-4333-8333-333333333333',
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
    const draft = { ...report, status: 'draft' as const, latest_version_id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', published_version_id: null, published_at: null }
    h.createClientReport.mockResolvedValue({
      report: draft,
      version: { ...versions[0], id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', version_number: 1 },
    })

    const response = await POST_REPORTS(request('/api/clients/33333333-3333-4333-8333-333333333333/reports', {
      scanId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      locale: 'zh-HK',
      executiveSummary: '這份報告顯示目前可量度證據有所改善，同時仍有一項需要團隊優先跟進的重點工作，並建議在下一個檢視週期再次核對相關結果。',
    }), reportsContext)

    expect(response.status).toBe(201)
    const write = h.createClientReport.mock.calls[0]?.[0]
    expect(write).toMatchObject({
      accountId: '22222222-2222-4222-8222-222222222222',
      clientId: '33333333-3333-4333-8333-333333333333',
      sourceScanId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      previousScanId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      locale: 'zh-HK',
      createdBy: '11111111-1111-4111-8111-111111111111',
    })
    expect(write.snapshot.score).toMatchObject({ current: 82, previous: 75, delta: 7 })
    expect(write.snapshot.branding).toMatchObject({ agencyName: 'Acme Agency', primaryColor: '#123ABC' })
  })

  it('rejects a current scan outside the owned client domain without writing', async () => {
    h.loadOwnedReportScan.mockResolvedValue(null)

    const response = await POST_REPORTS(request('/api/clients/33333333-3333-4333-8333-333333333333/reports', { scanId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', locale: 'en' }), reportsContext)

    expect(response.status).toBe(404)
    expect(h.createClientReport).not.toHaveBeenCalled()
  })

  it('appends a latest draft while preserving the published version pointer and signed URL', async () => {
    const nextVersion = { ...versions[0], id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3', version_number: 3, executive_summary: 'An updated summary with enough detail to remain valid for the client report workflow.' }
    h.listClientReportVersions.mockResolvedValue(versions)
    h.appendClientReportVersion.mockResolvedValue({
      report: { ...report, latest_version_id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3', published_version_id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1' },
      version: nextVersion,
    })

    const response = await POST_VERSION(request('/api/client-reports/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1/versions', {
      locale: 'en',
      executiveSummary: nextVersion.executive_summary,
    }), reportContext)
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(h.appendClientReportVersion).toHaveBeenCalledWith(expect.objectContaining({
      reportId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      accountId: '22222222-2222-4222-8222-222222222222',
      clientId: '33333333-3333-4333-8333-333333333333',
      sourceScanId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      previousScanId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    }))
    expect(body.report).toMatchObject({ latestVersionNumber: 3, publishedVersionNumber: 1 })
    expect(body.report.signedUrl).toMatch(/^https:\/\/reports\.example\/en\/reports\//)
  })

  it('uses the atomic create RPC result and performs no fallible version read after commit', async () => {
    h.listClientReportVersions.mockRejectedValue(new Error('post-write read failed'))

    const response = await POST_REPORTS(request('/api/clients/33333333-3333-4333-8333-333333333333/reports', {
      scanId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      locale: 'en',
    }), reportsContext)

    expect(response.status).toBe(201)
    expect(h.createClientReport).toHaveBeenCalledTimes(1)
    expect(h.listClientReportVersions).not.toHaveBeenCalled()
  })

  it('uses the atomic append RPC result and performs no second version read after commit', async () => {
    h.listClientReportVersions
      .mockResolvedValueOnce(versions)
      .mockRejectedValue(new Error('post-write read failed'))

    const response = await POST_VERSION(request('/api/client-reports/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1/versions', {
      locale: 'en',
      executiveSummary: 'An updated summary with enough detail to remain valid for the client report workflow.',
    }), reportContext)

    expect(response.status).toBe(201)
    expect(h.appendClientReportVersion).toHaveBeenCalledTimes(1)
    expect(h.listClientReportVersions).toHaveBeenCalledTimes(1)
  })

  it('returns AI polish without mutating report versions', async () => {
    const response = await POST_AI(request('/api/client-reports/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1/ai-summary', {}), reportContext)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ polished: true, code: 'ai_polished' })
    expect(h.callOpenRouter).toHaveBeenCalledTimes(1)
    expect(h.appendClientReportVersion).not.toHaveBeenCalled()
  })

  it('derives AI facts and the numeric allowlist from structured snapshot data, not the edited summary', async () => {
    const attackerSummary = 'Tampered summary claims score 999, revenue growth, and 55 percent traffic gains.'
    h.listClientReportVersions.mockResolvedValue([
      { ...versions[0], snapshot: { ...snapshot, executiveSummary: attackerSummary } },
      versions[1],
    ])

    const response = await POST_AI(request('/api/client-reports/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1/ai-summary', {}), reportContext)
    const body = await response.json()
    const prompt = h.callOpenRouter.mock.calls[0]?.[0].messages[1].content as string

    expect(response.status).toBe(200)
    expect(prompt).not.toContain('Tampered summary')
    expect(prompt).not.toContain('999')
    expect(prompt).not.toContain('revenue')
    expect(body.summary).not.toBe(attackerSummary)
  })

  it.each([
    ['non-finite score', { ...snapshot, score: { ...snapshot.score, current: Number.POSITIVE_INFINITY } }],
    ['string score delta', { ...snapshot, score: { ...snapshot.score, delta: '7' } }],
    ['unsupported change kind', { ...snapshot, changes: [{ key: 'c1_robots', label: 'Robots access', kind: 'invented' }] }],
    ['malformed change row', { ...snapshot, changes: [{ key: 'c1_robots', kind: 'improved' }] }],
  ] as const)('rejects a persisted snapshot with %s before OpenRouter', async (_name, malformedSnapshot) => {
    h.listClientReportVersions.mockResolvedValue([
      { ...versions[0], snapshot: malformedSnapshot },
      versions[1],
    ])

    const response = await POST_AI(request('/api/client-reports/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1/ai-summary', {}), reportContext)

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'conflict' })
    expect(h.callOpenRouter).not.toHaveBeenCalled()
  })
  it.each([
    ['publish', POST_PUBLISH, h.publishClientReportLatest],
    ['rotate', POST_ROTATE, h.rotateClientReportLink],
  ] as const)('rejects invalid share origin before the %s RPC', async (_name, handler, mutation) => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://reports.example'

    const response = await handler(request('/api/client-reports/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1/action', {}), reportContext)

    expect(response.status).toBe(503)
    expect(mutation).not.toHaveBeenCalled()
  })

  it.each([
    ['publish', POST_PUBLISH, h.publishClientReportLatest],
    ['rotate', POST_ROTATE, h.rotateClientReportLink],
  ] as const)('rejects missing share secret before the %s RPC', async (_name, handler, mutation) => {
    delete process.env.REPORT_SHARE_SECRET

    const response = await handler(request('/api/client-reports/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1/action', {}), reportContext)

    expect(response.status).toBe(503)
    expect(mutation).not.toHaveBeenCalled()
  })

  it.each([
    ['publish', POST_PUBLISH],
    ['revoke', POST_REVOKE],
    ['rotate', POST_ROTATE],
  ] as const)('%s performs its only fallible version read before the RPC', async (_name, handler) => {
    h.listClientReportVersions
      .mockResolvedValueOnce(versions)
      .mockRejectedValue(new Error('post-write read failed'))

    const response = await handler(request('/api/client-reports/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1/action', {}), reportContext)

    expect(response.status).toBe(200)
    expect(h.listClientReportVersions).toHaveBeenCalledTimes(1)
  })

  it('validates the full report/version tuple before publishing and performs no fallible read after the RPC', async () => {
    const response = await POST_PUBLISH(request('/api/client-reports/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1/publish', {}), reportContext)

    expect(response.status).toBe(200)
    expect(h.listClientReportVersions).toHaveBeenCalledTimes(1)
    expect(h.listClientReportVersions.mock.invocationCallOrder[0])
      .toBeLessThan(h.publishClientReportLatest.mock.invocationCallOrder[0])
  })

  it.each([
    ['publish', POST_PUBLISH, h.publishClientReportLatest, 'a'],
    ['rotate', POST_ROTATE, h.rotateClientReportLink, 'c'],
  ] as const)('%s returns a newly signed URL and safe metadata without raw share fields', async (name, handler, mutation, slugChar) => {
    const response = await handler(request('/api/client-reports/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1/' + name, {}), reportContext)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mutation).toHaveBeenCalledWith({ accountId: '22222222-2222-4222-8222-222222222222', clientId: '33333333-3333-4333-8333-333333333333', reportId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1' })
    expect(body.signedUrl).toContain('/en/reports/' + slugChar.repeat(32))
    expect(body.report).not.toHaveProperty('publicSlug')
    expect(body.report).not.toHaveProperty('shareVersion')
  })

  it('revoke returns no usable URL or share material', async () => {
    const response = await POST_REVOKE(request('/api/client-reports/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1/revoke', {}), reportContext)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ report: expect.objectContaining({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', status: 'revoked' }) })
    expect(JSON.stringify(body)).not.toMatch(/signedUrl|public_slug|publicSlug|share_version|shareVersion/)
  })
})