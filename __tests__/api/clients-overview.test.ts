import { describe, it, expect, vi, beforeEach } from 'vitest'

const queries: string[] = []
let nextResults: unknown[][] = []

const mockSql = vi.fn((strings: TemplateStringsArray) => {
  queries.push(strings.join('?'))
  const result = nextResults.shift()
  if (result instanceof Error) throw result
  return Promise.resolve(result ?? [])
})

vi.mock('@/lib/db', () => ({ db: () => mockSql }))
vi.mock('@/lib/auth', () => ({ getProfile: vi.fn() }))

import { GET } from '@/app/api/clients/[clientId]/overview/route'
import { getProfile } from '@/lib/auth'

const PROFILE = { account_id: 'acc-1' }

function request() {
  return new Request('http://localhost/api/clients/client-1/overview') as never
}

function ctx(clientId = 'client-1') {
  return { params: Promise.resolve({ clientId }) }
}

describe('GET /api/clients/[clientId]/overview', () => {
  beforeEach(() => {
    queries.length = 0
    nextResults = []
    vi.mocked(getProfile).mockReset()
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getProfile).mockResolvedValue(null)
    const res = await GET(request(), ctx())
    expect(res.status).toBe(401)
    expect(queries).toHaveLength(0)
  })

  it('returns 404 when the client is not owned by the caller account', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    nextResults = [[]]
    const res = await GET(request(), ctx())
    expect(res.status).toBe(404)
  })

  it('scopes every scan query by client_id and account_id, not account_id alone', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    nextResults = [
      [{ brand_name: 'Acme' }],
      [], // latestScan
      [], // scanHistory
      [], // pulseSummary
      [], // pulseMetrics
    ]
    const res = await GET(request(), ctx())
    expect(res.status).toBe(200)

    const scanQueries = queries.filter(q => q.includes('from scans'))
    expect(scanQueries.length).toBeGreaterThanOrEqual(2)
    for (const q of scanQueries) {
      expect(q).toContain('client_id')
      expect(q).toContain('account_id')
    }
  })

  it('returns 500 instead of an empty 200 when a query fails', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    nextResults = [new Error('connection terminated') as never]
    const res = await GET(request(), ctx())
    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({ error: 'Failed to load overview' })
  })

  it('returns 500 when a later parallel query fails after the client is found', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    nextResults = [
      [{ brand_name: 'Acme' }],
      new Error('connection terminated') as never,
    ]
    const res = await GET(request(), ctx())
    expect(res.status).toBe(500)
  })
})
