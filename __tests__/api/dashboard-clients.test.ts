import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const getProfileMock = vi.hoisted(() => vi.fn())
const fromMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth', () => ({ getProfile: getProfileMock }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: fromMock } }))

describe('POST /api/dashboard/clients', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getProfileMock.mockResolvedValue({
      id: 'user-1',
      account_id: 'account-1',
      accounts: {
        id: 'account-1',
        plan: 'basic',
        status: 'active',
        stripe_subscription_id: null,
        trial_ends_at: null,
      },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs structured database evidence when brand creation fails without exposing it to the client', async () => {
    const databaseError = {
      code: '23503',
      message: 'insert or update on table "clients" violates foreign key constraint',
      details: 'Key (account_id)=(account-1) is not present in table "accounts".',
      hint: null,
    }

    fromMock.mockImplementation((table: string) => {
      expect(table).toBe('clients')
      const query: Record<string, unknown> = {}
      query.select = vi.fn((_columns?: string, options?: { head?: boolean }) => {
        if (options?.head) {
          return {
            eq: vi.fn().mockResolvedValue({ count: 0, error: null }),
          }
        }
        return query
      })
      query.insert = vi.fn(() => query)
      query.single = vi.fn().mockResolvedValue({ data: null, error: databaseError })
      return query
    })

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { POST } = await import('@/app/api/dashboard/clients/route')
    const req = new NextRequest('http://localhost/api/dashboard/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand_name: 'Fotomax',
        domain: 'fotomax.com',
        industry: 'Retail & E-commerce',
        competitors: ['Capture HK', 'PhotoCity', 'Sunrise Professional Photofinishing.'],
      }),
    })

    const response = await POST(req)

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to create brand' })
    expect(errorSpy).toHaveBeenCalledWith('[dashboard/clients] insert failed', {
      code: databaseError.code,
      message: databaseError.message,
      details: databaseError.details,
      hint: databaseError.hint,
    })
  })
})
