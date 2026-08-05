import { describe, it, expect, vi, beforeEach } from 'vitest'

const queries: string[] = []
const params: unknown[][] = []
let nextResults: unknown[] = []

const mockSql = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  queries.push(strings.join('?'))
  params.push(values)
  const result = nextResults.shift()
  if (result instanceof Error) throw result
  return Promise.resolve(result ?? [])
})

vi.mock('@/lib/db', () => ({ db: () => mockSql }))
vi.mock('@/lib/auth', () => ({ getProfile: vi.fn() }))

import { GET, PUT } from '@/app/api/dashboard/clients/[clientId]/alerts/route'
import { getProfile } from '@/lib/auth'

function account(plan: string) {
  return {
    account_id: 'acc-1',
    accounts: { plan, status: 'active', stripe_subscription_id: 'sub_1' },
  }
}

const get = () => GET(new Request('http://localhost'), { params: Promise.resolve({ clientId: 'client-1' }) })
const put = (body: unknown = {}) => PUT(
  new Request('http://localhost', { method: 'PUT', body: JSON.stringify(body) }),
  { params: Promise.resolve({ clientId: 'client-1' }) },
)

const OWNED = [{ id: 'client-1' }]

beforeEach(() => {
  queries.length = 0
  params.length = 0
  nextResults = []
  vi.mocked(getProfile).mockReset()
})

describe('GET /api/dashboard/clients/[clientId]/alerts', () => {
  it('returns 401 without touching the database', async () => {
    vi.mocked(getProfile).mockResolvedValue(null)

    expect((await get()).status).toBe(401)
    expect(queries).toHaveLength(0)
  })

  it('returns 404 for a brand on another account', async () => {
    vi.mocked(getProfile).mockResolvedValue(account('pro') as never)
    nextResults = [[]]

    expect((await get()).status).toBe(404)
  })

  it('scopes the ownership check by both id and account_id', async () => {
    vi.mocked(getProfile).mockResolvedValue(account('pro') as never)
    nextResults = [OWNED, []]

    await get()

    expect(queries[0]).toContain('from clients')
    expect(queries[0]).toContain('account_id')
    expect(params[0]).toEqual(['client-1', 'acc-1'])
  })

  it('falls back to defaults when no config row exists yet', async () => {
    vi.mocked(getProfile).mockResolvedValue(account('pro') as never)
    nextResults = [OWNED, []]

    const body = await (await get()).json()

    expect(body.config).toMatchObject({ enabled_sov: false, sov_threshold: 50, client_id: 'client-1' })
  })

  it('reads without an entitlement gate, so a Basic owner still renders the tab', async () => {
    // The paid capability is configuring alerts, not seeing your own settings.
    vi.mocked(getProfile).mockResolvedValue(account('basic') as never)
    nextResults = [OWNED, []]

    expect((await get()).status).toBe(200)
  })

  it('returns 503 rather than a misleading 404 when the lookup throws', async () => {
    vi.mocked(getProfile).mockResolvedValue(account('pro') as never)
    nextResults = [new Error('connection terminated')]

    expect((await get()).status).toBe(503)
  })
})

describe('PUT /api/dashboard/clients/[clientId]/alerts', () => {
  it('returns 401 without touching the database', async () => {
    vi.mocked(getProfile).mockResolvedValue(null)

    expect((await put()).status).toBe(401)
    expect(queries).toHaveLength(0)
  })

  it.each(['free', 'basic'])('returns 403 for %s and never reaches the ownership query', async (plan) => {
    vi.mocked(getProfile).mockResolvedValue(account(plan) as never)

    const res = await put({ enabled_sov: true })

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({ error: 'UPGRADE_REQUIRED', feature: 'alerts' })
    expect(queries).toHaveLength(0)
  })

  it('returns 404 for a brand on another account, without writing', async () => {
    vi.mocked(getProfile).mockResolvedValue(account('pro') as never)
    nextResults = [[]]

    expect((await put({ enabled_sov: true })).status).toBe(404)
    expect(queries.some(q => q.includes('insert into alert_configs'))).toBe(false)
  })

  it('rejects a malformed body before writing', async () => {
    vi.mocked(getProfile).mockResolvedValue(account('pro') as never)
    const res = await PUT(
      new Request('http://localhost', { method: 'PUT', body: '{' }),
      { params: Promise.resolve({ clientId: 'client-1' }) },
    )

    expect(res.status).toBe(400)
    expect(queries).toHaveLength(0)
  })

  it('upserts on the client_id constraint rather than read-then-write', async () => {
    vi.mocked(getProfile).mockResolvedValue(account('pro') as never)
    nextResults = [OWNED, [{ client_id: 'client-1', enabled_sov: true }]]

    const res = await put({ enabled_sov: true, sov_threshold: 60 })

    expect(res.status).toBe(200)
    const write = queries.find(q => q.includes('insert into alert_configs'))!
    expect(write).toContain('on conflict (client_id) do update')
  })

  it('clamps out-of-range thresholds instead of overflowing the integer column', async () => {
    vi.mocked(getProfile).mockResolvedValue(account('pro') as never)
    nextResults = [OWNED, [{ client_id: 'client-1' }]]

    await put({ sov_threshold: 10_000_000_000, wow_threshold: -5 })

    const writeParams = params[params.length - 1]
    expect(writeParams).toContain(100)
    expect(writeParams).toContain(0)
  })

  it('returns 500, never a 2xx, when the write throws', async () => {
    vi.mocked(getProfile).mockResolvedValue(account('pro') as never)
    nextResults = [OWNED, new Error('connection terminated')]

    expect((await put({ enabled_sov: true })).status).toBe(500)
  })

  it('never writes a caller-supplied client_id', async () => {
    vi.mocked(getProfile).mockResolvedValue(account('pro') as never)
    nextResults = [OWNED, [{ client_id: 'client-1' }]]

    await put({ client_id: 'someone-elses-brand', enabled_sov: true })

    expect(params[params.length - 1]).toContain('client-1')
    expect(params[params.length - 1]).not.toContain('someone-elses-brand')
  })
})

// Guards the scope boundary: the evaluator is deliberately still fenced, because
// nothing writes the aggregate pulse rows it reads and there is no scheduler.
describe('the alert evaluator stays fenced', () => {
  it('cron/evaluate-alerts still returns 503', async () => {
    const mod = await import('@/app/api/cron/evaluate-alerts/route')
    const res = await mod.POST()

    expect(res.status).toBe(503)
  })
})
