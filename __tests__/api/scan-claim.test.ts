import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

type ScanRow = { id: string; account_id: string | null }
type QueryResult = { data: ScanRow | null; error: { message: string } | null }

const getProfileMock = vi.hoisted(() => vi.fn())
const supabaseMock = vi.hoisted(() => ({ from: vi.fn() }))

vi.mock('@/lib/auth', () => ({ getProfile: getProfileMock }))
vi.mock('@/lib/supabase', () => ({ supabase: supabaseMock }))

let scanResults: QueryResult[]
let updates: Array<Record<string, unknown>>
let eqGuards: Array<[string, unknown]>
let nullGuards: Array<[string, unknown]>

function scansQuery() {
  const query: Record<string, unknown> = {}
  query.select = vi.fn(() => query)
  query.update = vi.fn((value: Record<string, unknown>) => {
    updates.push(value)
    return query
  })
  query.eq = vi.fn((column: string, value: unknown) => {
    eqGuards.push([column, value])
    return query
  })
  query.is = vi.fn((column: string, value: unknown) => {
    nullGuards.push([column, value])
    return query
  })
  query.single = vi.fn(async () => scanResults.shift() ?? { data: null, error: null })
  query.maybeSingle = vi.fn(async () => scanResults.shift() ?? { data: null, error: null })
  return query
}

async function claim(scanId = 'scan-1') {
  const { POST } = await import('@/app/api/scans/[id]/claim/route')
  return POST(new NextRequest(`http://localhost/api/scans/${scanId}/claim`, { method: 'POST' }), {
    params: Promise.resolve({ id: scanId }),
  })
}

describe('POST /api/scans/[id]/claim', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getProfileMock.mockResolvedValue({ account_id: 'account-1' })
    scanResults = []
    updates = []
    eqGuards = []
    nullGuards = []
    supabaseMock.from.mockImplementation((table: string) => {
      expect(table).toBe('scans')
      return scansQuery()
    })
  })

  it('returns 401 when no profile exists', async () => {
    getProfileMock.mockResolvedValue(null)

    const response = await claim()

    expect(response.status).toBe(401)
    expect(supabaseMock.from).not.toHaveBeenCalled()
  })

  it('claims an unowned scan for the authenticated account', async () => {
    scanResults = [
      { data: { id: 'scan-1', account_id: null }, error: null },
      { data: { id: 'scan-1', account_id: 'account-1' }, error: null },
    ]

    const response = await claim()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, alreadyOwned: false })
    expect(updates).toContainEqual({ account_id: 'account-1' })
    expect(eqGuards).toContainEqual(['id', 'scan-1'])
    expect(nullGuards).toContainEqual(['account_id', null])
  })

  it('returns ok when the scan already belongs to the same account', async () => {
    scanResults = [{ data: { id: 'scan-1', account_id: 'account-1' }, error: null }]

    const response = await claim()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, alreadyOwned: true })
    expect(updates).toEqual([])
  })

  it('returns 409 when the scan belongs to another account', async () => {
    scanResults = [{ data: { id: 'scan-1', account_id: 'account-2' }, error: null }]

    const response = await claim()

    expect(response.status).toBe(409)
    expect(updates).toEqual([])
  })

  it('returns 404 when the scan does not exist', async () => {
    scanResults = [{ data: null, error: null }]

    const response = await claim()

    expect(response.status).toBe(404)
    expect(updates).toEqual([])
  })

  it('re-reads after a lost claim race and returns same-owner success', async () => {
    scanResults = [
      { data: { id: 'scan-1', account_id: null }, error: null },
      { data: null, error: null },
      { data: { id: 'scan-1', account_id: 'account-1' }, error: null },
    ]

    const response = await claim()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, alreadyOwned: true })
    expect(updates).toHaveLength(1)
  })

  it('re-reads after a lost claim race and returns a deterministic conflict', async () => {
    scanResults = [
      { data: { id: 'scan-1', account_id: null }, error: null },
      { data: null, error: null },
      { data: { id: 'scan-1', account_id: 'account-2' }, error: null },
    ]

    const response = await claim()

    expect(response.status).toBe(409)
    expect(updates).toHaveLength(1)
  })
})
