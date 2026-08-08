import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

type Call = { text: string; values: unknown[]; params: Record<string, unknown> }

const state = vi.hoisted(() => ({
  calls: [] as Call[],
  nextResults: [] as unknown[],
}))

// Captures both the literal query text (for scoping assertions — "does this
// query filter by account_id") and, for named-argument RPC calls
// (`p_foo => ${value}`), a name -> value map built by reading the identifier
// immediately before each `=>` in the template's string segments. That lets
// tests assert the exact parameter each value was bound to instead of just
// its position, which is the only way to catch a transposition between two
// same-typed arguments (see the self-review requirement this proves).
function paramNameFor(segmentBeforeValue: string): string | null {
  const match = /(\w+)\s*=>\s*$/.exec(segmentBeforeValue.trimEnd())
  return match ? match[1] : null
}

const mockSql = vi.hoisted(() => vi.fn())

vi.mock('@/lib/db', () => ({ db: () => mockSql }))

mockSql.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
  const params: Record<string, unknown> = {}
  values.forEach((value, i) => {
    const name = paramNameFor(strings[i])
    if (name) params[name] = value
  })
  state.calls.push({ text: strings.join('?'), values, params })
  const result = state.nextResults.shift()
  if (result instanceof Error) throw result
  return Promise.resolve(result ?? [])
})

import {
  appendClientReportVersion,
  createClientReport,
  incrementClientReportCtaClick,
  incrementClientReportView,
  listClientReportVersions,
  listClientReports,
  loadOwnedClientReportById,
  loadOwnedReportClient,
  loadOwnedReportScan,
  loadPreviousReportScan,
  loadReportBranding,
  loadReportRecommendations,
  publishClientReportLatest,
  resolvePublicClientReport,
  revokeClientReport,
  rotateClientReportLink,
  upsertReportBranding,
} from '@/lib/reports/store'

function queue(...results: unknown[]) {
  state.nextResults = results
}

function callsContaining(text: string) {
  return state.calls.filter(call => call.text.includes(text))
}

function lastCall() {
  return state.calls.at(-1)
}

const currentScan = {
  accountId: 'account-1',
  domain: 'example.com',
  createdAt: '2026-07-21T08:00:00.000Z',
  score: 80,
  grade: 'A',
  results: { c1_robots: { status: 'pass' } },
}

const validReportRow = {
  id: 'report-1',
  account_id: 'account-1',
  client_id: 'client-1',
  status: 'published' as const,
  public_slug: 'a'.repeat(32),
  share_version: 2,
  latest_version_id: 'version-2',
  published_version_id: 'version-1',
  view_count: 0,
  cta_click_count: 0,
  first_viewed_at: null,
  last_viewed_at: null,
  published_at: '2026-07-21T09:00:00.000Z',
  revoked_at: null,
  created_by: 'profile-1',
  created_at: '2026-07-21T08:00:00.000Z',
  updated_at: '2026-07-21T09:00:00.000Z',
}

const validVersionRow = {
  id: 'version-1',
  report_id: 'report-1',
  account_id: 'account-1',
  client_id: 'client-1',
  version_number: 1,
  source_scan_id: 'scan-1',
  previous_scan_id: null,
  locale: 'en' as const,
  executive_summary: 'A deterministic report summary with enough content for the stored version row.',
  snapshot_schema_version: 1 as const,
  snapshot: { snapshotSchemaVersion: 1 },
  created_by: 'profile-1',
  created_at: '2026-07-21T08:00:00.000Z',
}

