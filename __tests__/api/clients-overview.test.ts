import { describe, it, expect, vi, beforeEach } from 'vitest'

const queries: string[] = []
const bindings: unknown[][] = []
let nextResults: unknown[][] = []

const mockSql = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  bindings.push(values)
  queries.push(strings.join('?'))
  const result = nextResults.shift()
  if (result instanceof Error) throw result
  return Promise.resolve(result ?? [])
})

vi.mock('server-only', () => ({}))
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
    bindings.length = 0
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

  it('redacts paid agent fields for a cancelled account before querying them', async () => {
    vi.mocked(getProfile).mockResolvedValue({ ...PROFILE, accounts: { plan: 'enterprise', status: 'cancelled' } } as never)
    nextResults = [[{ brand_name: 'Acme' }], [{ id: 'scan-a', results: {}, score: 30, created_at: '2026-09-01' }], [], [], []]
    const res = await GET(request(), ctx())
    expect(res.status).toBe(200)
    const dto = await res.json()
    expect(dto.recommendations).toEqual([])
    expect(dto.progress).toEqual([])
    expect(dto.competitors).toEqual([])
    expect(queries.some(q => /from agent_/.test(q))).toBe(false)
    expect(bindings[0]).toEqual(['client-1', 'acc-1'])
  })

  it('binds recommendation query ownership and platform allow-list for Basic', async () => {
    vi.mocked(getProfile).mockResolvedValue({ ...PROFILE, accounts: { plan: 'basic', status: 'active', stripe_subscription_id: 'sub' } } as never)
    nextResults = [[{ brand_name: 'Acme' }], [{ id: 'scan-a', results: {}, score: 30, created_at: '2026-09-01' }], [], [], [], [{ platform: 'gemini' }, { platform: 'gpt4o', recommendation: 'FORBIDDEN' }]]
    const res = await GET(request(), ctx())
    const dto = await res.json()
    expect(dto.recommendations).toEqual([{ platform: 'gemini' }])
    expect(JSON.stringify(dto)).not.toContain('FORBIDDEN')
    const index = queries.findIndex(q => q.includes('from agent_recommendations'))
    expect(bindings[index]).toEqual(['scan-a', 'client-1', 'acc-1', ['gemini']])
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
