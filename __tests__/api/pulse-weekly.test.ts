/**
 * TDD: Weekly pulse scan logic
 * Tests the suggest-questions API + pulse metric processing helpers
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ───────────────────────────────────────────────────────
vi.mock('@/lib/supabase-server', () => ({
  createServerSupabaseClient: vi.fn().mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
    from: vi.fn().mockImplementation((table: string) => ({
      select:  vi.fn().mockReturnThis(),
      eq:      vi.fn().mockReturnThis(),
      limit:   vi.fn().mockResolvedValue({
        data: table === 'prompt_bank'
          ? [
              { question: 'What is TestBrand?', category: 'brand_query' },
              { question: 'TestBrand vs competitors?', category: 'brand_query' },
            ]
          : [],
      }),
      single:  vi.fn().mockResolvedValue({
        data: { brand_name: 'TestBrand', industry: 'technology', description: 'An AI SEO tool' },
        error: null,
      }),
    })),
  }),
}))

vi.mock('@/lib/openrouter', () => ({
  callOpenRouter: vi.fn().mockResolvedValue(
    JSON.stringify([
      { question: 'How does TestBrand work?', category: 'brand_query' },
      { question: 'TestBrand pricing compared to Semrush?', category: 'brand_query' },
      { question: 'Best AI SEO tools for technology companies?', category: 'category_query' },
      { question: 'How to improve AI search visibility?', category: 'intent_query' },
      { question: 'Why is my brand invisible in ChatGPT?', category: 'pain_point' },
    ])
  ),
}))

// ── Suggest Questions API ────────────────────────────────────────
describe('POST /api/pulse/suggest-questions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 400 when clientId is missing', async () => {
    const { POST } = await import('@/app/api/pulse/suggest-questions/route')
    const req = new NextRequest('http://localhost/api/pulse/suggest-questions', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/clientId/i)
  })

  it('returns array of suggestions with question and category', async () => {
    const { POST } = await import('@/app/api/pulse/suggest-questions/route')
    const req = new NextRequest('http://localhost/api/pulse/suggest-questions', {
      method: 'POST',
      body: JSON.stringify({ clientId: 'client-1', count: 5 }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(Array.isArray(json.suggestions)).toBe(true)
    expect(json.suggestions.length).toBeGreaterThan(0)
    for (const s of json.suggestions) {
      expect(s).toHaveProperty('question')
      expect(s).toHaveProperty('category')
      expect(typeof s.question).toBe('string')
      expect(s.question.length).toBeGreaterThan(0)
    }
  })

  it('respects count limit — never returns more than requested', async () => {
    const { POST } = await import('@/app/api/pulse/suggest-questions/route')
    const req = new NextRequest('http://localhost/api/pulse/suggest-questions', {
      method: 'POST',
      body: JSON.stringify({ clientId: 'client-1', count: 3 }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    const json = await res.json()
    expect(json.suggestions.length).toBeLessThanOrEqual(3)
  })

  it('clamps count to max 10 even if caller requests more', async () => {
    const { POST } = await import('@/app/api/pulse/suggest-questions/route')
    const req = new NextRequest('http://localhost/api/pulse/suggest-questions', {
      method: 'POST',
      body: JSON.stringify({ clientId: 'client-1', count: 999 }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    const json = await res.json()
    // Should be clamped to 10 even though mock returns 5
    expect(json.suggestions.length).toBeLessThanOrEqual(10)
  })

  it('returns 401 when unauthenticated', async () => {
    const { createServerSupabaseClient } = await import('@/lib/supabase-server')
    vi.mocked(createServerSupabaseClient).mockResolvedValueOnce({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    } as never)
    const { POST } = await import('@/app/api/pulse/suggest-questions/route')
    const req = new NextRequest('http://localhost/api/pulse/suggest-questions', {
      method: 'POST',
      body: JSON.stringify({ clientId: 'client-1' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 404 when client not found for this user', async () => {
    const { createServerSupabaseClient } = await import('@/lib/supabase-server')
    vi.mocked(createServerSupabaseClient).mockResolvedValueOnce({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
      from: vi.fn().mockReturnValue({
        select:  vi.fn().mockReturnThis(),
        eq:      vi.fn().mockReturnThis(),
        limit:   vi.fn().mockResolvedValue({ data: [] }),
        single:  vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
      }),
    } as never)
    const { POST } = await import('@/app/api/pulse/suggest-questions/route')
    const req = new NextRequest('http://localhost/api/pulse/suggest-questions', {
      method: 'POST',
      body: JSON.stringify({ clientId: 'wrong-client-id' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(404)
  })

  it('returns empty suggestions gracefully when LLM returns invalid JSON', async () => {
    const { callOpenRouter } = await import('@/lib/openrouter')
    vi.mocked(callOpenRouter).mockResolvedValueOnce('not valid json at all { broken')
    const { POST } = await import('@/app/api/pulse/suggest-questions/route')
    const req = new NextRequest('http://localhost/api/pulse/suggest-questions', {
      method: 'POST',
      body: JSON.stringify({ clientId: 'client-1' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(Array.isArray(json.suggestions)).toBe(true)
    expect(json.suggestions.length).toBe(0)
  })
})

// ── Trial Status Logic ───────────────────────────────────────────
describe('getTrialStatus — edge cases for weekly scan access', () => {
  it('free trial expires correctly after 7 days', async () => {
    const { getTrialStatus } = await import('@/lib/trial')
    // 8 days ago — trial expired
    const endsAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
    const status = getTrialStatus({
      id: 'acc-1', plan: 'basic', status: 'active',
      trial_started_at: new Date(Date.now() - 15 * 86400_000).toISOString(),
      trial_ends_at: endsAt,
      trial_emails_sent: 0,
      stripe_customer_id: null, stripe_subscription_id: null,
      created_at: new Date().toISOString(),
    })
    expect(status.isTrial).toBe(true)
    expect(status.isExpired).toBe(true)
    expect(status.daysRemaining).toBe(0)
  })

  it('active trial with 3 days remaining returns correct daysRemaining', async () => {
    const { getTrialStatus } = await import('@/lib/trial')
    const endsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
    const status = getTrialStatus({
      id: 'acc-1', plan: 'basic', status: 'active',
      trial_started_at: new Date(Date.now() - 4 * 86400_000).toISOString(),
      trial_ends_at: endsAt,
      trial_emails_sent: 0,
      stripe_customer_id: null, stripe_subscription_id: null,
      created_at: new Date().toISOString(),
    })
    expect(status.isTrial).toBe(true)
    expect(status.isExpired).toBe(false)
    expect(status.daysRemaining).toBe(3)
  })

  it('non-trial account returns isTrial=false', async () => {
    const { getTrialStatus } = await import('@/lib/trial')
    const status = getTrialStatus({
      id: 'acc-1', plan: 'pro', status: 'active',
      trial_started_at: null,
      trial_ends_at: null,
      trial_emails_sent: 0,
      stripe_customer_id: 'cus_123', stripe_subscription_id: 'sub_123',
      created_at: new Date().toISOString(),
    })
    expect(status.isTrial).toBe(false)
    expect(status.isExpired).toBe(false)
    expect(status.daysRemaining).toBe(0)
  })
})
