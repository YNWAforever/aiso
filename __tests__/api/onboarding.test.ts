import { POST } from '@/app/api/onboarding/complete/route'
import { NextRequest } from 'next/server'

const getProfileMock = vi.hoisted(() => vi.fn().mockResolvedValue({ account_id: 'acc-1' }))
vi.mock('@/lib/auth', () => ({ getProfile: getProfileMock }))

// Mock Supabase server client
vi.mock('@/lib/supabase-server', () => ({
  createServerSupabaseClient: vi.fn().mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'acc-1', plan: 'basic' }, error: null }),
    }),
  }),
}))

vi.mock('@/lib/openrouter', () => ({
  callOpenRouter: vi.fn().mockResolvedValue(
    JSON.stringify([{ category: 'brand_query', question: 'What is TestBrand?', language: 'en' }])
  ),
}))

describe('POST /api/onboarding/complete', () => {
  it('returns 400 when brandName is missing', async () => {
    const req = new NextRequest('http://localhost/api/onboarding/complete', {
      method: 'POST',
      body: JSON.stringify({ domain: 'test.com' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('brandName required')
  })

  it('returns 401 when unauthenticated', async () => {
    getProfileMock.mockResolvedValueOnce(null)
    const { createServerSupabaseClient } = await import('@/lib/supabase-server')
    vi.mocked(createServerSupabaseClient).mockResolvedValueOnce({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    } as never)
    const req = new NextRequest('http://localhost/api/onboarding/complete', {
      method: 'POST',
      body: JSON.stringify({ brandName: 'Test', domain: 'test.com' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })
})
