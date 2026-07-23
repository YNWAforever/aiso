import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

type Call = { table?: string; method: string; args: unknown[] }
type Response = { data: unknown; error: { message: string; code?: string } | null }

const state = vi.hoisted(() => ({
  calls: [] as Call[],
  responses: new Map<string, Response>(),
}))

class Query implements PromiseLike<Response> {
  constructor(private readonly table: string) {}

  private call(method: string, ...args: unknown[]) {
    state.calls.push({ table: this.table, method, args })
    return this
  }

  select(...args: unknown[]) { return this.call('select', ...args) }
  eq(...args: unknown[]) { return this.call('eq', ...args) }
  in(...args: unknown[]) { return this.call('in', ...args) }
  lt(...args: unknown[]) { return this.call('lt', ...args) }
  order(...args: unknown[]) { return this.call('order', ...args) }
  limit(...args: unknown[]) { return this.call('limit', ...args) }
  insert(...args: unknown[]) { return this.call('insert', ...args) }
  upsert(...args: unknown[]) { return this.call('upsert', ...args) }

  single() {
    this.call('single')
    return Promise.resolve(state.responses.get(this.table) ?? { data: null, error: null })
  }

  maybeSingle() {
    this.call('maybeSingle')
    return Promise.resolve(state.responses.get(this.table) ?? { data: null, error: null })
  }

