import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { signScanClaimIntent } from '@/lib/security/scan-claim-intent'

const getProfileMock = vi.hoisted(() => vi.fn())

const queries: string[] = []
let attemptWon = true
let attemptThrows = false
let nextResults: unknown[][] = []

const mockSql = vi.fn((strings: TemplateStringsArray) => {
  // The single-use attempt insert (AC-03, migration 052) runs on every claim
  // and belongs to no test's queued sequence. It is answered before `queries`
  // is touched, so it neither shifts the queue nor shifts the positional
  // indices every expectation below is written against.
  if (/insert into scan_claim_attempts/i.test(strings.join('?'))) {
    if (attemptThrows) return Promise.reject(new Error('connection terminated unexpectedly'))
    return Promise.resolve(attemptWon ? [{ attempt_id: 'a' }] : [])
  }
  queries.push(strings.join('?'))
  const result = nextResults.shift()
  if (result instanceof Error) throw result
  return Promise.resolve(result ?? [])
})

vi.mock('@/lib/auth', () => ({ getProfile: getProfileMock }))
vi.mock('@/lib/db', () => ({ db: () => mockSql }))

function claimIntent(scanId = '11111111-1111-4111-8111-111111111111', overrides: Partial<{ lang: 'en' | 'zh-HK'; returnPath: string }> = {}) {
  return signScanClaimIntent({
    scanId,
    lang: overrides.lang ?? 'en',
    returnPath: overrides.returnPath ?? `/en/result/${encodeURIComponent(scanId)}?claim=1`,
    attemptId: '44444444-4444-4444-8444-444444444444',
  })
}

async function claim(scanId = '11111111-1111-4111-8111-111111111111', intent?: string) {
  const { POST } = await import('@/app/api/scans/[id]/claim/route')
  return POST(new NextRequest(`http://localhost/api/scans/${scanId}/claim`, {
    method: 'POST',
    headers: intent ? { Cookie: `fimmick_scan_claim_intent=${intent}` } : undefined,
  }), {
    params: Promise.resolve({ id: scanId }),
  })
}

