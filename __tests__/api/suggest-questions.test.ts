// __tests__/api/suggest-questions.test.ts
import { POST } from '@/app/api/pulse/suggest-questions/route'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => {
  const state = {
    profile: { id: 'u1', account_id: 'acct-A', is_admin: false } as
      { id: string; account_id: string; is_admin: boolean } | null,
  }
  // clientId → owning account_id
  const clientOwners = new Map<string, string>([
    ['client-1', 'acct-A'],
    ['client-b', 'acct-B'],
  ])
  return { state, clientOwners }
})

vi.mock('@/lib/auth', () => ({
  getProfile: vi.fn(async () => h.state.profile),
}))

// Neon tagged-template mock — backs the ownership gate
vi.mock('@/lib/db', () => ({
  db: () => (strings: TemplateStringsArray, ...params: unknown[]) => {
    const text = strings.join('?')
    if (/from clients/i.test(text)) {
      const [clientId, accountId] = params as [string, string]
      return Promise.resolve(
        h.clientOwners.get(clientId) === accountId ? [{ id: clientId }] : [],
      )
    }
    return Promise.resolve([])
  },
}))

vi.mock('@/lib/supabase-server', () => ({
  createServerSupabaseClient: vi.fn().mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: [{ question: 'Existing question?', category: 'brand_query' }],
      }),
      single: vi.fn().mockResolvedValue({
        data: { brand_name: 'TestBrand', industry: 'technology' },
      }),
    }),
  }),
}))

vi.mock('@/lib/openrouter', () => ({
  callOpenRouter: vi.fn().mockResolvedValue(
    JSON.stringify([
      { question: 'What does TestBrand do?', category: 'brand_query' },
      { question: 'TestBrand vs competitors?', category: 'brand_query' },
    ])
  ),
}))

describe('POST /api/pulse/suggest-questions', () => {
  beforeEach(() => {
    h.state.profile = { id: 'u1', account_id: 'acct-A', is_admin: false }
  })

  it('returns 401 when unauthenticated', async () => {
    h.state.profile = null
    const req = new NextRequest('http://localhost/api/pulse/suggest-questions', {
      method: 'POST',
      body: JSON.stringify({ clientId: 'client-1' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 404 for a clientId owned by another account', async () => {
    const req = new NextRequest('http://localhost/api/pulse/suggest-questions', {
      method: 'POST',
      body: JSON.stringify({ clientId: 'client-b', count: 2 }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(404)
  })

  it('returns 400 when clientId is missing', async () => {
    const req = new NextRequest('http://localhost/api/pulse/suggest-questions', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns array of suggestions', async () => {
    const req = new NextRequest('http://localhost/api/pulse/suggest-questions', {
      method: 'POST',
      body: JSON.stringify({ clientId: 'client-1', count: 2 }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(Array.isArray(json.suggestions)).toBe(true)
    expect(json.suggestions.length).toBeGreaterThan(0)
    expect(json.suggestions[0]).toHaveProperty('question')
    expect(json.suggestions[0]).toHaveProperty('category')
  })
})
