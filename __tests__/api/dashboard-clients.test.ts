import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const getProfile = vi.fn()
const from = vi.fn()

vi.mock('@/lib/auth', () => ({ getProfile }))
vi.mock('@/lib/supabase', () => ({ supabase: { from } }))

async function postBrand(body: object) {
  const { POST } = await import('@/app/api/dashboard/clients/route')
  return POST(new NextRequest('http://localhost/api/dashboard/clients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

describe('POST /api/dashboard/clients', () => {
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    getProfile.mockResolvedValue({
      account_id: ['account', '1'].join('-'),
      accounts: {
        plan: 'pro',
        status: 'active',
        stripe_subscription_id: 'sub_1',
      },
    })
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  it('keeps the generic response while logging one exact sanitized database diagnostic', async () => {
    const tenantBrand = ['Foto', 'max'].join('')
    const tenantAccountId = ['account', '1'].join('-')
    const databaseMessage = `duplicate key value violates unique constraint for ${tenantBrand}`
    const sql = `insert into clients (account_id, brand_name) values ('${tenantAccountId}', '${tenantBrand}')`
    const stack = `DatabaseError: ${databaseMessage}\n    at ${sql}`
    const countQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ count: 0 }),
    }
    const insertQuery = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: '23505',
          category: 'constraint_violation',
          message: databaseMessage,
          details: `account_id=${tenantAccountId}`,
          hint: sql,
          query: sql,
          stack,
        },
      }),
    }
    from.mockReturnValueOnce(countQuery).mockReturnValueOnce(insertQuery)

    const response = await postBrand({ brand_name: tenantBrand })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Failed to create brand' })

    const expectedDiagnostic = {
      event: 'brand_create_database_error',
      correlationId: expect.any(String),
      database: {
        code: '23505',
        category: 'unique_violation',
      },
    }

    expect(consoleError.mock.calls).toHaveLength(1)
    for (const diagnosticCall of consoleError.mock.calls) {
      expect(diagnosticCall).toHaveLength(1)
      expect(diagnosticCall[0]).toEqual(expectedDiagnostic)

      const serializedArguments = JSON.stringify(diagnosticCall)
      expect(serializedArguments).not.toContain(databaseMessage)
      expect(serializedArguments).not.toContain(sql)
      expect(serializedArguments).not.toContain(tenantBrand)
      expect(serializedArguments).not.toContain(tenantAccountId)
      expect(serializedArguments).not.toContain(stack)
    }
  })
})
