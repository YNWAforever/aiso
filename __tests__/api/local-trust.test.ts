import { describe, it, expect, vi, beforeEach } from 'vitest'

const queries: string[] = []
let nextResults: unknown[] = []

const mockSql = vi.fn((strings: TemplateStringsArray) => {
  queries.push(strings.join('?'))
  const result = nextResults.shift()
  if (result instanceof Error) throw result
  return Promise.resolve(result ?? [])
})

vi.mock('@/lib/db', () => ({ db: () => mockSql }))
vi.mock('@/lib/auth', () => ({ getProfile: vi.fn() }))

const storeMocks = vi.hoisted(() => ({
  verifyClientOwnership: vi.fn(),
  upsertLocalTrustProfile: vi.fn(),
  updateLocalTrustActionStatus: vi.fn(),
  getLocalTrustProfile: vi.fn(),
  getOrCreateLocalTrustSnapshot: vi.fn(),
}))
vi.mock('@/lib/localTrust/store', () => storeMocks)

import { PUT } from '@/app/api/dashboard/clients/[clientId]/local-trust/profile/route'
import { PATCH } from '@/app/api/dashboard/clients/[clientId]/local-trust/actions/[actionId]/route'
import { GET } from '@/app/api/dashboard/clients/[clientId]/local-trust/export/route'
import { getProfile } from '@/lib/auth'

const CLIENT = { id: 'client-1', brand_name: 'Acme', domain: 'acme.com' }

function account(plan: string, overrides: Record<string, unknown> = {}) {
  return {
    account_id: 'acc-1',
    accounts: { plan, status: 'active', stripe_subscription_id: 'sub_1', ...overrides },
  }
}

const put = (body: unknown = {}) => PUT(
  new Request('http://localhost', { method: 'PUT', body: JSON.stringify(body) }),
  { params: Promise.resolve({ clientId: 'client-1' }) },
)
const patch = (body: unknown = { status: 'done' }) => PATCH(
  new Request('http://localhost', { method: 'PATCH', body: JSON.stringify(body) }),
  { params: Promise.resolve({ clientId: 'client-1', actionId: 'action-1' }) },
)
const get = () => GET(
  new Request('http://localhost'),
  { params: Promise.resolve({ clientId: 'client-1' }) },
)

// Every route shares one guard, so the auth/entitlement/ownership contract is
// asserted against all three rather than only where it happens to be called.
const ROUTES = [
  { name: 'profile PUT', call: put, flag: 'local_trust_roi' },
  { name: 'actions PATCH', call: patch, flag: 'local_trust_roi' },
  { name: 'export GET', call: get, flag: 'local_trust_export' },
] as const

beforeEach(() => {
  queries.length = 0
  nextResults = []
  vi.mocked(getProfile).mockReset()
  for (const mock of Object.values(storeMocks)) mock.mockReset()
  storeMocks.verifyClientOwnership.mockResolvedValue(CLIENT)
})