  then<TResult1 = Response, TResult2 = never>(
    onfulfilled?: ((value: Response) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(state.responses.get(this.table) ?? { data: [], error: null }).then(onfulfilled, onrejected)
  }
}

const rpc = vi.hoisted(() => vi.fn(async (name: string, args: unknown) => {
  state.calls.push({ method: `rpc:${name}`, args: [args] })
  return state.responses.get(`rpc:${name}`) ?? { data: null, error: null }
}))

const from = vi.hoisted(() => vi.fn((table: string) => {
  state.calls.push({ table, method: 'from', args: [] })
  return new Query(table)
}))

const createServiceSupabaseClient = vi.hoisted(() => vi.fn(async () => ({ from, rpc })))

vi.mock('@/lib/supabase-server', () => ({ createServiceSupabaseClient }))

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

function callsFor(table: string, method: string) {
  return state.calls.filter(call => call.table === table && call.method === method)
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
    state.responses.clear()
    from.mockClear()
    rpc.mockClear()
    createServiceSupabaseClient.mockClear()
  })

  it('loads an owned client with account and client filters through the service client', async () => {
    state.responses.set('clients', { data: { id: 'client-1', account_id: 'account-1', brand_name: 'Example', domain: 'example.com' }, error: null })

    const result = await loadOwnedReportClient({ accountId: 'account-1', clientId: 'client-1' })

    expect(createServiceSupabaseClient).toHaveBeenCalledOnce()
    expect(result).toEqual({ id: 'client-1', accountId: 'account-1', name: 'Example', domain: 'example.com' })
    expect(callsFor('clients', 'eq')).toEqual(expect.arrayContaining([
      expect.objectContaining({ args: ['account_id', 'account-1'] }),
      expect.objectContaining({ args: ['id', 'client-1'] }),
    ]))
  })

  it('rejects a current scan whose normalized domain does not match the owned client domain', async () => {
    state.responses.set('scans', { data: { id: 'scan-1', account_id: 'account-1', domain: 'other.example', created_at: currentScan.createdAt, score: 80, grade: 'A', results: {} }, error: null })

    const result = await loadOwnedReportScan({ accountId: 'account-1', scanId: 'scan-1', clientDomain: 'https://www.example.com/' })

    expect(result).toBeNull()
    expect(callsFor('scans', 'eq')).toEqual(expect.arrayContaining([
      expect.objectContaining({ args: ['account_id', 'account-1'] }),
      expect.objectContaining({ args: ['id', 'scan-1'] }),
    ]))
  })

  it('preserves the exact current scan id after strict account and domain checks', async () => {
    state.responses.set('scans', { data: { id: 'scan-current', account_id: 'account-1', domain: 'www.example.com', created_at: currentScan.createdAt, score: 80, grade: 'A', results: {} }, error: null })

    const result = await loadOwnedReportScan({ accountId: 'account-1', scanId: 'scan-current', clientDomain: 'example.com' })

    expect(result).toMatchObject({ id: 'scan-current', accountId: 'account-1', domain: 'www.example.com' })
  })

  it('queries stored hostname variants and returns the exact nearest eligible previous scan id', async () => {
    state.responses.set('scans', { data: [
      { id: 'older-www', account_id: 'account-1', domain: 'www.example.com', created_at: '2026-07-19T08:00:00.000Z', score: 70, grade: 'B', results: {} },
      { id: 'nearest-www', account_id: 'account-1', domain: 'www.example.com', created_at: '2026-07-20T08:00:00.000Z', score: 75, grade: 'B', results: {} },
    ], error: null })

    const result = await loadPreviousReportScan({ accountId: 'account-1', currentScan })
    const appendInput = { previousScanId: result?.id ?? null }

    expect(result).toMatchObject({ id: 'nearest-www', createdAt: '2026-07-20T08:00:00.000Z' })
    expect(appendInput.previousScanId).toBe('nearest-www')
    expect(callsFor('scans', 'eq')).toContainEqual(expect.objectContaining({ args: ['account_id', 'account-1'] }))
    expect(callsFor('scans', 'eq')).not.toContainEqual(expect.objectContaining({ args: ['domain', 'example.com'] }))
    expect(callsFor('scans', 'in')).toContainEqual(expect.objectContaining({ args: ['domain', ['example.com', 'www.example.com']] }))
    expect(callsFor('scans', 'lt')).toContainEqual(expect.objectContaining({ args: ['created_at', currentScan.createdAt] }))
    expect(callsFor('scans', 'order')).toContainEqual(expect.objectContaining({ args: ['created_at', { ascending: false }] }))
  })

  it('authorizes recommendation loading by the scan account and domain before reading children', async () => {
    state.responses.set('scans', { data: { id: 'scan-1', account_id: 'account-1', domain: 'example.com', created_at: currentScan.createdAt, score: 80, grade: 'A', results: {} }, error: null })
    state.responses.set('agent_recommendations', { data: [{ id: 'rec-1', category: 'robots', priority: 'high', recommendation: 'Fix robots', impact_score: 10 }], error: null })

    const result = await loadReportRecommendations({ accountId: 'account-1', scanId: 'scan-1', clientDomain: 'example.com' })

    expect(result).toHaveLength(1)
    expect(callsFor('agent_recommendations', 'eq')).toContainEqual(expect.objectContaining({ args: ['scan_id', 'scan-1'] }))
  })

  it('does not query recommendations when the scan tenant/domain check fails', async () => {
    state.responses.set('scans', { data: { id: 'scan-1', account_id: 'account-1', domain: 'wrong.example', created_at: currentScan.createdAt, score: 80, grade: 'A', results: {} }, error: null })

    await expect(loadReportRecommendations({ accountId: 'account-1', scanId: 'scan-1', clientDomain: 'example.com' })).resolves.toEqual([])
    expect(from).not.toHaveBeenCalledWith('agent_recommendations')
  })

  it('loads and upserts branding only for the supplied account', async () => {
    state.responses.set('account_report_branding', { data: { account_id: 'account-1', agency_name: 'Agency', logo_url: null, primary_color: '#123ABC', contact_label: null, contact_url: null }, error: null })

    await loadReportBranding({ accountId: 'account-1' })
    await upsertReportBranding({ accountId: 'account-1', updatedBy: 'profile-1', branding: { agencyName: 'Agency', logoUrl: null, primaryColor: '#123ABC', contactLabel: null, contactUrl: null } })

    expect(callsFor('account_report_branding', 'eq')).toContainEqual(expect.objectContaining({ args: ['account_id', 'account-1'] }))
    expect(callsFor('account_report_branding', 'upsert')[0]?.args[0]).toMatchObject({ account_id: 'account-1', updated_by: 'profile-1' })
  })

  it('rejects an upsert response for another account instead of synthesizing the requested account id', async () => {
    state.responses.set('account_report_branding', {
      data: { account_id: 'account-2', agency_name: 'Other Agency', logo_url: null, primary_color: '#123ABC', contact_label: null, contact_url: null },
      error: null,
    })

    await expect(upsertReportBranding({
      accountId: 'account-1',
      updatedBy: 'profile-1',
      branding: { agencyName: 'Agency', logoUrl: null, primaryColor: '#123ABC', contactLabel: null, contactUrl: null },
    })).resolves.toBeNull()
  })
  it('passes full tenant tuples to create, append, publish, revoke, and rotate RPCs', async () => {
    const version = {
      accountId: 'account-1', clientId: 'client-1', sourceScanId: 'scan-1', previousScanId: null,
      locale: 'en' as const, executiveSummary: 'Summary', snapshotSchemaVersion: 1 as const,
      snapshot: { snapshotSchemaVersion: 1 }, createdBy: 'profile-1',
    }

    await createClientReport(version)
    await appendClientReportVersion({ ...version, reportId: 'report-1' })
    await publishClientReportLatest({ accountId: 'account-1', clientId: 'client-1', reportId: 'report-1' })
    await revokeClientReport({ accountId: 'account-1', clientId: 'client-1', reportId: 'report-1' })
    await rotateClientReportLink({ accountId: 'account-1', clientId: 'client-1', reportId: 'report-1' })

    for (const name of ['create_client_report_with_version', 'append_client_report_version', 'publish_client_report_latest', 'revoke_client_report', 'rotate_client_report_link']) {
      const call = state.calls.find(candidate => candidate.method === `rpc:${name}`)
      expect(call?.args[0]).toMatchObject({ p_account_id: 'account-1', p_client_id: 'client-1' })
    }
    expect(state.calls.find(call => call.method === 'rpc:append_client_report_version')?.args[0]).toMatchObject({ p_report_id: 'report-1' })
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
    state.responses.set('rpc:create_client_report_with_version', { data: { report: createReport, version: validVersionRow }, error: null })
    state.responses.set('rpc:append_client_report_version', {
      data: { report: validReportRow, version: appendedVersion, published_version: validVersionRow }, error: null,
    })
    state.responses.set('rpc:publish_client_report_latest', {
      data: { report: publishedReport, published_version: appendedVersion }, error: null,
    })
    state.responses.set('rpc:revoke_client_report', { data: { report: revokedReport }, error: null })
    state.responses.set('rpc:rotate_client_report_link', {
      data: { report: rotatedReport, published_version: validVersionRow }, error: null,
    })
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
    })
    await expect(publishClientReportLatest(tuple)).resolves.toEqual({ report: publishedReport, publishedVersion: appendedVersion })
    await expect(revokeClientReport(tuple)).resolves.toEqual({ report: revokedReport })
    await expect(rotateClientReportLink(tuple)).resolves.toEqual({ report: rotatedReport, publishedVersion: validVersionRow })
  })

  it.each([
    ['create account mismatch', 'create_client_report_with_version', () => createClientReport({
      accountId: 'account-1', clientId: 'client-1', sourceScanId: 'scan-1', previousScanId: null,
      locale: 'en', executiveSummary: 'Summary', snapshotSchemaVersion: 1,
      snapshot: { snapshotSchemaVersion: 1 } as never, createdBy: 'profile-1',
    }), { report: { ...validReportRow, status: 'draft', account_id: 'account-2', latest_version_id: 'version-1', published_version_id: null, published_at: null }, version: validVersionRow }],
    ['append version tuple mismatch', 'append_client_report_version', () => appendClientReportVersion({
      reportId: 'report-1', accountId: 'account-1', clientId: 'client-1', sourceScanId: 'scan-1', previousScanId: null,
      locale: 'en', executiveSummary: 'Summary', snapshotSchemaVersion: 1,
      snapshot: { snapshotSchemaVersion: 1 } as never, createdBy: 'profile-1',
    }), { report: validReportRow, version: { ...validVersionRow, id: 'version-2', version_number: 2, client_id: 'client-2' }, published_version: validVersionRow }],
    ['append published pointer mismatch', 'append_client_report_version', () => appendClientReportVersion({
      reportId: 'report-1', accountId: 'account-1', clientId: 'client-1', sourceScanId: 'scan-1', previousScanId: null,
      locale: 'en', executiveSummary: 'Summary', snapshotSchemaVersion: 1,
      snapshot: { snapshotSchemaVersion: 1 } as never, createdBy: 'profile-1',
    }), { report: validReportRow, version: { ...validVersionRow, id: 'version-2', version_number: 2 }, published_version: { ...validVersionRow, id: 'version-other' } }],
    ['append draft publication state', 'append_client_report_version', () => appendClientReportVersion({
      reportId: 'report-1', accountId: 'account-1', clientId: 'client-1', sourceScanId: 'scan-1', previousScanId: null,
      locale: 'en', executiveSummary: 'Summary', snapshotSchemaVersion: 1,
      snapshot: { snapshotSchemaVersion: 1 } as never, createdBy: 'profile-1',
    }), { report: { ...validReportRow, status: 'draft' }, version: { ...validVersionRow, id: 'version-2', version_number: 2 }, published_version: validVersionRow }],
    ['publish invalid locale', 'publish_client_report_latest', () => publishClientReportLatest({ accountId: 'account-1', clientId: 'client-1', reportId: 'report-1' }), { report: { ...validReportRow, published_version_id: 'version-2' }, published_version: { ...validVersionRow, id: 'version-2', version_number: 2, locale: 'fr' } }],
    ['revoke malformed slug', 'revoke_client_report', () => revokeClientReport({ accountId: 'account-1', clientId: 'client-1', reportId: 'report-1' }), { report: { ...validReportRow, status: 'revoked', public_slug: 'short', revoked_at: '2026-07-21T10:00:00.000Z' } }],
    ['rotate non-published report', 'rotate_client_report_link', () => rotateClientReportLink({ accountId: 'account-1', clientId: 'client-1', reportId: 'report-1' }), { report: { ...validReportRow, status: 'revoked', revoked_at: '2026-07-21T10:00:00.000Z' }, published_version: validVersionRow }],
  ] as const)('fails closed for an unauthorized or malformed RPC result: %s', async (_label, rpcName, invoke, data) => {
    state.responses.set(`rpc:${rpcName}`, { data, error: null })

    await expect(invoke()).resolves.toBeNull()
  })
  it('filters account/client/report on report and version lists', async () => {
    state.responses.set('client_reports', { data: [], error: null })
    state.responses.set('client_report_versions', { data: [], error: null })

    await listClientReports({ accountId: 'account-1', clientId: 'client-1' })
    await listClientReportVersions({ accountId: 'account-1', clientId: 'client-1', reportId: 'report-1' })

    expect(callsFor('client_reports', 'eq')).toEqual(expect.arrayContaining([
      expect.objectContaining({ args: ['account_id', 'account-1'] }),
      expect.objectContaining({ args: ['client_id', 'client-1'] }),
    ]))
    expect(callsFor('client_report_versions', 'eq')).toEqual(expect.arrayContaining([
      expect.objectContaining({ args: ['account_id', 'account-1'] }),
      expect.objectContaining({ args: ['client_id', 'client-1'] }),
      expect.objectContaining({ args: ['report_id', 'report-1'] }),
    ]))
  })

  it('discovers an owned report tuple with account and report filters before downstream full-tuple checks', async () => {
    state.responses.set('client_reports', { data: {
      id: 'report-1', account_id: 'account-1', client_id: 'client-1', status: 'draft',
    }, error: null })

    await expect(loadOwnedClientReportById({ accountId: 'account-1', reportId: 'report-1' }))
      .resolves.toMatchObject({ id: 'report-1', account_id: 'account-1', client_id: 'client-1' })
    expect(callsFor('client_reports', 'eq')).toEqual(expect.arrayContaining([
      expect.objectContaining({ args: ['account_id', 'account-1'] }),
      expect.objectContaining({ args: ['id', 'report-1'] }),
    ]))
  })

  it('resolves public data through service reads with slug/version/status and full version tenant filters', async () => {
    state.responses.set('client_reports', { data: { id: 'report-1', account_id: 'account-1', client_id: 'client-1', status: 'published', public_slug: 'slug', share_version: 3, published_version_id: 'version-2', published_at: '2026-07-21T09:00:00.000Z' }, error: null })
    state.responses.set('client_report_versions', { data: { id: 'version-2', report_id: 'report-1', account_id: 'account-1', client_id: 'client-1', snapshot: { locale: 'en' } }, error: null })
    state.responses.set('accounts', { data: { id: 'account-1', plan: 'pro', status: 'active', stripe_subscription_id: 'sub_1', trial_ends_at: null }, error: null })

    const result = await resolvePublicClientReport({ publicSlug: 'slug', shareVersion: 3 })

    expect(result).toMatchObject({ report: { id: 'report-1' }, version: { id: 'version-2' }, account: { id: 'account-1', plan: 'pro' } })
    expect(callsFor('client_reports', 'eq')).toEqual(expect.arrayContaining([
      expect.objectContaining({ args: ['public_slug', 'slug'] }),
      expect.objectContaining({ args: ['share_version', 3] }),
      expect.objectContaining({ args: ['status', 'published'] }),
    ]))
    expect(callsFor('client_report_versions', 'eq')).toEqual(expect.arrayContaining([
      expect.objectContaining({ args: ['report_id', 'report-1'] }),
      expect.objectContaining({ args: ['account_id', 'account-1'] }),
      expect.objectContaining({ args: ['client_id', 'client-1'] }),
    ]))
    expect(callsFor('accounts', 'eq')).toContainEqual(expect.objectContaining({ args: ['id', 'account-1'] }))
  })

  it('increments public counters best-effort without surfacing RPC failures', async () => {
    state.responses.set('rpc:increment_client_report_view', { data: null, error: { message: 'temporary failure' } })
    state.responses.set('rpc:increment_client_report_cta_click', { data: null, error: { message: 'temporary failure' } })

    await expect(incrementClientReportView({ publicSlug: 'slug', shareVersion: 3 })).resolves.toBeUndefined()
    await expect(incrementClientReportCtaClick({ publicSlug: 'slug', shareVersion: 3 })).resolves.toBeUndefined()
  })
})
