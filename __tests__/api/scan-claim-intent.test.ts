import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { CLAIM_INTENT_COOKIE, verifyScanClaimIntent } from '@/lib/security/scan-claim-intent'
import { E2E_FIXTURE_SCAN_ID } from '@/lib/e2e-fixtures'

// A well-formed uuid, distinct from E2E_FIXTURE_SCAN_ID: since the route now
// validates scans.id's shape before ever reaching the (mocked) database, every
// fixture that should reach the mock needs to look like a real id, not the
// placeholder 'scan-1' this file used before that validation existed.
const SCAN_ID = '11111111-2222-4333-8444-555555555555'

const consumePublicScanRateLimit = vi.hoisted(() => vi.fn())
const nextRows = vi.hoisted(() => ({ value: [] as unknown[][] }))
const mockSql = vi.hoisted(() => vi.fn(() => {
  const result = nextRows.value.shift()
  if (result instanceof Error) throw result
  return Promise.resolve(result ?? [])
}))

vi.mock('@/lib/db', () => ({ db: () => mockSql }))
vi.mock('@/lib/security/public-scan-rate-limit', () => ({ consumePublicScanRateLimit }))

async function post(id: string, body: unknown) {
  const { POST } = await import('@/app/api/scans/[id]/claim-intent/route')
  return POST(new NextRequest(`http://localhost/api/scans/${id}/claim-intent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id }) })
}

describe('POST /api/scans/[id]/claim-intent', () => {
  beforeEach(() => {
    vi.stubEnv('REPORT_SHARE_SECRET', 'x'.repeat(32))
    vi.clearAllMocks()
    nextRows.value = []
    consumePublicScanRateLimit.mockResolvedValue({ allowed: true, remaining: 4, resetAt: 2_000_000_000 })
  })

  afterEach(() => vi.unstubAllEnvs())

  it('returns 400 for an invalid locale before rate limiting or database work', async () => {
    const response = await post('scan-1', { lang: 'fr' })

    expect(response.status).toBe(400)
    expect(consumePublicScanRateLimit).not.toHaveBeenCalled()
    expect(mockSql).not.toHaveBeenCalled()
  })

  it('returns 400 for a malformed scan id before rate limiting or database work', async () => {
    // scans.id is a strict `uuid` column (supabase/migrations/001_phase1.sql).
    // Before this validation existed, a non-UUID id (e.g. a bot probing the
    // public route, or a stray path segment) reached the query unchecked,
    // Postgres raised "invalid input syntax for type uuid", and the route's
    // blanket catch turned that into an opaque 500 with the real cause
    // discarded -- exactly what production logs showed starting 2026-08-14.
    const response = await post('not-a-real-uuid', { lang: 'en' })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Invalid scan id' })
    expect(consumePublicScanRateLimit).not.toHaveBeenCalled()
    expect(mockSql).not.toHaveBeenCalled()
  })

  it('returns a signed intent for the deterministic E2E fixture without provider work', async () => {
    vi.stubEnv('E2E_FIXTURE_MODE', '1')

    const response = await post(E2E_FIXTURE_SCAN_ID, { lang: 'en' })

    expect(response.status).toBe(200)
    expect(consumePublicScanRateLimit).not.toHaveBeenCalled()
    expect(mockSql).not.toHaveBeenCalled()
    const setCookie = response.headers.get('set-cookie') ?? ''
    const token = setCookie.split(`${CLAIM_INTENT_COOKIE}=`)[1].split(';')[0]
    expect(verifyScanClaimIntent(token)).toMatchObject({
      scanId: E2E_FIXTURE_SCAN_ID,
      lang: 'en',
      returnPath: `/en/result/${E2E_FIXTURE_SCAN_ID}?claim=1`,
    })
  })

  it('returns 404 when the scan does not exist', async () => {
    nextRows.value = [[]]
    const response = await post(SCAN_ID, { lang: 'en' })

    expect(response.status).toBe(404)
  })

  it('returns 409 when the scan is already owned', async () => {
    nextRows.value = [[{ id: SCAN_ID, account_id: 'account-1' }]]
    const response = await post(SCAN_ID, { lang: 'en' })

    expect(response.status).toBe(409)
  })

  it('returns 429 and Retry-After when public rate limiting denies the request', async () => {
    consumePublicScanRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: Math.floor(Date.now() / 1000) + 60 })
    const response = await post(SCAN_ID, { lang: 'en' })

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBeTruthy()
    expect(mockSql).not.toHaveBeenCalled()
  })

  it('sets a short-lived intent cookie for an unowned scan without returning report data', async () => {
    nextRows.value = [[{ id: SCAN_ID, account_id: null }]]
    const response = await post(SCAN_ID, { lang: 'en' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    const setCookie = response.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain(`${CLAIM_INTENT_COOKIE}=`)
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toMatch(/SameSite=Lax/i)
    expect(setCookie).toContain('Max-Age=900')
    const token = setCookie.split(`${CLAIM_INTENT_COOKIE}=`)[1].split(';')[0]
    expect(verifyScanClaimIntent(token)).toMatchObject({
      scanId: SCAN_ID, lang: 'en', returnPath: `/en/result/${SCAN_ID}?claim=1`,
    })
  })

  it('returns 500 when the scan lookup fails', async () => {
    nextRows.value = [new Error('database connection unavailable') as never]
    const response = await post(SCAN_ID, { lang: 'en' })

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Unable to prepare scan claim' })
  })
})