describe('local trust route gating', () => {
  it.each(ROUTES)('$name returns 401 and touches nothing when unauthenticated', async ({ call }) => {
    vi.mocked(getProfile).mockResolvedValue(null)

    const res = await call()

    expect(res.status).toBe(401)
    expect(storeMocks.verifyClientOwnership).not.toHaveBeenCalled()
    expect(queries).toHaveLength(0)
  })

  it.each(ROUTES)('$name returns 403 for a plan without the entitlement', async ({ call, flag }) => {
    // basic carries neither local_trust flag; the guard must refuse before it
    // reveals whether the client id exists.
    vi.mocked(getProfile).mockResolvedValue(account('basic') as never)

    const res = await call()

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({ error: 'UPGRADE_REQUIRED', feature: flag })
    expect(storeMocks.verifyClientOwnership).not.toHaveBeenCalled()
  })

  it.each(ROUTES)('$name returns 404, not 403, for a client on another account', async ({ call }) => {
    // 404 so the endpoint cannot be used to confirm that an id belongs to somebody.
    vi.mocked(getProfile).mockResolvedValue(account('enterprise') as never)
    storeMocks.verifyClientOwnership.mockResolvedValue(null)

    const res = await call()

    expect(res.status).toBe(404)
    expect(storeMocks.upsertLocalTrustProfile).not.toHaveBeenCalled()
    expect(storeMocks.updateLocalTrustActionStatus).not.toHaveBeenCalled()
  })

  it.each(ROUTES)('$name returns 503, not 404, when the ownership lookup itself fails', async ({ call }) => {
    // A database incident must not read as "not yours" and deny a real owner.
    vi.mocked(getProfile).mockResolvedValue(account('enterprise') as never)
    storeMocks.verifyClientOwnership.mockRejectedValue(new Error('connection terminated'))

    expect((await call()).status).toBe(503)
  })

  it.each(ROUTES)('$name never echoes raw store error text in a 500', async ({ call }) => {
    // A Neon error message can carry the connection string, password included —
    // CLAUDE.md warns about exactly this. The handlers return fixed strings; this
    // pins that they keep doing so.
    vi.mocked(getProfile).mockResolvedValue(account('enterprise') as never)
    const secret = 'postgresql://user:hunter2@ep-secret.neon.tech/db'
    for (const mock of [
      storeMocks.upsertLocalTrustProfile,
      storeMocks.updateLocalTrustActionStatus,
      storeMocks.getOrCreateLocalTrustSnapshot,
    ]) mock.mockRejectedValue(new Error(secret))
    nextResults = [[], [{ platform: null }], []]

    const res = await call()
    const body = JSON.stringify(await res.json())

    expect(res.status).toBeGreaterThanOrEqual(500)
    expect(body).not.toContain(secret)
    expect(body).not.toContain('hunter2')
  })

  it('scopes ownership to the caller account, never a caller-supplied id', async () => {
    vi.mocked(getProfile).mockResolvedValue(account('pro') as never)
    storeMocks.upsertLocalTrustProfile.mockResolvedValue({ client_id: 'client-1' })

    await put({ primary_services: ['plumbing'] })

    expect(storeMocks.verifyClientOwnership).toHaveBeenCalledWith('client-1', 'acc-1')
    expect(storeMocks.upsertLocalTrustProfile).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'client-1', accountId: 'acc-1' }),
    )
  })
})

describe('PUT local-trust/profile', () => {
  beforeEach(() => vi.mocked(getProfile).mockResolvedValue(account('pro') as never))

  it('rejects a close rate above 1 rather than storing it', async () => {
    const res = await put({ close_rate: 5 })

    expect(res.status).toBe(400)
    expect(storeMocks.upsertLocalTrustProfile).not.toHaveBeenCalled()
  })

  it('rejects a negative lead value', async () => {
    expect((await put({ average_lead_value: -1 })).status).toBe(400)
  })

  it('caps list inputs instead of trusting their length', async () => {
    storeMocks.upsertLocalTrustProfile.mockResolvedValue({})

    await put({ primary_services: Array.from({ length: 40 }, (_, i) => `svc-${i}`) })

    const { primaryServices } = storeMocks.upsertLocalTrustProfile.mock.calls[0][0]
    expect(primaryServices).toHaveLength(10)
  })

  it('returns 500, never a 2xx, when the write fails', async () => {
    storeMocks.upsertLocalTrustProfile.mockRejectedValue(new Error('write failed'))

    expect((await put({})).status).toBe(500)
  })
})

describe('PATCH local-trust/actions/[actionId]', () => {
  beforeEach(() => vi.mocked(getProfile).mockResolvedValue(account('pro') as never))

  it('rejects a status outside the allowed set', async () => {
    const res = await patch({ status: 'deleted' })

    expect(res.status).toBe(400)
    expect(storeMocks.updateLocalTrustActionStatus).not.toHaveBeenCalled()
  })

  it('scopes the update by the proven clientId so a foreign actionId matches nothing', async () => {
    storeMocks.updateLocalTrustActionStatus.mockResolvedValue({ id: 'action-1' })

    await patch()

    expect(storeMocks.updateLocalTrustActionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'client-1', actionId: 'action-1' }),
    )
  })

  it('returns 404 when the action does not exist', async () => {
    storeMocks.updateLocalTrustActionStatus.mockResolvedValue(null)

    expect((await patch()).status).toBe(404)
  })
})