describe('POST /api/scans/[id]/claim', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queries.length = 0
    nextResults = []
    getProfileMock.mockResolvedValue({ account_id: 'account-1' })
    process.env.REPORT_SHARE_SECRET = 'x'.repeat(32)
    attemptWon = true
    attemptThrows = false
  })

  it('claims an unowned scan when a matching intent cookie is present', async () => {
    nextResults = [[{ id: '11111111-1111-4111-8111-111111111111' }]]

    const response = await claim('11111111-1111-4111-8111-111111111111', claimIntent())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, alreadyOwned: false })
    expect(getProfileMock).toHaveBeenCalledOnce()
    expect(queries).toHaveLength(1)
  })

  // The absent-cookie case used to be the permissive one: verification ran only
  // `if (token)`, so sending no cookie skipped it and the scan was claimed. That
  // is foreign-scan takeover by omission, so it is now asserted as a denial.
  it('separates an unavailable auth service from an absent session', async () => {
    // getProfile throws when the auth dependency is down -- an empty
    // NEON_AUTH_COOKIE_SECRET is enough -- and that used to escape as a bare 500
    // with an empty body. Found by running the route against a real stack, where
    // every authenticated call returned 500 instead of saying what was wrong.
    getProfileMock.mockRejectedValueOnce(new Error('Neon Auth unavailable'))

    const response = await claim('11111111-1111-4111-8111-111111111111', claimIntent())

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Claim unavailable' })
    expect(mockSql).not.toHaveBeenCalled()
  })

  it('denies a claim when the intent cookie is absent, without querying', async () => {
    const response = await claim()

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Claim unavailable' })
    expect(mockSql).not.toHaveBeenCalled()
  })

  it('denies an authenticated user claiming a foreign scan they hold no intent for', async () => {
    // The attacker holds a legitimate intent for their own scan-1 and aims it at
    // someone else's scan-2. The scan id is bound into the signature, so the
    // token cannot be retargeted.
    const response = await claim('22222222-2222-4222-8222-222222222222', claimIntent('11111111-1111-4111-8111-111111111111'))

    expect(response.status).toBe(403)
    expect(mockSql).not.toHaveBeenCalled()
  })

  it('returns a fixed response without querying when the intent cookie is tampered', async () => {
    const response = await claim('11111111-1111-4111-8111-111111111111', `${claimIntent()}x`)

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Claim unavailable' })
    expect(mockSql).not.toHaveBeenCalled()
  })

  it('rejects expired and mismatched claim intents before querying', async () => {
    const expired = signScanClaimIntent({
      scanId: '11111111-1111-4111-8111-111111111111', lang: 'en', returnPath: '/en/result/scan-1?claim=1', attemptId: '44444444-4444-4444-8444-444444444444',
    }, Date.now() - (16 * 60 * 1000))

    const expiredResponse = await claim('11111111-1111-4111-8111-111111111111', expired)
    const mismatchResponse = await claim('11111111-1111-4111-8111-111111111111', claimIntent('22222222-2222-4222-8222-222222222222'))

    expect(expiredResponse.status).toBe(403)
    expect(mismatchResponse.status).toBe(403)
    expect(mockSql).not.toHaveBeenCalled()
  })

  it('rejects an intent whose canonical return path does not match the scan', async () => {
    const mismatchedReturnPath = claimIntent('11111111-1111-4111-8111-111111111111', { returnPath: '/en/result/scan-2?claim=1' })

    const response = await claim('11111111-1111-4111-8111-111111111111', mismatchedReturnPath)

    expect(response.status).toBe(403)
    expect(mockSql).not.toHaveBeenCalled()
  })

  it('returns 401 when no profile exists after a valid intent', async () => {
    getProfileMock.mockResolvedValue(null)

    const response = await claim('11111111-1111-4111-8111-111111111111', claimIntent())

    expect(response.status).toBe(401)
    expect(mockSql).not.toHaveBeenCalled()
  })

  it('claims an unowned scan for the authenticated account', async () => {
    nextResults = [[{ id: '11111111-1111-4111-8111-111111111111' }]]

    const response = await claim('11111111-1111-4111-8111-111111111111', claimIntent())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, alreadyOwned: false })
    expect(queries[0]).toContain('account_id is null')
    expect(response.headers.get('set-cookie')).toContain('fimmick_scan_claim_intent=;')
  })

  it('returns ok when the scan already belongs to the same account', async () => {
    nextResults = [[], [{ account_id: 'account-1' }]]

    const response = await claim('11111111-1111-4111-8111-111111111111', claimIntent())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, alreadyOwned: true })
    expect(queries).toHaveLength(2)
    expect(response.headers.get('set-cookie')).toContain('fimmick_scan_claim_intent=;')
  })

  it('returns 409 when the scan belongs to another account', async () => {
    nextResults = [[], [{ account_id: 'account-2' }]]

    const response = await claim('11111111-1111-4111-8111-111111111111', claimIntent())

    expect(response.status).toBe(409)
    expect(response.headers.get('set-cookie')).toContain('fimmick_scan_claim_intent=;')
  })

  it('returns 404 when the scan does not exist', async () => {
    nextResults = [[], []]

    const response = await claim('11111111-1111-4111-8111-111111111111', claimIntent())

    expect(response.status).toBe(404)
    expect(response.headers.get('set-cookie')).toContain('fimmick_scan_claim_intent=;')
  })

  it('returns 500 when the update query throws', async () => {
    nextResults = [new Error('connection terminated') as never]

    const response = await claim('11111111-1111-4111-8111-111111111111', claimIntent())

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to claim scan' })
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('returns 500 when the re-read after a no-op update throws', async () => {
    nextResults = [[], new Error('connection terminated') as never]

    const response = await claim('11111111-1111-4111-8111-111111111111', claimIntent())

    expect(response.status).toBe(500)
  })

  it('degrades to a fixed response when the signing secret is unusable', async () => {
    // verifyScanClaimIntent calls the secret accessor inside its own try/catch
    // and returns null, so a missing or too-short REPORT_SHARE_SECRET can never
    // escape this handler as an unhandled 500. Pinned because the route calls it
    // unwrapped — if a refactor ever lets it throw, that becomes a crash.
    const token = claimIntent()
    process.env.REPORT_SHARE_SECRET = 'too-short'

    const response = await claim('11111111-1111-4111-8111-111111111111', token)

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Claim unavailable' })
    expect(mockSql).not.toHaveBeenCalled()
  })
})

/**
 * Single-use claim intents (AC-03).
 *
 * The signature proved the cookie was ours. It never proved this was the
 * first presentation of it, so a copy claimed the scan again on every replay
 * inside the 15-minute window. Migration 052 records the attempt; these are
 * the two answers the route must give once it does.
 */
describe('POST /api/scans/[id]/claim — replay', () => {
  const SCAN = '11111111-1111-4111-8111-111111111111'

  beforeEach(() => {
    getProfileMock.mockResolvedValue({ account_id: 'account-1' })
    process.env.REPORT_SHARE_SECRET = 'x'.repeat(32)
  })

  it('denies a replayed intent, and never reaches the claim', async () => {
    attemptWon = false
    nextResults = [[{ id: SCAN }]]

    const response = await claim(SCAN, claimIntent())

    expect(response.status).toBe(403)
    // Indistinguishable from a forged token: a replay must not be a signal.
    expect(await response.json()).toEqual({ error: 'Claim unavailable' })
    expect(queries).toHaveLength(0)
  })

  /**
   * Fails closed. If the attempt cannot be recorded, allowing the claim would
   * let every replay through for the duration of the outage — so an outage
   * answers 503, which is a different fact from a denial and says so.
   */
  it('answers 503 when the attempt cannot be recorded, and claims nothing', async () => {
    attemptThrows = true
    nextResults = [[{ id: SCAN }]]

    const response = await claim(SCAN, claimIntent())

    expect(response.status).toBe(503)
    expect(queries).toHaveLength(0)
  })
})
