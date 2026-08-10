import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { CLAIM_INTENT_COOKIE, verifyScanClaimIntent } from '@/lib/security/scan-claim-intent'
import { E2E_FIXTURE_SCAN_ID } from '@/lib/e2e-fixtures'

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
    const response = await post('scan-1', { lang: 'en' })

    expect(response.status).toBe(404)
  })

  it('returns 409 when the scan is already owned', async () => {
    nextRows.value = [[{ id: 'scan-1', account_id: 'account-1' }]]
    const response = await post('scan-1', { lang: 'en' })

    expect(response.status).toBe(409)
  })

  it('returns 429 and Retry-After when public rate limiting denies the request', async () => {
    consumePublicScanRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: Math.floor(Date.now() / 1000) + 60 })
    const response = await post('scan-1', { lang: 'en' })

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBeTruthy()
    expect(mockSql).not.toHaveBeenCalled()
  })

  it('sets a short-lived intent cookie for an unowned scan without returning report data', async () => {
    nextRows.value = [[{ id: 'scan-1', account_id: null }]]
    const response = await post('scan-1', { lang: 'en' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    const setCookie = response.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain(`${CLAIM_INTENT_COOKIE}=`)
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toMatch(/SameSite=Lax/i)
    expect(setCookie).toContain('Max-Age=900')
    const token = setCookie.split(`${CLAIM_INTENT_COOKIE}=`)[1].split(';')[0]
    expect(verifyScanClaimIntent(token)).toMatchObject({
      scanId: 'scan-1', lang: 'en', returnPath: '/en/result/scan-1?claim=1',
    })
  })

  it('returns 500 when the scan lookup fails', async () => {
    nextRows.value = [new Error('database connection unavailable') as never]
    const response = await post('scan-1', { lang: 'en' })

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Unable to prepare scan claim' })
  })
})
