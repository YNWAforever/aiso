import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { buildAuthCompleteUrl } from '@/lib/auth-client'
import { canViewFullResult } from '@/lib/result-access'
import * as accountUnlock from '@/components/result/AccountUnlockCard'

const boundary = vi.hoisted(() => ({ sql: vi.fn(), profile: vi.fn() }))
vi.mock('@neondatabase/auth/next', () => ({ createAuthClient: () => ({}) }))
vi.mock('@/lib/db', () => ({ db: () => boundary.sql }))
vi.mock('@/lib/auth', () => ({ getProfile: boundary.profile }))
vi.mock('@/lib/security/public-scan-rate-limit', () => ({
  consumePublicScanRateLimit: async () => ({ allowed: true, remaining: 4, resetAt: 2_000_000_000 }),
}))
import { POST as prepareIntent } from '@/app/api/scans/[id]/claim-intent/route'
import { POST as claimScan } from '@/app/api/scans/[id]/claim/route'

const scanId = '11111111-1111-4111-8111-111111111111'
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks() })

function localIntentRequest() {
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    expect(input).toBe(`/api/scans/${scanId}/claim-intent`)
    expect(init?.method).toBe('POST')
    return prepareIntent(new NextRequest(new Request(`https://aiso.test${input}`, init)), {
      params: Promise.resolve({ id: scanId }),
    })
  })
}

describe('saved report sign-in continuation', () => {
  it.each(['en', 'zh-HK'])('lets a returning owner sign in without requesting another claim (%s)', async lang => {
    boundary.sql.mockResolvedValue([{ id: scanId, account_id: 'owner-account' }])
    localIntentRequest()

    expect(accountUnlock.prepareAccountUnlock).toBeTypeOf('function')
    const continuation = await accountUnlock.prepareAccountUnlock(scanId, lang)

    expect(continuation).toEqual({ mode: 'sign-in', next: `/${lang}/result/${scanId}` })
    const callback = new URL(buildAuthCompleteUrl(lang, continuation.next), 'https://aiso.test')
    expect(callback.searchParams.get('next')).toBe(`/${lang}/result/${scanId}`)
    // The continuation grants no result access; the existing account gate still decides.
    expect(canViewFullResult('owner-account', 'other-account')).toBe(false)
    expect(canViewFullResult('owner-account', 'owner-account')).toBe(true)
  })

  it('keeps a signed claim continuation for an unowned report', async () => {
    vi.stubEnv('REPORT_SHARE_SECRET', 'local-test-signing-secret-that-is-long-enough')
    boundary.sql.mockResolvedValue([{ id: scanId, account_id: null }])
    localIntentRequest()

    expect(accountUnlock.prepareAccountUnlock).toBeTypeOf('function')
    await expect(accountUnlock.prepareAccountUnlock(scanId, 'en')).resolves.toEqual({
      mode: 'claim', next: `/en/result/${scanId}?claim=1`,
    })
  })

  it('does not turn the sign-in-only continuation into permission to claim a foreign report', async () => {
    boundary.profile.mockResolvedValue({ account_id: 'other-account' })
    const response = await claimScan(new NextRequest(`https://aiso.test/api/scans/${scanId}/claim`, { method: 'POST' }), {
      params: Promise.resolve({ id: scanId }),
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Claim unavailable' })
    expect(boundary.sql).not.toHaveBeenCalled()
  })

  it.each([
    [409, { error: 'Some other conflict' }],
    [429, { error: 'Too many requests' }],
    [503, { error: 'Unable to prepare scan claim' }],
    [200, { ok: false }],
  ])('keeps failed preparation unavailable for %s / %j', async (status, payload) => {
    vi.stubGlobal('fetch', async () => Response.json(payload, { status }))
    expect(accountUnlock.prepareAccountUnlock).toBeTypeOf('function')
    await expect(accountUnlock.prepareAccountUnlock(scanId, 'en')).rejects.toThrow('claim_intent_failed')
  })
})
