/**
 * TDD: Onboarding flow — expanded
 * Covers: trial setup (via ensureTrialForAccount), the rescue path, brand
 * creation (via createBrandForAccount), domain/region/description/competitors,
 * idempotency, scan claiming, and the scan -> brand association added
 * alongside scans.client_id (both the new-client and existing-client paths).
 *
 * Query order, positional per the mock below: claim (if scanId) -> trial
 * grant (ensureTrialForAccount, always exactly one query) -> existing-client
 * select -> [only when no existing client: createBrandForAccount's own
 * account select, brand count, and CTE insert] -> scan stamp -> prompt bank
 * insert (non-fatal, result ignored).
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
// A query issued after the fixture array is exhausted gets `[]` — harmless
// for calls whose return value isn't inspected (e.g. the prompt_bank insert).
const queries: string[] = []
let nextResults: unknown[][] = []

const mockSql = vi.fn((strings: TemplateStringsArray) => {
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

// A full accounts row, shaped the way createBrandForAccount's own SELECT
// returns it, for resolveCommercialEntitlement() to resolve against.
function accountRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'acc-1', plan: 'basic', status: 'active', stripe_subscription_id: 'sub_1',
    trial_started_at: null, trial_ends_at: null, override_plan: null, override_expires_at: null,
    ...overrides,
  }
}

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

  it('returns 500 without querying clients when the trial grant fails', async () => {
    // ensureTrialForAccount is a single UPDATE ... RETURNING; a rejected
    // driver call (or the account not being found) surfaces here directly —
    // there is no longer a separate "load account" query ahead of it.
    nextResults = [new Error('connection terminated') as never]
    const { POST } = await import('@/app/api/onboarding/complete/route')
    const res = await POST(request({ brandName: 'TestBrand' }))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Failed to start trial')
    expect(queries.some(q => q.includes('clients'))).toBe(false)
  })

  it('rescues a stranded account (brand exists, no trial) by granting the trial on re-submit', async () => {
    // The regression test for the rescue path: an account that already has
    // a brand but somehow never got a trial (e.g. an old provisioning bug)
    // can self-rescue by re-submitting onboarding, because the trial grant
    // runs before the existing-client guard.
    const grantedTrialEndsAt = new Date(Date.now() + SEVEN_DAYS_MS)
    nextResults = [
      [{ trial_ends_at: grantedTrialEndsAt }], // ensureTrialForAccount grants the missing trial
      [{ id: 'client-existing' }], // the account already has a brand
    ]
    const { POST } = await import('@/app/api/onboarding/complete/route')
    const res = await POST(request({ brandName: 'TestBrand' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.clientId).toBe('client-existing')
    expect(json.trialEndsAt).toBe(grantedTrialEndsAt.toISOString())
    // The trial grant is the very first query, ahead of the client guard.
    expect(queries[0]).toContain('update accounts')
    expect(queries[0]).toContain('trial_started_at')
  })

  it('treats a client lookup error differently from no existing client', async () => {
    nextResults = [
      [{ trial_ends_at: new Date() }], // ensureTrialForAccount
      new Error('client read failed') as never,
    ]
    const { POST } = await import('@/app/api/onboarding/complete/route')
    const res = await POST(request({ brandName: 'TestBrand' }))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Failed to load client')
    expect(queries.some(q => q.includes('insert into clients'))).toBe(false)
  })

  it('returns { clientId, trialEndsAt } on success', async () => {
    const grantedTrialEndsAt = new Date(Date.now() + SEVEN_DAYS_MS)
    nextResults = [
      [{ trial_ends_at: grantedTrialEndsAt }], // ensureTrialForAccount
      [], // no existing client
      [accountRow()], // createBrandForAccount: account select
      [{ n: 0 }], // createBrandForAccount: brand count
      [{ client_id: 'client-new', trial_ends_at: grantedTrialEndsAt }], // createBrandForAccount: CTE insert
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
      [{ trial_ends_at: new Date(Date.now() + 4 * 86_400_000) }], // ensureTrialForAccount (no-op)
      [{ id: 'client-existing' }],
    ]
    const { POST } = await import('@/app/api/onboarding/complete/route')
    const res = await POST(request({ brandName: 'TestBrand', domain: 'testbrand.com' }))
    expect(res.status).toBe(200)
    expect((await res.json()).clientId).toBe('client-existing')
  })

  it('returns the stored trial expiry unchanged on double-submit (coalesce no-ops)', async () => {
    // ensureTrialForAccount always issues its single UPDATE, even when
    // trial_started_at/trial_ends_at are already set — the coalesce in its
    // SET clause is what makes that a no-op server-side, not an extra branch
    // in the route. What matters here is the value the route reports back.
    const trialEndsAt = new Date(Date.now() + 4 * 86_400_000)
    nextResults = [
      [{ trial_ends_at: trialEndsAt }],
      [{ id: 'client-existing' }],
    ]
    const { POST } = await import('@/app/api/onboarding/complete/route')
    const res = await POST(request({ brandName: 'TestBrand' }))
    expect(res.status).toBe(200)
    expect((await res.json()).trialEndsAt).toBe(trialEndsAt.toISOString())
    expect(queries).toHaveLength(2)
  })

  it('accepts a stored trial expiry given as an ISO string, not just a Date', async () => {
    // The Neon driver returns timestamptz as a Date, but a row written before
    // the migration (or a test fixture) may still hand back a plain string.
    // ensureTrialForAccount itself normalizes this (see brand-trial.test.ts);
    // here we only need the route to pass the value through untouched.
    nextResults = [
      [{ trial_ends_at: '2026-07-08T00:00:00.000Z' }],
      [{ id: 'client-existing' }],
    ]
    const { POST } = await import('@/app/api/onboarding/complete/route')
    const res = await POST(request({ brandName: 'TestBrand' }))
    expect(res.status).toBe(200)
    expect((await res.json()).trialEndsAt).toBe('2026-07-08T00:00:00.000Z')
  })

  it('maps a BRAND_LIMIT_REACHED trigger error to 403 with plan and limit, matching dashboard/clients', async () => {
    nextResults = [
      [{ trial_ends_at: new Date(Date.now() + 4 * 86_400_000) }], // ensureTrialForAccount
      [], // no existing client
      [accountRow()], // createBrandForAccount: account select
      [{ n: 0 }], // createBrandForAccount: brand count (advisory check passes)
      new Error('violates check constraint "BRAND_LIMIT_REACHED"') as never, // CTE insert: trigger raises on the race
    ]
    const { POST } = await import('@/app/api/onboarding/complete/route')
    const res = await POST(request({ brandName: 'Fourth Brand' }))
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json).toMatchObject({ error: 'BRAND_LIMIT_REACHED', plan: 'basic', limit: 1 })
  })

  it('returns 500, not a silent success, when client creation fails for another reason', async () => {
    nextResults = [
      [{ trial_ends_at: new Date(Date.now() + 4 * 86_400_000) }],
      [],
      [accountRow()],
      [{ n: 0 }],
      new Error('connection terminated') as never,
    ]
    const { POST } = await import('@/app/api/onboarding/complete/route')
    const res = await POST(request({ brandName: 'TestBrand' }))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Failed to create client')
  })

  it('accepts description and competitors without error, passed as text[] not jsonb', async () => {
    nextResults = [
      [{ trial_ends_at: new Date() }],
      [],
      [accountRow()],
      [{ n: 0 }],
      [{ client_id: 'client-new', trial_ends_at: new Date() }],
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
      [{ trial_ends_at: new Date(Date.now() + 4 * 86_400_000) }], // ensureTrialForAccount
      [{ id: 'client-existing' }], // existing client found
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
      [{ trial_ends_at: new Date() }], // ensureTrialForAccount
      [], // no existing client
      [accountRow()], // createBrandForAccount: account select
      [{ n: 0 }], // createBrandForAccount: brand count
      [{ client_id: 'client-new', trial_ends_at: new Date() }], // createBrandForAccount: CTE insert
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
      [{ trial_ends_at: new Date() }],
      [],
      [accountRow()],
      [{ n: 0 }],
      [{ client_id: 'client-new', trial_ends_at: new Date() }],
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
      [{ trial_ends_at: new Date() }],
      [],
      [accountRow()],
      [{ n: 0 }],
      [{ client_id: 'client-new', trial_ends_at: new Date() }],
    ]
    const { POST } = await import('@/app/api/onboarding/complete/route')
    const res = await POST(request({ brandName: 'TestBrand' }))
    expect(res.status).toBe(200)
    expect((await res.json()).clientId).toBe('client-new')
  })

  it('starts a pre-filled scan onboarding at step 3 and reuses the completed report', () => {
    const wizard = readFileSync('components/onboarding/OnboardingWizard.tsx', 'utf8')
    expect(wizard).toContain('const hasScanPrefill = Boolean(scanId && initialBrand && initialDomain)')
    expect(wizard).toContain('useState(hasScanPrefill ? 3 : 1)')
    expect(wizard).toContain('/result/')
    expect(wizard).not.toContain("fetch('/api/scan'")
  })
})
