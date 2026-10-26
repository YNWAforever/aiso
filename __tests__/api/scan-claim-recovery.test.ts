import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { CLAIM_INTENT_COOKIE, verifyScanClaimIntent } from '@/lib/security/scan-claim-intent'
import { POST as prepare } from '@/app/api/scans/[id]/claim-intent/route'
import { POST as claim } from '@/app/api/scans/[id]/claim/route'

const SCAN = '11111111-2222-4333-8444-555555555555'
const state = vi.hoisted(() => ({
  accountId: null as string | null,
  sessionAccount: 'account-from-session',
  attempts: new Set<string>(),
  effects: [] as string[],
  failWrite: false,
}))

vi.mock('@/lib/auth', () => ({ getProfile: async () => ({ account_id: state.sessionAccount }) }))
vi.mock('@/lib/security/public-scan-rate-limit', () => ({
  consumePublicScanRateLimit: async () => ({ allowed: true }),
}))
vi.mock('@/lib/db', () => ({
  // This is a stateful boundary fake, not evidence of Postgres locking. The
  // real handlers, cookie signatures and attempt consumer run together; only
  // SQL and external auth/rate-limit dependencies are replaced.
  db: () => async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join('?')
    if (query.includes('insert into scan_claim_attempts')) {
      const [attemptId, scanId] = values as [string, string]
      expect(scanId).toBe(SCAN)
      if (state.attempts.has(attemptId)) return []
      state.attempts.add(attemptId)
      state.effects.push('consume')
      return [{ attempt_id: attemptId }]
    }
    if (query.includes('update scans')) {
      expect(values[1]).toBe(SCAN)
      state.effects.push('claim')
      if (state.failWrite) throw new Error('synthetic write failure')
      if (state.accountId !== null) return []
      state.accountId = values[0] as string
      return [{ id: SCAN }]
    }
    if (query.includes('from scans')) {
      expect(values[0]).toBe(SCAN)
      return [{ id: SCAN, account_id: state.accountId }]
    }
    throw new Error(`Unexpected query in claim recovery test: ${query}`)
  },
}))

const context = () => ({ params: Promise.resolve({ id: SCAN }) })

async function mint(lang: 'en' | 'zh-HK' = 'en') {
  const response = await prepare(new NextRequest(`http://localhost/api/scans/${SCAN}/claim-intent`, {
    method: 'POST', body: JSON.stringify({ lang }),
  }), context())
  expect(response.status).toBe(200)
  const cookie = response.cookies.get(CLAIM_INTENT_COOKIE)
  expect(cookie).toBeDefined()
  return cookie!.value
}

async function redeem(token: string) {
  return claim(new NextRequest(`http://localhost/api/scans/${SCAN}/claim`, {
    method: 'POST', headers: { Cookie: `${CLAIM_INTENT_COOKIE}=${token}` },
  }), context())
}

describe('scan claim intent → authenticated claim → recovery', () => {
  beforeEach(() => {
    vi.stubEnv('REPORT_SHARE_SECRET', 'synthetic-claim-recovery-secret-32-characters')
    vi.stubEnv('E2E_FIXTURE_MODE', '')
    state.accountId = null
    state.sessionAccount = 'account-from-session'
    state.attempts.clear()
    state.effects.length = 0
    state.failWrite = false
  })
  afterEach(() => vi.unstubAllEnvs())

  it.each(['en', 'zh-HK'] as const)('claims with the minted %s cookie and denies its replay', async lang => {
    const token = await mint(lang)
    expect(verifyScanClaimIntent(token)).toMatchObject({
      scanId: SCAN, lang, returnPath: `/${lang}/result/${SCAN}?claim=1`,
    })

    const first = await redeem(token)
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ ok: true, alreadyOwned: false })
    expect(first.cookies.get(CLAIM_INTENT_COOKIE)?.value).toBe('')
    expect(state.accountId).toBe('account-from-session')

    const replay = await redeem(token)
    expect(replay.status).toBe(403)
    expect(await replay.json()).toEqual({ error: 'Claim unavailable' })
    expect(state.effects).toEqual(['consume', 'claim'])
  })

  it('requires a fresh intent after a failed write and recovers the still-unowned scan', async () => {
    const original = await mint()
    state.failWrite = true
    const failed = await redeem(original)
    expect(failed.status).toBe(500)
    expect(state.accountId).toBeNull()
    expect(state.attempts.size).toBe(1)

    state.failWrite = false
    expect((await redeem(original)).status).toBe(403)
    const replacement = await mint()
    expect(verifyScanClaimIntent(replacement)?.attemptId).not.toBe(verifyScanClaimIntent(original)?.attemptId)

    const recovered = await redeem(replacement)
    expect(recovered.status).toBe(200)
    expect(await recovered.json()).toEqual({ ok: true, alreadyOwned: false })
    expect(state.accountId).toBe('account-from-session')
    expect(state.effects).toEqual(['consume', 'claim', 'consume', 'claim'])
  })

  it('does not transfer ownership when a second pre-minted intent is used by another account', async () => {
    const first = await mint()
    const second = await mint()
    expect((await redeem(first)).status).toBe(200)
    state.sessionAccount = 'another-account'

    const conflict = await redeem(second)
    expect(conflict.status).toBe(409)
    expect(state.accountId).toBe('account-from-session')

    const unavailable = await prepare(new NextRequest(`http://localhost/api/scans/${SCAN}/claim-intent`, {
      method: 'POST', body: JSON.stringify({ lang: 'en' }),
    }), context())
    expect(unavailable.status).toBe(409)
    expect(unavailable.cookies.get(CLAIM_INTENT_COOKIE)).toBeUndefined()
  })
})
