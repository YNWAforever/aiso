import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  beforeEach(() => {
    vi.clearAllMocks()
    getProfile.mockResolvedValue({
      account_id: 'account-1',
      accounts: {
        plan: 'pro',
        status: 'active',
        stripe_subscription_id: 'sub_1',
      },
    })
  })

  it('keeps the generic response while logging only sanitized database diagnostics', async () => {
    const tenantBrand = ['Foto', 'max'].join('')
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
          message: `duplicate key value violates unique constraint for ${tenantBrand}`,
        },
      }),
    }
    from.mockReturnValueOnce(countQuery).mockReturnValueOnce(insertQuery)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const response = await postBrand({ brand_name: tenantBrand })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Failed to create brand' })

    const diagnostic = consoleError.mock.calls
      .map(([entry]) => entry)
      .find((entry): entry is Record<string, unknown> =>
        typeof entry === 'object' && entry !== null && entry.event === 'brand_create_database_error'
      )

    expect(diagnostic).toMatchObject({
      event: 'brand_create_database_error',
      correlationId: expect.any(String),
      database: {
        code: expect.stringMatching(/^[A-Z0-9]{5}$/),
        category: expect.any(String),
      },
    })
    expect(JSON.stringify(diagnostic)).not.toContain(tenantBrand)
  })
})
