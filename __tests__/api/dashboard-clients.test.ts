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

import { POST } from '@/app/api/dashboard/clients/route'
import { getProfile } from '@/lib/auth'

function request(body: unknown) {
  return new Request('http://localhost/api/dashboard/clients', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as never
}

// account_id must come from getProfile()'s session, never the request body.
// createBrandForAccount() now re-reads the account row itself and derives
// entitlement from that fresh row (account select -> brand count -> CTE
// insert), so the route no longer reads profile.accounts at all.
const PROFILE = { account_id: 'acc-1' }

// A full accounts row, shaped the way createBrandForAccount's own SELECT
// returns it, for resolveCommercialEntitlement() to resolve against.
function accountRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'acc-1', plan: 'basic', status: 'active', stripe_subscription_id: 'sub_1',
    trial_started_at: null, trial_ends_at: null, override_plan: null, override_expires_at: null,
    ...overrides,
  }
}

describe('POST /api/dashboard/clients', () => {
  beforeEach(() => {
    queries.length = 0
    nextResults = []
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
  })

  it('creates a brand and returns its id', async () => {
    nextResults = [
      [accountRow()],
      [{ n: 0 }],
      [{ client_id: 'client-1', trial_ends_at: new Date('2026-08-05T00:00:00.000Z') }],
    ]
    const res = await POST(request({ brand_name: 'Acme' }))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ id: 'client-1' })
  })

  it('scopes the brand count to the caller account', async () => {
    nextResults = [
      [accountRow()],
      [{ n: 0 }],
      [{ client_id: 'client-1', trial_ends_at: new Date('2026-08-05T00:00:00.000Z') }],
    ]
    await POST(request({ brand_name: 'Acme' }))
    // queries[0] is the service's own account lookup (select ... from
    // accounts where id = ...); the brand count, scoped by account_id, is
    // the second query the service issues.
    expect(queries[1]).toContain('account_id')
  })

  it('returns 403 when the plan limit is already reached', async () => {
    nextResults = [
      [accountRow({ plan: 'pro' })],
      [{ n: 3 }],
    ]
    const res = await POST(request({ brand_name: 'Fourth' }))
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({ error: 'BRAND_LIMIT_REACHED', limit: 3 })
  })

  it('returns 403 when the trigger raises BRAND_LIMIT_REACHED on the race', async () => {
    nextResults = [
      [accountRow()],
      [{ n: 0 }],
      new Error('BRAND_LIMIT_REACHED') as never,
    ]
    const res = await POST(request({ brand_name: 'Racer' }))
    expect(res.status).toBe(403)
  })

  it('returns 500 when the database fails, not a silent success', async () => {
    nextResults = [new Error('connection terminated') as never]
    const res = await POST(request({ brand_name: 'Acme' }))
    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({ error: 'Failed to create brand' })
  })

  it('rejects a missing brand_name before touching the database', async () => {
    const res = await POST(request({}))
    expect(res.status).toBe(400)
    expect(queries).toHaveLength(0)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getProfile).mockResolvedValue(null)
    const res = await POST(request({ brand_name: 'Acme' }))
    expect(res.status).toBe(401)
  })
})
