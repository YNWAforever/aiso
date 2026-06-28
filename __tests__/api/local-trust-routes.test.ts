import { beforeEach, describe, expect, it, vi } from 'vitest'

type TableResult = { data: unknown; error?: { message: string } | null }
type QueryCall = {
  table: string
  operation?: string
  payload?: unknown
  options?: unknown
  filters: Array<[string, unknown]>
}

const { mockGetProfile, mockFrom, tableResults, queryCalls } = vi.hoisted(() => ({
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

import { PUT as PUT_PROFILE } from '@/app/api/dashboard/clients/[clientId]/local-trust/profile/route'
import { PATCH as PATCH_ACTION } from '@/app/api/dashboard/clients/[clientId]/local-trust/actions/[actionId]/route'

function setTable(table: string, data: unknown, error: { message: string } | null = null) {
  tableResults.set(table, { data, error })
}

function jsonRequest(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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
      accounts: { plan: 'pro' },
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
    mockGetProfile.mockResolvedValue({ account_id: 'account-1', accounts: { plan: 'basic' } })

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
})

describe('Local Trust action route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tableResults.clear()
    queryCalls.length = 0
    mockFrom.mockImplementation((table: string) => new QueryBuilder(table))
    mockGetProfile.mockResolvedValue({
      account_id: 'account-1',
      accounts: { plan: 'pro' },
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
})
