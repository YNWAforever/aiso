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

// account_id must come from getProfile()'s session, never the request body —
// so the mock must reflect a genuinely active pro subscription for
// resolveCommercialEntitlement() to grant the pro tier (3 brands), matching
// the effective-entitlement logic the check_brand_limit() DB trigger also
// applies (supabase/migrations/028_account_plan_overrides.sql).
const PRO_PROFILE = {
  account_id: 'acc-1',
  accounts: { id: 'acc-1', plan: 'pro', status: 'active', stripe_subscription_id: 'sub_123' },
}

describe('POST /api/dashboard/clients', () => {
  beforeEach(() => {
    queries.length = 0
    nextResults = []
    vi.mocked(getProfile).mockResolvedValue(PRO_PROFILE as never)
  })

  it('creates a brand and returns its id', async () => {
    nextResults = [[{ n: 0 }], [{ id: 'client-1' }]]
    const res = await POST(request({ brand_name: 'Acme' }))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ id: 'client-1' })
  })

  it('scopes the brand count to the caller account', async () => {
    nextResults = [[{ n: 0 }], [{ id: 'client-1' }]]
    await POST(request({ brand_name: 'Acme' }))
    expect(queries[0]).toContain('account_id')
  })

  it('returns 403 when the plan limit is already reached', async () => {
    nextResults = [[{ n: 3 }]]
    const res = await POST(request({ brand_name: 'Fourth' }))
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({ error: 'BRAND_LIMIT_REACHED', limit: 3 })
  })

  it('returns 403 when the trigger raises BRAND_LIMIT_REACHED on the race', async () => {
    nextResults = [[{ n: 0 }], new Error('BRAND_LIMIT_REACHED') as never]
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
