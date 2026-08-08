import { POST } from '@/app/api/onboarding/complete/route'
import { NextRequest } from 'next/server'

const getProfileMock = vi.hoisted(() => vi.fn().mockResolvedValue({ account_id: 'acc-1' }))
vi.mock('@/lib/auth', () => ({ getProfile: getProfileMock }))

const mockSql = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', () => ({ db: () => mockSql }))

vi.mock('@/lib/openrouter', () => ({
  callOpenRouter: vi.fn().mockResolvedValue(
    JSON.stringify([{ category: 'brand_query', question: 'What is TestBrand?', language: 'en' }])
  ),
}))

describe('POST /api/onboarding/complete', () => {
  beforeEach(() => {
    mockSql.mockClear()
    getProfileMock.mockClear()
    getProfileMock.mockResolvedValue({ account_id: 'acc-1' })
  })

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
    // Body validation happens before any database work.
    expect(mockSql).not.toHaveBeenCalled()
  })

  it('returns 401 when unauthenticated', async () => {
    getProfileMock.mockResolvedValue(null)
    const req = new NextRequest('http://localhost/api/onboarding/complete', {
      method: 'POST',
      body: JSON.stringify({ brandName: 'Test', domain: 'test.com' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
    expect(mockSql).not.toHaveBeenCalled()
  })
})