describe('GET local-trust/export', () => {
  beforeEach(() => vi.mocked(getProfile).mockResolvedValue(account('enterprise') as never))

  it('refuses Pro — export is Enterprise-only, unlike profile and actions', async () => {
    // The commercially interesting split: Pro carries local_trust_roi but not
    // local_trust_export. The shared 403 case above only exercises Basic, which
    // has neither, so it cannot tell the two flags apart.
    vi.mocked(getProfile).mockResolvedValue(account('pro') as never)

    const res = await get()

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({ feature: 'local_trust_export' })
    expect(queries).toHaveLength(0)
  })

  it('returns 409 rather than an empty CSV when there is no baseline', async () => {
    nextResults = [[], [], []]   // no scans, no pulse summary, no missed rows

    const res = await get()

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: 'LOCAL_TRUST_BASELINE_REQUIRED' })
  })

  it('does not accept platform-only pulse rows as an aggregate baseline', async () => {
    // hasAggregatePulseBaseline looks for `platform IS NULL` rows specifically.
    // Per-platform rows are the only kind anything has ever written, so without
    // this assertion the 409 above could pass for the wrong reason — and it
    // becomes load-bearing the moment the summary producer writes both kinds.
    nextResults = [[], [{ platform: 'gpt-4o', scan_week: '2026-01-05' }], []]

    const res = await get()

    expect(res.status).toBe(409)
    expect(storeMocks.getOrCreateLocalTrustSnapshot).not.toHaveBeenCalled()
  })

  it('sanitises the client id in the download filename', async () => {
    nextResults = [[], [{ platform: null }], []]
    storeMocks.getOrCreateLocalTrustSnapshot.mockResolvedValue({
      snapshot: { local_trust_score: 70, snapshot_month: '2026-01', roi_estimate: null },
      actions: [],
    })

    const res = await GET(
      new Request('http://localhost'),
      { params: Promise.resolve({ clientId: '../../etc/passwd' }) },
    )

    const disposition = res.headers.get('content-disposition') ?? ''
    expect(disposition).not.toContain('..')
    expect(disposition).not.toContain('/')
    expect(disposition).toMatch(/filename="local-trust-[A-Za-z0-9_-]*\.csv"/)
  })

  it('scopes the scan read by account_id and the pulse reads by client_id', async () => {
    nextResults = [[], [{ platform: null, scan_week: '2026-01-01' }], []]
    storeMocks.getOrCreateLocalTrustSnapshot.mockResolvedValue({
      snapshot: { local_trust_score: 70, snapshot_month: '2026-01', roi_estimate: null },
      actions: [],
    })

    await get()

    expect(queries[0]).toContain('from scans')
    expect(queries[0]).toContain('account_id')
    expect(queries.filter(q => q.includes('pulse_')).length).toBeGreaterThan(0)
    for (const q of queries.filter(q => q.includes('pulse_'))) expect(q).toContain('client_id')
  })

  it('defuses CSV formula injection in exported values', async () => {
    nextResults = [[], [{ platform: null }], []]
    storeMocks.getOrCreateLocalTrustSnapshot.mockResolvedValue({
      snapshot: { local_trust_score: 70, snapshot_month: '2026-01', roi_estimate: null },
      // A title a user controls, crafted to execute on open in Excel/Sheets.
      actions: [{ status: 'open', title: '=cmd|/c calc' }],
    })

    const body = await (await get()).text()

    expect(body).toContain("'=cmd|/c calc")
    expect(body).not.toMatch(/(^|,)=cmd/m)
  })

  it('returns 500 when a read throws', async () => {
    nextResults = [new Error('connection terminated')]

    expect((await get()).status).toBe(500)
  })
})
