import { POST } from '@/app/api/onboarding/complete/route'
import { NextRequest } from 'next/server'

const { mockGetProfile, sqlMock, inserts, updates } = vi.hoisted(() => ({
  mockGetProfile: vi.fn(),
  sqlMock: vi.fn(),
  inserts: [] as Array<{ table: string; payload: unknown }>,
  updates: [] as Array<{ table: string; payload: unknown }>,
}))

// Auth gate — session-derived profile (never body-derived)
vi.mock('@/lib/auth', () => ({ getProfile: mockGetProfile }))

// Tagged-template SQL mock: sql`select id from clients where account_id = ${id}`
vi.mock('@/lib/db', () => ({ db: () => sqlMock }))

// Mock Supabase server client (writes still go through it — see route TODO)
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
    JSON.stringify([{ category: 'brand_query', question: 'What is TestBrand?', language: 'en' }])
  ),
}))

const profileFixture = {
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
    plan: 'basic',
    status: 'trialing',
    trial_started_at: null,
    trial_ends_at: null,
    trial_emails_sent: 0,
    created_at: '2026-01-01T00:00:00.000Z',
  },
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
    inserts.length = 0
    updates.length = 0
    mockGetProfile.mockResolvedValue(structuredClone(profileFixture))
    sqlMock.mockReset()
    sqlMock.mockResolvedValue([])
  })

  it('returns 400 when brandName is missing', async () => {
    const res = await POST(post({ domain: 'test.com' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('brandName required')
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetProfile.mockResolvedValueOnce(null)
    const res = await POST(post({ brandName: 'Test', domain: 'test.com' }))
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe('Unauthorized')
  })

  it('does not call OpenRouter or write anything when unauthenticated', async () => {
    const { callOpenRouter } = await import('@/lib/openrouter')
    mockGetProfile.mockResolvedValueOnce(null)
    await POST(post({ brandName: 'Test', domain: 'test.com' }))
    expect(callOpenRouter).not.toHaveBeenCalled()
    expect(sqlMock).not.toHaveBeenCalled()
    expect(inserts).toHaveLength(0)
    expect(updates).toHaveLength(0)
  })

  it('binds the new client to the session account, ignoring body account_id', async () => {
    const res = await POST(post({
      brandName: 'TestBrand',
      domain: 'test.com',
      account_id: 'attacker-account',
      accountId: 'attacker-account',
    }))
    expect(res.status).toBe(200)
    const clientInsert = inserts.find(i => i.table === 'clients')
    expect(clientInsert).toBeDefined()
    expect((clientInsert!.payload as { account_id: string }).account_id).toBe('acc-1')
  })

  it('only claims a scan that is unclaimed or already owned by this account', async () => {
    const res = await POST(post({ brandName: 'TestBrand', scanId: 'scan-1' }))
    expect(res.status).toBe(200)
    const scanUpdate = sqlMock.mock.calls.find(
      ([strings]: [TemplateStringsArray]) => strings.join('?').includes('update scans')
    )
    expect(scanUpdate).toBeDefined()
    const query = (scanUpdate![0] as TemplateStringsArray).join('?')
    expect(query).toContain('account_id is null or account_id =')
    // Parameterised values: accountId, scanId, accountId
    expect(scanUpdate!.slice(1)).toEqual(['acc-1', 'scan-1', 'acc-1'])
  })
})
