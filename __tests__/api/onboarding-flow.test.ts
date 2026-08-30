/**
 * TDD: Onboarding flow — expanded
 * Covers: trial setup, domain/region/description/competitors, idempotency,
 * scan claiming, and the scan -> brand association added alongside
 * scans.client_id (both the new-client and existing-client paths).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { readFileSync } from 'node:fs'

const getProfileMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth', () => ({ getProfile: getProfileMock }))

// Queued-result tagged-template mock, matching __tests__/api/dashboard-clients.test.ts.
// Each call to sql`...` records the query text and shifts the next queued
// result off nextResults; queuing an Error makes that call throw, matching
// how the Neon driver throws in place of supabase-js's { data, error }.
const queries: string[] = []
let nextResults: unknown[][] = []

const mockSql = vi.fn((strings: TemplateStringsArray, ..._values: unknown[]) => {
  queries.push(strings.join('?'))
  const result = nextResults.shift()
  if (result instanceof Error) throw result
  return Promise.resolve(result ?? [])
})

vi.mock('@/lib/db', () => ({ db: () => mockSql }))

vi.mock('@/lib/openrouter', () => ({
  callOpenRouter: vi.fn().mockResolvedValue(
    JSON.stringify([
      { category: 'brand_query', question: 'What is TestBrand?', language: 'en' },
      { category: 'pain_point', question: 'How does TestBrand help with SEO?', language: 'en' },
    ])
  ),
}))

function request(body: unknown) {
  return new NextRequest('http://localhost/api/onboarding/complete', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

describe('POST /api/onboarding/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queries.length = 0
    nextResults = []
    getProfileMock.mockResolvedValue({ account_id: 'acc-1' })
  })

  it('returns 400 when brandName is missing', async () => {
    const { POST } = await import('@/app/api/onboarding/complete/route')
    const res = await POST(request({ domain: 'example.com' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('brandName required')
    expect(mockSql).not.toHaveBeenCalled()
  })

  it('returns 401 when unauthenticated', async () => {
    getProfileMock.mockResolvedValue(null)
    const { POST } = await import('@/app/api/onboarding/complete/route')
    const res = await POST(request({ brandName: 'TestBrand' }))
    expect(res.status).toBe(401)
    expect(mockSql).not.toHaveBeenCalled()
  })

  it('returns 500 without querying clients when the account lookup fails', async () => {
    nextResults = [new Error('connection terminated') as never]
    const { POST } = await import('@/app/api/onboarding/complete/route')
    const res = await POST(request({ brandName: 'TestBrand' }))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Failed to load account')
    expect(queries.some(q => q.includes('clients'))).toBe(false)
  })

  it('returns 500 without querying clients when the trial update fails', async () => {
    nextResults = [
      [{ trial_started_at: null, trial_ends_at: null }],
      new Error('account update failed') as never,
    ]
    const { POST } = await import('@/app/api/onboarding/complete/route')
    const res = await POST(request({ brandName: 'TestBrand' }))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Failed to start trial')
    expect(queries.some(q => q.includes('clients'))).toBe(false)
  })

  it('treats a client lookup error differently from no existing client', async () => {
    nextResults = [
      [{ trial_started_at: null, trial_ends_at: null }],
      [{ id: 'acc-1' }],
      new Error('client read failed') as never,
    ]
    const { POST } = await import('@/app/api/onboarding/complete/route')
    const res = await POST(request({ brandName: 'TestBrand' }))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Failed to load client')
    expect(queries.some(q => q.includes('insert into clients'))).toBe(false)
  })

  it('returns { clientId, trialEndsAt } on success', async () => {
    nextResults = [
      [{ trial_started_at: null, trial_ends_at: null }],
      [{ id: 'acc-1' }],
      [],
      [{ id: 'client-new' }],
    ]
    const { POST } = await import('@/app/api/onboarding/complete/route')
    const res = await POST(request({
      brandName: 'TestBrand', domain: 'testbrand.com', industry: 'technology', region: 'HK',
    }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.clientId).toBe('client-new')
    expect(json.scanId).toBeNull()
    const endsAt = new Date(json.trialEndsAt).getTime()
    expect(endsAt).toBeGreaterThan(Date.now() + SEVEN_DAYS_MS - 60_000)
    expect(endsAt).toBeLessThan(Date.now() + SEVEN_DAYS_MS + 60_000)
  })

  it('returns existing clientId on double-submit (idempotent)', async () => {
    nextResults = [
      [{ trial_started_at: new Date(), trial_ends_at: new Date(Date.now() + 4 * 86_400_000) }],
      [{ id: 'client-existing' }],
    ]
    const { POST } = await import('@/app/api/onboarding/complete/route')
    const res = await POST(request({ brandName: 'TestBrand', domain: 'testbrand.com' }))
    expect(res.status).toBe(200)
    expect((await res.json()).clientId).toBe('client-existing')
  })

  it('does NOT reset trial dates on double-submit', async () => {
    const trialEndsAt = new Date(Date.now() + 4 * 86_400_000)
    nextResults = [
      [{ trial_started_at: new Date(Date.now() - 3 * 86_400_000), trial_ends_at: trialEndsAt }],
      [{ id: 'client-existing' }],
    ]
    const { POST } = await import('@/app/api/onboarding/complete/route')
    const res = await POST(request({ brandName: 'TestBrand' }))
    expect(res.status).toBe(200)
    expect((await res.json()).trialEndsAt).toBe(trialEndsAt.toISOString())
    expect(queries.some(q => q.includes('update accounts'))).toBe(false)
  })

  it('repairs a missing stored trial expiry without resetting the start date', async () => {
    const trialStartedAt = new Date('2026-07-01T00:00:00.000Z')
    const expectedTrialEndsAt = '2026-07-08T00:00:00.000Z'
    nextResults = [
      [{ trial_started_at: trialStartedAt, trial_ends_at: null }],
      [{ id: 'acc-1' }],
      [{ id: 'client-existing' }],
    ]
    const { POST } = await import('@/app/api/onboarding/complete/route')
    const res = await POST(request({ brandName: 'TestBrand' }))
    expect(res.status).toBe(200)
    expect((await res.json()).trialEndsAt).toBe(expectedTrialEndsAt)
    expect(queries.filter(q => q.includes('update accounts'))).toHaveLength(1)
  })

  it('accepts a stored trial expiry given as an ISO string, not just a Date', async () => {
    // The Neon driver returns timestamptz as a Date, but a row written before
    // the migration (or a test fixture) may still hand back a plain string.
    nextResults = [
      [{ trial_started_at: '2026-07-01T00:00:00.000Z', trial_ends_at: '2026-07-08T00:00:00.000Z' }],
      [{ id: 'client-existing' }],
    ]
    const { POST } = await import('@/app/api/onboarding/complete/route')
    const res = await POST(request({ brandName: 'TestBrand' }))
    expect(res.status).toBe(200)
    expect((await res.json()).trialEndsAt).toBe('2026-07-08T00:00:00.000Z')
    expect(queries.some(q => q.includes('update accounts'))).toBe(false)
  })

  it('maps a BRAND_LIMIT_REACHED trigger error to 403, matching dashboard/clients', async () => {
    nextResults = [
      [{ trial_started_at: new Date(), trial_ends_at: new Date(Date.now() + 4 * 86_400_000) }],
      [],
      new Error('BRAND_LIMIT_REACHED') as never,
    ]
    const { POST } = await import('@/app/api/onboarding/complete/route')
    const res = await POST(request({ brandName: 'Fourth Brand' }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('BRAND_LIMIT_REACHED')
  })

  it('returns 500, not a silent success, when client creation fails for another reason', async () => {
    nextResults = [
      [{ trial_started_at: new Date(), trial_ends_at: new Date(Date.now() + 4 * 86_400_000) }],
      [],
      new Error('connection terminated') as never,
    ]
    const { POST } = await import('@/app/api/onboarding/complete/route')
    const res = await POST(request({ brandName: 'TestBrand' }))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Failed to create client')
  })

  it('accepts description and competitors without error, passed as text[] not jsonb', async () => {
    nextResults = [
      [{ trial_started_at: null, trial_ends_at: null }],
      [{ id: 'acc-1' }],
      [],
      [{ id: 'client-new' }],
    ]
    const { POST } = await import('@/app/api/onboarding/complete/route')
    const res = await POST(request({
      brandName: 'TestBrand',
      domain: 'testbrand.com',
      description: 'TestBrand is an AI SEO platform.',
      competitors: ['Semrush', 'Ahrefs', 'Moz'],
    }))
    expect(res.status).toBe(200)
    const insertQuery = queries.find(q => q.includes('insert into clients'))
    expect(insertQuery).toContain('::text[]')
  })

  it('claims a supplied scan before returning an existing client, and associates it with the brand', async () => {
    nextResults = [
      [{ id: 'scan-1' }], // claim: update matched -> claimed
      [{ trial_started_at: new Date(), trial_ends_at: new Date(Date.now() + 4 * 86_400_000) }],
      [{ id: 'client-existing' }],
      [], // scan -> client_id association update
    ]
    const { POST } = await import('@/app/api/onboarding/complete/route')
    const res = await POST(request({ brandName: 'TestBrand', scanId: 'scan-1' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toMatchObject({ clientId: 'client-existing', scanId: 'scan-1' })
    const assocQuery = queries.find(q => q.includes('update scans set client_id'))
    expect(assocQuery).toBeDefined()
    expect(assocQuery).toContain('client_id is null')
  })

  it('associates a supplied scan with a newly-created brand too', async () => {
    nextResults = [
      [{ id: 'scan-1' }], // claim: update matched -> claimed
      [{ trial_started_at: null, trial_ends_at: null }],
      [{ id: 'acc-1' }],
      [], // no existing client
      [{ id: 'client-new' }], // insert clients
      [], // scan -> client_id association update
    ]
    const { POST } = await import('@/app/api/onboarding/complete/route')
    const res = await POST(request({ brandName: 'TestBrand', scanId: 'scan-1' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toMatchObject({ clientId: 'client-new', scanId: 'scan-1' })
    const assocIdx = queries.findIndex(q => q.includes('update scans set client_id'))
    const insertIdx = queries.findIndex(q => q.includes('insert into clients'))
    expect(assocIdx).toBeGreaterThan(insertIdx)
  })

  it('returns 409 without querying clients when a supplied scan has another owner', async () => {
    nextResults = [
      [], // claim: update matched nothing
      [{ account_id: 'acc-2' }], // claim: re-read shows a different owner
    ]
    const { POST } = await import('@/app/api/onboarding/complete/route')
    const res = await POST(request({ brandName: 'TestBrand', scanId: 'scan-1' }))
    expect(res.status).toBe(409)
    expect(queries.some(q => q.includes('clients'))).toBe(false)
  })

  it('returns 404 when a supplied scan is missing', async () => {
    nextResults = [[], []]
    const { POST } = await import('@/app/api/onboarding/complete/route')
    const res = await POST(request({ brandName: 'TestBrand', scanId: 'missing-scan' }))
    expect(res.status).toBe(404)
    expect(queries.some(q => q.includes('clients'))).toBe(false)
  })

  it('returns 500 when the scan claim query itself throws', async () => {
    nextResults = [new Error('connection terminated') as never]
    const { POST } = await import('@/app/api/onboarding/complete/route')
    const res = await POST(request({ brandName: 'TestBrand', scanId: 'scan-1' }))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Failed to claim scan')
  })

  it('returns 500 (the tenant FK rejecting a mismatch) when a new client cannot be associated with the scan', async () => {
    nextResults = [
      [{ id: 'scan-1' }],
      [{ trial_started_at: null, trial_ends_at: null }],
      [{ id: 'acc-1' }],
      [],
      [{ id: 'client-new' }],
      new Error('violates foreign key constraint "scans_client_tenant_fkey"') as never,
    ]
    const { POST } = await import('@/app/api/onboarding/complete/route')
    const res = await POST(request({ brandName: 'TestBrand', scanId: 'scan-1' }))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Failed to associate scan with client')
  })

  it('a failed OpenRouter call still returns the created client', async () => {
    const { callOpenRouter } = await import('@/lib/openrouter')
    vi.mocked(callOpenRouter).mockRejectedValueOnce(new Error('OpenRouter 500'))
    nextResults = [
      [{ trial_started_at: null, trial_ends_at: null }],
      [{ id: 'acc-1' }],
      [],
      [{ id: 'client-new' }],
    ]
    const { POST } = await import('@/app/api/onboarding/complete/route')
    const res = await POST(request({ brandName: 'TestBrand' }))
    expect(res.status).toBe(200)
    expect((await res.json()).clientId).toBe('client-new')
  })

  // The generated bank is the only thing that ever writes prompt_bank.category,
  // and the column has no CHECK, so whatever the model returns used to become
  // the vocabulary. A category outside the four lands in a section the question
  // bank editor cannot offer an add row for.
  describe('generated prompt categories', () => {
    async function runWithGenerated(generated: unknown) {
      const { callOpenRouter } = await import('@/lib/openrouter')
      vi.mocked(callOpenRouter).mockResolvedValueOnce(JSON.stringify(generated))
      nextResults = [
        [{ trial_started_at: null, trial_ends_at: null }],
        [{ id: 'acc-1' }],
        [],
        [{ id: 'client-new' }],
      ]
      const { POST } = await import('@/app/api/onboarding/complete/route')
      await POST(request({ brandName: 'TestBrand' }))
      const insert = mockSql.mock.calls.find(
        ([strings]) => /insert into prompt_bank/i.test((strings as TemplateStringsArray).join('?')),
      )
      // Params are (clientId, categories[], questions[], languages[]) — the
      // categories array is the second interpolation, not the first.
      return insert ? (insert[2] as string[]) : null
    }

    it('drops a category the model invented rather than storing it', async () => {
      const categories = await runWithGenerated([
        { category: 'brand_query', question: 'Kept?', language: 'en' },
        { category: 'Brand Queries', question: 'Invented label', language: 'en' },
        { category: 'competitor_query', question: 'Invented category', language: 'en' },
        { category: 'pain_point', question: 'Also kept?', language: 'en' },
      ])

      expect(categories).toEqual(['brand_query', 'pain_point'])
    })

    it('drops a row with a missing category rather than writing NULL', async () => {
      const categories = await runWithGenerated([
        { question: 'No category', language: 'en' },
        { category: 'intent_query', question: 'Kept?', language: 'en' },
      ])

      expect(categories).toEqual(['intent_query'])
    })

    it('writes nothing at all when every generated row is unusable', async () => {
      const categories = await runWithGenerated([
        { category: 'nonsense', question: 'q', language: 'en' },
      ])

      expect(categories).toBeNull()
    })

    it('still returns the created client when the whole bank is dropped', async () => {
      const { callOpenRouter } = await import('@/lib/openrouter')
      vi.mocked(callOpenRouter).mockResolvedValueOnce(
        JSON.stringify([{ category: 'nonsense', question: 'q', language: 'en' }]),
      )
      nextResults = [
        [{ trial_started_at: null, trial_ends_at: null }],
        [{ id: 'acc-1' }],
        [],
        [{ id: 'client-new' }],
      ]
      const { POST } = await import('@/app/api/onboarding/complete/route')
      const res = await POST(request({ brandName: 'TestBrand' }))

      expect(res.status).toBe(200)
      expect((await res.json()).clientId).toBe('client-new')
    })
  })

  it('starts a pre-filled scan onboarding at step 3 and reuses the completed report', () => {
    const wizard = readFileSync('components/onboarding/OnboardingWizard.tsx', 'utf8')
    expect(wizard).toContain('const hasScanPrefill = Boolean(scanId && initialBrand && initialDomain)')
    expect(wizard).toContain('useState(hasScanPrefill ? 3 : 1)')
    expect(wizard).toContain('/result/')
    expect(wizard).not.toContain("fetch('/api/scan'")
  })
})
