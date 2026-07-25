/**
 * TDD: Onboarding flow — expanded
 * Covers: auth gate, tenant binding, plan brand cap, trial setup,
 * domain/region/description/competitors, idempotency
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── DB state simulation ──────────────────────────────────────────
let clientsInDb: { id: string }[] = []

const { mockGetProfile, sqlMock, inserts, updates } = vi.hoisted(() => ({
  mockGetProfile: vi.fn(),
  sqlMock: vi.fn(),
  inserts: [] as Array<{ table: string; payload: unknown }>,
  updates: [] as Array<{ table: string; payload: unknown }>,
}))

vi.mock('@/lib/auth', () => ({ getProfile: mockGetProfile }))

vi.mock('@/lib/db', () => ({ db: () => sqlMock }))

vi.mock('@/lib/supabase-server', () => ({
  createServerSupabaseClient: vi.fn().mockResolvedValue({
    from: (table: string) => ({
      insert: (payload: unknown) => {
        inserts.push({ table, payload })
        return {
          select: () => ({ single: () => Promise.resolve({ data: { id: 'client-new' }, error: null }) }),
        }
      },
      update: (payload: unknown) => {
        updates.push({ table, payload })
        return { eq: () => Promise.resolve({ error: null }) }
      },
    }),
  }),
}))

vi.mock('@/lib/openrouter', () => ({
  callOpenRouter: vi.fn().mockResolvedValue(
    JSON.stringify([
      { category: 'brand_query', question: 'What is TestBrand?', language: 'en' },
      { category: 'pain_point',  question: 'How does TestBrand help with SEO?', language: 'en' },
    ])
  ),
}))

function profileFixture(overrides: { plan?: string; trial_started_at?: string | null } = {}) {
  return {
    id: 'user-1',
    account_id: 'acc-1',
    display_name: 'Tester',
    email: 'tester@example.com',
    is_admin: false,
    created_at: '2026-01-01T00:00:00.000Z',
    accounts: {
      id: 'acc-1',
      stripe_customer_id: null,
      stripe_subscription_id: null,
      plan: overrides.plan ?? 'basic',
      status: 'trialing',
      trial_started_at: overrides.trial_started_at ?? null,
      trial_ends_at: null,
      trial_emails_sent: 0,
      created_at: '2026-01-01T00:00:00.000Z',
    },
  }
}

function post(body: unknown) {
  return new NextRequest('http://localhost/api/onboarding/complete', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/onboarding/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clientsInDb = []
    inserts.length = 0
    updates.length = 0

    mockGetProfile.mockResolvedValue(profileFixture())
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      const query = strings.join('?')
      if (query.includes('from clients')) return Promise.resolve(clientsInDb)
      return Promise.resolve([])
    })
  })

  it('returns 400 when brandName is missing', async () => {
    const { POST } = await import('@/app/api/onboarding/complete/route')
    const res = await POST(post({ domain: 'example.com' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('brandName required')
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetProfile.mockResolvedValue(null)
    const { POST } = await import('@/app/api/onboarding/complete/route')
    const res = await POST(post({ brandName: 'TestBrand' }))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Unauthorized')
  })

  it('returns { clientId, trialEndsAt } on success', async () => {
    const { POST } = await import('@/app/api/onboarding/complete/route')
    const res = await POST(post({
      brandName: 'TestBrand',
      domain:    'testbrand.com',
      industry:  'technology',
      region:    'HK',
    }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toHaveProperty('clientId')
    expect(json).toHaveProperty('trialEndsAt')
    // trialEndsAt should be ~7 days from now
    const endsAt = new Date(json.trialEndsAt).getTime()
    const sevenDays = 7 * 24 * 60 * 60 * 1000
    expect(endsAt).toBeGreaterThan(Date.now() + sevenDays - 60_000)
    expect(endsAt).toBeLessThan(Date.now()  + sevenDays + 60_000)
  })

  it('scopes the existing-brand lookup to the session account', async () => {
    const { POST } = await import('@/app/api/onboarding/complete/route')
    await POST(post({ brandName: 'TestBrand' }))
    const lookup = sqlMock.mock.calls.find(
      ([strings]: [TemplateStringsArray]) => strings.join('?').includes('from clients')
    )
    expect(lookup).toBeDefined()
    expect((lookup![0] as TemplateStringsArray).join('?')).toContain('account_id =')
    expect(lookup!.slice(1)).toEqual(['acc-1'])
  })

  it('returns existing clientId on double-submit (idempotent)', async () => {
    clientsInDb = [{ id: 'client-existing' }]
    const { POST } = await import('@/app/api/onboarding/complete/route')
    const res = await POST(post({ brandName: 'TestBrand', domain: 'testbrand.com' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.clientId).toBe('client-existing')
    expect(inserts.find(i => i.table === 'clients')).toBeUndefined()
  })

  it('does NOT reset trial dates on double-submit', async () => {
    mockGetProfile.mockResolvedValue(
      profileFixture({ trial_started_at: new Date(Date.now() - 3 * 86400_000).toISOString() })
    )
    clientsInDb = [{ id: 'client-existing' }]
    const { POST } = await import('@/app/api/onboarding/complete/route')
    const res = await POST(post({ brandName: 'TestBrand' }))
    expect(res.status).toBe(200)
    // The accounts row must not be re-stamped with fresh trial dates
    expect(updates.find(u => u.table === 'accounts')).toBeUndefined()
  })

  it('accepts description and competitors without error', async () => {
    const { POST } = await import('@/app/api/onboarding/complete/route')
    const res = await POST(post({
      brandName:   'TestBrand',
      domain:      'testbrand.com',
      description: 'TestBrand is an AI SEO platform.',
      competitors: ['Semrush', 'Ahrefs', 'Moz'],
    }))
    expect(res.status).toBe(200)
  })
})
