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
  from: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getProfile: vi.fn(async () => state.profile) }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: state.from } }))

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

function countQuery(count: number) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ count }),
  }
}

function insertQuery(result: { data: unknown; error: unknown }) {
  return {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
  }
}

describe('POST /api/dashboard/clients contract', () => {
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    state.profile = paidProfile()
    state.from.mockReset()
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  it('creates a brand and returns only the new id', async () => {
    const count = countQuery(0)
    const insert = insertQuery({ data: { id: 'client-1' }, error: null })
    state.from.mockReturnValueOnce(count).mockReturnValueOnce(insert)

    const response = await postBrand({
      brand_name: 'Acme',
      domain: 'acme.example',
      industry: 'Retail',
      competitors: ['Other Co'],
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ id: 'client-1' })
    expect(insert.insert).toHaveBeenCalledWith({
      brand_name: 'Acme',
      domain: 'acme.example',
      industry: 'Retail',
      competitors: ['Other Co'],
      account_id: 'account-contract',
      status: 'active',
    })
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated requests before querying the database', async () => {
    state.profile = null

    const response = await postBrand({ brand_name: 'Acme' })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(state.from).not.toHaveBeenCalled()
  })

  it('returns the plan limit contract when the account is exhausted', async () => {
    state.profile = paidProfile('basic')
    state.from.mockReturnValueOnce(countQuery(1))

    const response = await postBrand({ brand_name: 'Acme' })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'BRAND_LIMIT_REACHED',
      plan: 'basic',
      limit: 1,
    })
    expect(state.from).toHaveBeenCalledTimes(1)
  })

  it('rejects malformed input before attempting an insert', async () => {
    state.from.mockReturnValueOnce(countQuery(0))

    const response = await postBrand({ domain: 'acme.example' })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'brand_name required' })
    expect(state.from).toHaveBeenCalledTimes(1)
  })

  it('keeps database failures generic and logs only the allowlisted diagnostic', async () => {
    const tenantBrand = ['Foto', 'max'].join('')
    const tenantAccountId = ['account', 'contract'].join('-')
    const databaseMessage = `duplicate key value for ${tenantBrand}`
    const insert = insertQuery({
      data: null,
      error: {
        code: '23505',
        message: databaseMessage,
        details: `account_id=${tenantAccountId}`,
        hint: 'private hint',
        query: `insert into clients (${tenantBrand})`,
        stack: `Error: ${databaseMessage}`,
      },
    })
    state.from.mockReturnValueOnce(countQuery(0)).mockReturnValueOnce(insert)

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
    expect(serializedLog).not.toContain('insert into clients')
  })
})
