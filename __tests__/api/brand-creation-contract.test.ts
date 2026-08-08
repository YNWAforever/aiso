import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

type Profile = {
  account_id: string
  accounts: {
    plan: 'basic' | 'pro' | 'enterprise'
    status: 'active'
    stripe_subscription_id: string
  }
}

const state = vi.hoisted(() => ({
  profile: null as Profile | null,
  queries: [] as string[],
  nextResults: [] as unknown[][],
  sql: vi.fn((strings: TemplateStringsArray) => {
    state.queries.push(strings.join('?'))
    const result = state.nextResults.shift()
    if (result instanceof Error) throw result
    return Promise.resolve(result ?? [])
  }),
}))

vi.mock('@/lib/auth', () => ({ getProfile: vi.fn(async () => state.profile) }))
vi.mock('@/lib/db', () => ({ db: () => state.sql }))

async function postBrand(body: object) {
  const { POST } = await import('@/app/api/dashboard/clients/route')
  return POST(new NextRequest('http://localhost/api/dashboard/clients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

function paidProfile(plan: Profile['accounts']['plan'] = 'pro'): Profile {
  return {
    account_id: 'account-contract',
    accounts: {
      plan,
      status: 'active',
      stripe_subscription_id: `sub_${plan}`,
    },
  }
}

describe('POST /api/dashboard/clients contract', () => {
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    state.profile = paidProfile()
    state.queries.length = 0
    state.nextResults = []
    state.sql.mockClear()
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  it('creates a brand and returns only the new id', async () => {
    state.nextResults = [[{ n: 0 }], [{ id: 'client-1' }]]

    const response = await postBrand({
      brand_name: 'Acme',
      domain: 'acme.example',
      industry: 'Retail',
      competitors: ['Other Co'],
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ id: 'client-1' })
    expect(state.queries[0]).toContain('account_id')
    expect(state.queries[1]).toContain('insert into clients')
    expect(state.queries[1]).toContain('competitors')
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated requests before querying the database', async () => {
    state.profile = null

    const response = await postBrand({ brand_name: 'Acme' })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(state.sql).not.toHaveBeenCalled()
  })

  it('returns the plan limit contract when the account is exhausted', async () => {
    state.profile = paidProfile('basic')
    state.nextResults = [[{ n: 1 }]]

    const response = await postBrand({ brand_name: 'Acme' })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'BRAND_LIMIT_REACHED',
      plan: 'basic',
      limit: 1,
    })
    expect(state.sql).toHaveBeenCalledTimes(1)
  })

  it('rejects malformed input before attempting a database query', async () => {
    const response = await postBrand({ domain: 'acme.example' })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'brand_name required' })
    expect(state.sql).not.toHaveBeenCalled()
  })

  it('keeps database failures generic and logs only the allowlisted diagnostic', async () => {
    const tenantBrand = ['Foto', 'max'].join('')
    const tenantAccountId = ['account', 'contract'].join('-')
    const databaseMessage = `duplicate key value for ${tenantBrand}`
    const sql = `insert into clients (${tenantBrand})`
    const databaseError = Object.assign(new Error(databaseMessage), {
      code: '23505',
      details: `account_id=${tenantAccountId}`,
      hint: 'private hint',
      query: sql,
    })
    state.nextResults = [[{ n: 0 }], databaseError as never]

    const response = await postBrand({ brand_name: tenantBrand })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Failed to create brand' })
    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(consoleError.mock.calls[0]).toHaveLength(1)
    expect(consoleError.mock.calls[0][0]).toEqual({
      event: 'brand_create_database_error',
      correlationId: expect.any(String),
      database: {
        code: '23505',
        category: 'unique_violation',
      },
    })
    const serializedLog = JSON.stringify(consoleError.mock.calls)
    expect(serializedLog).not.toContain(tenantBrand)
    expect(serializedLog).not.toContain(tenantAccountId)
    expect(serializedLog).not.toContain(databaseMessage)
    expect(serializedLog).not.toContain('private hint')
    expect(serializedLog).not.toContain(sql)
  })
})