describe('report store tenant boundary', () => {
  beforeEach(() => {
    state.calls.length = 0
    state.nextResults = []
    mockSql.mockClear()
  })

  it('loads an owned client with account and client filters', async () => {
    queue([{ id: 'client-1', account_id: 'account-1', brand_name: 'Example', domain: 'example.com' }])

    const result = await loadOwnedReportClient({ accountId: 'account-1', clientId: 'client-1' })

    expect(result).toEqual({ id: 'client-1', accountId: 'account-1', name: 'Example', domain: 'example.com' })
    const query = callsContaining('from clients')[0]
    expect(query?.text).toContain('account_id')
    expect(query?.values).toContain('account-1')
    expect(query?.values).toContain('client-1')
  })

  it('rejects a current scan whose normalized domain does not match the owned client domain', async () => {
    queue([{ id: 'scan-1', account_id: 'account-1', domain: 'other.example', created_at: currentScan.createdAt, score: 80, grade: 'A', results: {} }])

    const result = await loadOwnedReportScan({ accountId: 'account-1', scanId: 'scan-1', clientDomain: 'https://www.example.com/' })

    expect(result).toBeNull()
    const query = callsContaining('from scans')[0]
    expect(query?.values).toEqual(expect.arrayContaining(['account-1', 'scan-1']))
  })

  it('preserves the exact current scan id after strict account and domain checks', async () => {
    queue([{ id: 'scan-current', account_id: 'account-1', domain: 'www.example.com', created_at: currentScan.createdAt, score: 80, grade: 'A', results: {} }])

    const result = await loadOwnedReportScan({ accountId: 'account-1', scanId: 'scan-current', clientDomain: 'example.com' })

    expect(result).toMatchObject({ id: 'scan-current', accountId: 'account-1', domain: 'www.example.com' })
  })

  it('normalizes a Date-valued created_at from the driver into an ISO string', async () => {
    queue([{
      id: 'scan-current', account_id: 'account-1', domain: 'example.com',
      created_at: new Date('2026-07-21T08:00:00.000Z'), score: 80, grade: 'A', results: {},
    }])

    const result = await loadOwnedReportScan({ accountId: 'account-1', scanId: 'scan-current', clientDomain: 'example.com' })

    expect(result?.createdAt).toBe('2026-07-21T08:00:00.000Z')
  })

  it('queries stored hostname variants and returns the exact nearest eligible previous scan id', async () => {
    queue([
      { id: 'older-www', account_id: 'account-1', domain: 'www.example.com', created_at: '2026-07-19T08:00:00.000Z', score: 70, grade: 'B', results: {} },
      { id: 'nearest-www', account_id: 'account-1', domain: 'www.example.com', created_at: '2026-07-20T08:00:00.000Z', score: 75, grade: 'B', results: {} },
    ])

    const result = await loadPreviousReportScan({ accountId: 'account-1', currentScan })

    expect(result).toMatchObject({ id: 'nearest-www', createdAt: '2026-07-20T08:00:00.000Z' })
    const query = callsContaining('from scans')[0]
    expect(query?.text).toContain('domain in')
    expect(query?.values).toEqual(expect.arrayContaining(['example.com', 'www.example.com', currentScan.createdAt]))
    expect(query?.text).toContain('order by created_at desc')
  })

  it('authorizes recommendation loading by the scan account and domain before reading children', async () => {
    queue(
      [{ id: 'scan-1', account_id: 'account-1', domain: 'example.com', created_at: currentScan.createdAt, score: 80, grade: 'A', results: {} }],
      [{ id: 'rec-1', category: 'robots', priority: 'high', recommendation: 'Fix robots', impact_score: 10 }],
    )

    const result = await loadReportRecommendations({ accountId: 'account-1', scanId: 'scan-1', clientDomain: 'example.com' })

    expect(result).toHaveLength(1)
    const query = callsContaining('from agent_recommendations')[0]
    expect(query?.values).toContain('scan-1')
  })

  it('does not query recommendations when the scan tenant/domain check fails', async () => {
    queue([{ id: 'scan-1', account_id: 'account-1', domain: 'wrong.example', created_at: currentScan.createdAt, score: 80, grade: 'A', results: {} }])

    await expect(loadReportRecommendations({ accountId: 'account-1', scanId: 'scan-1', clientDomain: 'example.com' })).resolves.toEqual([])
    expect(callsContaining('from agent_recommendations')).toHaveLength(0)
  })

  it('loads and upserts branding only for the supplied account', async () => {
    queue(
      [{ account_id: 'account-1', agency_name: 'Agency', logo_url: null, primary_color: '#123ABC', contact_label: null, contact_url: null, updated_by: null, created_at: '2026-07-21T08:00:00.000Z', updated_at: '2026-07-21T08:00:00.000Z' }],
      [{ account_id: 'account-1', agency_name: 'Agency', logo_url: null, primary_color: '#123ABC', contact_label: null, contact_url: null, updated_by: 'profile-1', created_at: '2026-07-21T08:00:00.000Z', updated_at: '2026-07-21T09:00:00.000Z' }],
    )

    await loadReportBranding({ accountId: 'account-1' })
    await upsertReportBranding({ accountId: 'account-1', updatedBy: 'profile-1', branding: { agencyName: 'Agency', logoUrl: null, primaryColor: '#123ABC', contactLabel: null, contactUrl: null } })

    expect(callsContaining('from account_report_branding')[0]?.values).toContain('account-1')
    const upsert = callsContaining('insert into account_report_branding')[0]
    expect(upsert?.text).toContain('on conflict (account_id)')
    expect(upsert?.values).toEqual(expect.arrayContaining(['account-1', 'profile-1']))
  })

  it('rejects an upsert response for another account instead of synthesizing the requested account id', async () => {
    queue([{ account_id: 'account-2', agency_name: 'Other Agency', logo_url: null, primary_color: '#123ABC', contact_label: null, contact_url: null }])

    await expect(upsertReportBranding({
      accountId: 'account-1',
      updatedBy: 'profile-1',
      branding: { agencyName: 'Agency', logoUrl: null, primaryColor: '#123ABC', contactLabel: null, contactUrl: null },
    })).resolves.toBeNull()
  })

  it('maps every argument to its named RPC parameter for create, append, publish, revoke, and rotate', async () => {
    const version = {
      accountId: 'account-1', clientId: 'client-1', sourceScanId: 'scan-1', previousScanId: 'scan-0',
      locale: 'en' as const, executiveSummary: 'Summary', snapshotSchemaVersion: 1 as const,
      snapshot: { snapshotSchemaVersion: 1 } as never, createdBy: 'profile-1',
    }
    queue([{ result: null }], [{ result: null }], [{ result: null }], [{ result: null }], [{ result: null }])

    await createClientReport(version)
    expect(callsContaining('create_client_report_with_version')[0]?.params).toMatchObject({
      p_account_id: 'account-1', p_client_id: 'client-1', p_source_scan_id: 'scan-1',
      p_previous_scan_id: 'scan-0', p_locale: 'en', p_executive_summary: 'Summary',
      p_snapshot_schema_version: 1, p_created_by: 'profile-1',
    })

    await appendClientReportVersion({ ...version, reportId: 'report-1' })
    expect(callsContaining('append_client_report_version')[0]?.params).toMatchObject({
      p_report_id: 'report-1', p_account_id: 'account-1', p_client_id: 'client-1',
      p_source_scan_id: 'scan-1', p_previous_scan_id: 'scan-0', p_locale: 'en',
      p_executive_summary: 'Summary', p_snapshot_schema_version: 1, p_created_by: 'profile-1',
    })

    await publishClientReportLatest({ accountId: 'account-1', clientId: 'client-1', reportId: 'report-1', reviewedVersionId: 'version-9' })
    expect(callsContaining('publish_client_report_latest')[0]?.params).toMatchObject({
      p_report_id: 'report-1', p_account_id: 'account-1', p_client_id: 'client-1', p_reviewed_version_id: 'version-9',
    })

    await revokeClientReport({ accountId: 'account-1', clientId: 'client-1', reportId: 'report-1' })
    expect(callsContaining('revoke_client_report')[0]?.params).toMatchObject({
      p_report_id: 'report-1', p_account_id: 'account-1', p_client_id: 'client-1',
    })

    await rotateClientReportLink({ accountId: 'account-1', clientId: 'client-1', reportId: 'report-1' })
    expect(callsContaining('rotate_client_report_link')[0]?.params).toMatchObject({
      p_report_id: 'report-1', p_account_id: 'account-1', p_client_id: 'client-1',
    })
  })

  it('returns strictly validated authoritative payloads from every lifecycle RPC', async () => {
    const createReport = {
      ...validReportRow,
      status: 'draft' as const,
      latest_version_id: 'version-1',
      published_version_id: null,
      published_at: null,
    }
    const appendedVersion = { ...validVersionRow, id: 'version-2', version_number: 2 }
    const publishedReport = { ...validReportRow, published_version_id: 'version-2' }
    const revokedReport = {
      ...validReportRow,
      status: 'revoked' as const,
      public_slug: 'b'.repeat(32),
      share_version: 3,
      revoked_at: '2026-07-21T10:00:00.000Z',
    }
    const rotatedReport = { ...validReportRow, public_slug: 'c'.repeat(32), share_version: 3 }
    queue(
      [{ result: { report: createReport, version: validVersionRow } }],
      [{ result: { report: validReportRow, version: appendedVersion, previous_published_version_id: validVersionRow.id, published_version: validVersionRow } }],
      [{ result: { report: publishedReport, latest_version: appendedVersion, published_version: appendedVersion } }],
      [{ result: { report: revokedReport, latest_version: appendedVersion, published_version: validVersionRow } }],
      [{ result: { report: rotatedReport, latest_version: appendedVersion, published_version: validVersionRow } }],
    )
    const input = {
      accountId: 'account-1', clientId: 'client-1', sourceScanId: 'scan-1', previousScanId: null,
      locale: 'en' as const, executiveSummary: 'Summary', snapshotSchemaVersion: 1 as const,
      snapshot: { snapshotSchemaVersion: 1 } as never, createdBy: 'profile-1',
    }
    const tuple = { accountId: 'account-1', clientId: 'client-1', reportId: 'report-1' }

    await expect(createClientReport(input)).resolves.toEqual({ report: createReport, version: validVersionRow })
    await expect(appendClientReportVersion({ ...input, reportId: 'report-1' })).resolves.toEqual({
      report: validReportRow,
      version: appendedVersion,
      publishedVersion: validVersionRow,
      previousPublishedVersionId: validVersionRow.id,
    })
    await expect(publishClientReportLatest({ ...tuple, reviewedVersionId: 'version-2' })).resolves.toEqual({
      report: publishedReport,
      latestVersion: appendedVersion,
      publishedVersion: appendedVersion,
    })
    await expect(revokeClientReport(tuple)).resolves.toEqual({
      report: revokedReport,
      latestVersion: appendedVersion,
      publishedVersion: validVersionRow,
    })
    await expect(rotateClientReportLink(tuple)).resolves.toEqual({
      report: rotatedReport,
      latestVersion: appendedVersion,
      publishedVersion: validVersionRow,
    })
  })

  it('rejects an append payload that aliases the new version as the pre-existing publication', async () => {
    const appendedVersion = { ...validVersionRow, id: 'version-2', version_number: 2 }
    queue([{
      result: {
        report: { ...validReportRow, published_version_id: appendedVersion.id },
        version: appendedVersion,
        published_version: appendedVersion,
        previous_published_version_id: validVersionRow.id,
      },
    }])

    await expect(appendClientReportVersion({
      reportId: 'report-1', accountId: 'account-1', clientId: 'client-1', sourceScanId: 'scan-1', previousScanId: null,
      locale: 'en', executiveSummary: 'Summary', snapshotSchemaVersion: 1,
      snapshot: { snapshotSchemaVersion: 1 } as never, createdBy: 'profile-1',
    })).resolves.toBeNull()
  })

  it.each([
    ['create account mismatch', () => createClientReport({
      accountId: 'account-1', clientId: 'client-1', sourceScanId: 'scan-1', previousScanId: null,
      locale: 'en', executiveSummary: 'Summary', snapshotSchemaVersion: 1,
      snapshot: { snapshotSchemaVersion: 1 } as never, createdBy: 'profile-1',
    }), { report: { ...validReportRow, status: 'draft', account_id: 'account-2', latest_version_id: 'version-1', published_version_id: null, published_at: null }, version: validVersionRow }],
    ['append version tuple mismatch', () => appendClientReportVersion({
      reportId: 'report-1', accountId: 'account-1', clientId: 'client-1', sourceScanId: 'scan-1', previousScanId: null,
      locale: 'en', executiveSummary: 'Summary', snapshotSchemaVersion: 1,
      snapshot: { snapshotSchemaVersion: 1 } as never, createdBy: 'profile-1',
    }), { report: validReportRow, version: { ...validVersionRow, id: 'version-2', version_number: 2, client_id: 'client-2' }, published_version: validVersionRow }],
    ['append published pointer mismatch', () => appendClientReportVersion({
      reportId: 'report-1', accountId: 'account-1', clientId: 'client-1', sourceScanId: 'scan-1', previousScanId: null,
      locale: 'en', executiveSummary: 'Summary', snapshotSchemaVersion: 1,
      snapshot: { snapshotSchemaVersion: 1 } as never, createdBy: 'profile-1',
    }), { report: validReportRow, version: { ...validVersionRow, id: 'version-2', version_number: 2 }, published_version: { ...validVersionRow, id: 'version-other' } }],
    ['append draft publication state', () => appendClientReportVersion({
      reportId: 'report-1', accountId: 'account-1', clientId: 'client-1', sourceScanId: 'scan-1', previousScanId: null,
      locale: 'en', executiveSummary: 'Summary', snapshotSchemaVersion: 1,
      snapshot: { snapshotSchemaVersion: 1 } as never, createdBy: 'profile-1',
    }), { report: { ...validReportRow, status: 'draft' }, version: { ...validVersionRow, id: 'version-2', version_number: 2 }, published_version: validVersionRow }],
    ['publish invalid locale', () => publishClientReportLatest({ accountId: 'account-1', clientId: 'client-1', reportId: 'report-1', reviewedVersionId: 'version-2' }), { report: { ...validReportRow, published_version_id: 'version-2' }, published_version: { ...validVersionRow, id: 'version-2', version_number: 2, locale: 'fr' } }],
    ['revoke malformed slug', () => revokeClientReport({ accountId: 'account-1', clientId: 'client-1', reportId: 'report-1' }), { report: { ...validReportRow, status: 'revoked', public_slug: 'short', revoked_at: '2026-07-21T10:00:00.000Z' } }],
    ['rotate non-published report', () => rotateClientReportLink({ accountId: 'account-1', clientId: 'client-1', reportId: 'report-1' }), { report: { ...validReportRow, status: 'revoked', revoked_at: '2026-07-21T10:00:00.000Z' }, published_version: validVersionRow }],
  ] as const)('fails closed for an unauthorized or malformed RPC result: %s', async (_label, invoke, data) => {
    queue([{ result: data }])

    await expect(invoke()).resolves.toBeNull()
  })

  it('filters account/client/report on report and version lists', async () => {
    queue([], [])

    await listClientReports({ accountId: 'account-1', clientId: 'client-1' })
    await listClientReportVersions({ accountId: 'account-1', clientId: 'client-1', reportId: 'report-1' })

    const reportsQuery = callsContaining('from client_reports')[0]
    expect(reportsQuery?.values).toEqual(expect.arrayContaining(['account-1', 'client-1']))
    const versionsQuery = callsContaining('from client_report_versions')[0]
    expect(versionsQuery?.values).toEqual(expect.arrayContaining(['account-1', 'client-1', 'report-1']))
  })

  it('casts the bigint view/click counters to numbers', async () => {
    queue([{ ...validReportRow, view_count: 4, cta_click_count: 1 }])

    const result = await loadOwnedClientReportById({ accountId: 'account-1', reportId: 'report-1' })

    expect(result).toMatchObject({ view_count: 4, cta_click_count: 1 })
    expect(lastCall()?.text).toContain('view_count::int')
    expect(lastCall()?.text).toContain('cta_click_count::int')
  })

  it('discovers an owned report tuple with account and report filters before downstream full-tuple checks', async () => {
    queue([{ ...validReportRow, id: 'report-1', account_id: 'account-1', client_id: 'client-1', status: 'draft' }])

    await expect(loadOwnedClientReportById({ accountId: 'account-1', reportId: 'report-1' }))
      .resolves.toMatchObject({ id: 'report-1', account_id: 'account-1', client_id: 'client-1' })
    expect(lastCall()?.values).toEqual(expect.arrayContaining(['account-1', 'report-1']))
  })

  it('resolves public data through service reads with slug/version/status and full version tenant filters', async () => {
    queue(
      [{ ...validReportRow, id: 'report-1', account_id: 'account-1', client_id: 'client-1', status: 'published', public_slug: 'slug', share_version: 3, published_version_id: 'version-2' }],
      [{ id: 'version-2', report_id: 'report-1', account_id: 'account-1', client_id: 'client-1', snapshot: { locale: 'en' }, created_at: '2026-07-21T08:00:00.000Z' }],
      [{ id: 'account-1', plan: 'pro', status: 'active', stripe_subscription_id: 'sub_1', trial_ends_at: null, override_plan: null, override_expires_at: null }],
    )

    const result = await resolvePublicClientReport({ publicSlug: 'slug', shareVersion: 3 })

    expect(result).toMatchObject({ report: { id: 'report-1' }, version: { id: 'version-2' }, account: { id: 'account-1', plan: 'pro' } })
    const reportQuery = callsContaining('from client_reports')[0]
    expect(reportQuery?.values).toEqual(expect.arrayContaining(['slug', 3]))
    expect(reportQuery?.text).toContain("status = 'published'")
    const versionQuery = callsContaining('from client_report_versions')[0]
    expect(versionQuery?.values).toEqual(expect.arrayContaining(['report-1', 'account-1', 'client-1']))
    const accountQuery = callsContaining('from accounts')[0]
    expect(accountQuery?.text).toContain('override_plan')
    expect(accountQuery?.text).toContain('override_expires_at')
    expect(accountQuery?.values).toContain('account-1')
  })

  it('returns null (not an error) when no published report matches the slug/version — revoked and never-existed are indistinguishable', async () => {
    queue([])

    await expect(resolvePublicClientReport({ publicSlug: 'gone', shareVersion: 1 })).resolves.toBeNull()
  })

  it('logs one coarse reason without leaking the slug when the view-counter RPC throws', async () => {
    const publicSlug = 'a'.repeat(32)
    queue(new Error(`${publicSlug} signature-secret https://agency.example/contact snapshot-1 account-1 report-1`))
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      await expect(incrementClientReportView({ publicSlug, shareVersion: 3 })).resolves.toBeUndefined()

      expect(warning).toHaveBeenCalledOnce()
      expect(warning).toHaveBeenCalledWith('[public-report] counter update failed', { reason: 'query' })
    } finally {
      warning.mockRestore()
    }
  })

  it('logs one coarse reason without leaking the slug when the CTA-counter RPC throws', async () => {
    const publicSlug = 'b'.repeat(32)
    queue(new Error(`${publicSlug} signature-secret https://agency.example/contact snapshot-2 account-2 report-2`))
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      await expect(incrementClientReportCtaClick({ publicSlug, shareVersion: 4 })).resolves.toBeUndefined()

      expect(warning).toHaveBeenCalledOnce()
      expect(warning).toHaveBeenCalledWith('[public-report] counter update failed', { reason: 'query' })
    } finally {
      warning.mockRestore()
    }
  })

  it('never returns a success shape when a direct read throws', async () => {
    queue(new Error('connection terminated'))

    await expect(loadOwnedReportClient({ accountId: 'account-1', clientId: 'client-1' }))
      .rejects.toMatchObject({ name: 'ReportStoreError', message: 'connection terminated' })
  })
})
