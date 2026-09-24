import { randomBytes } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GOOGLE_CONSENT_COOKIE, signConsentState } from '@/lib/integrations/google/consent-state'
import { SEARCH_CONSOLE_SCOPE } from '@/lib/integrations/google/oauth'

const getProfile = vi.hoisted(() => vi.fn())
const upsertConnection = vi.hoisted(() => vi.fn())
const exchangeCode = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth', () => ({ getProfile }))
vi.mock('@/lib/integrations/search-console/store', () => ({ upsertConnection }))
vi.mock('@/lib/integrations/google/oauth', async importOriginal => ({ ...(await importOriginal<object>()), exchangeCode }))

const profile = {
  id: '11111111-1111-4111-8111-111111111111',
  account_id: '22222222-2222-4222-8222-222222222222',
  accounts: { plan: 'pro', status: 'active', stripe_subscription_id: 'sub_1' },
}

beforeEach(() => {
  Object.assign(process.env, {
    FEATURE_SEARCH_CONSOLE: '1', GOOGLE_OAUTH_CLIENT_ID: 'cid', GOOGLE_OAUTH_CLIENT_SECRET: 'cs',
    GOOGLE_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    REPORT_SHARE_SECRET: 'consent-route-test-secret-0123456789abcdef',
    NEXT_PUBLIC_APP_URL: 'https://app.test',
  })
  getProfile.mockReset().mockResolvedValue(profile)
  upsertConnection.mockReset().mockResolvedValue('conn-1')
  exchangeCode.mockReset()
})

describe('GET start', () => {
  const start = async (query = '') => {
    const { GET } = await import('@/app/api/integrations/google/start/route')
    return GET(new NextRequest(`https://app.test/api/integrations/google/start${query}`))
  }

  it('redirects to Google and sets a signed, HttpOnly, Lax consent cookie', async () => {
    const res = await start('?return=/en/dashboard/settings')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toMatch(/^https:\/\/accounts\.google\.com\//)
    const cookie = res.cookies.get(GOOGLE_CONSENT_COOKIE)
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.sameSite).toBe('lax')
  })

  it('refuses before redirecting when the encryption key is missing', async () => {
    delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY
    expect((await start()).status).toBe(500)
  })

  it('is 404 with the flag off', async () => {
    delete process.env.FEATURE_SEARCH_CONSOLE
    expect((await start()).status).toBe(404)
  })
})

describe('GET callback', () => {
  const STATE = 's'.repeat(43)
  const cookieFor = (over: Partial<Parameters<typeof signConsentState>[0]> = {}) => signConsentState({
    state: STATE, verifier: 'v'.repeat(64), profileId: profile.id, accountId: profile.account_id,
    returnPath: '/en/dashboard/settings', ...over,
  })
  const callback = async (cookie: string | null, query = `code=c&state=${STATE}`) => {
    const { GET } = await import('@/app/api/integrations/google/callback/route')
    return GET(new NextRequest(`https://app.test/api/integrations/google/callback?${query}`, {
      headers: cookie ? { cookie: `${GOOGLE_CONSENT_COOKIE}=${cookie}` } : {},
    }))
  }
  const grant = (over = {}) => ({
    accessToken: 'ya29.x', refreshToken: '1//r', subject: 'g-1', email: 'o@example.com',
    scopes: ['openid', 'email', SEARCH_CONSOLE_SCOPE], ...over,
  })

  it('stores an encrypted connection and returns to settings', async () => {
    exchangeCode.mockResolvedValue(grant())
    const res = await callback(cookieFor())
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://app.test/en/dashboard/settings?google=connected')
    const stored = upsertConnection.mock.calls[0]![0]
    expect(stored.accountId).toBe(profile.account_id)
    expect(stored.sealed.ciphertext.includes(Buffer.from('1//r'))).toBe(false)
  })

  it('refuses a missing cookie without exchanging the code', async () => {
    expect((await callback(null)).headers.get('location')).toContain('reason=consent_invalid')
    expect(exchangeCode).not.toHaveBeenCalled()
  })

  it('refuses a state mismatch without exchanging the code', async () => {
    expect((await callback(cookieFor(), `code=c&state=${'t'.repeat(43)}`)).headers.get('location'))
      .toContain('reason=consent_invalid')
    expect(exchangeCode).not.toHaveBeenCalled()
  })

  it('refuses a cookie started by a different person', async () => {
    expect((await callback(cookieFor({ profileId: '33333333-3333-4333-8333-333333333333' }))).headers.get('location'))
      .toContain('reason=session_mismatch')
    expect(exchangeCode).not.toHaveBeenCalled()
  })

  it('refuses a grant without a refresh token', async () => {
    exchangeCode.mockResolvedValue(grant({ refreshToken: null }))
    expect((await callback(cookieFor())).headers.get('location')).toContain('reason=no_refresh_token')
    expect(upsertConnection).not.toHaveBeenCalled()
  })

  it('refuses a grant without the Search Console scope', async () => {
    exchangeCode.mockResolvedValue(grant({ scopes: ['openid', 'email'] }))
    expect((await callback(cookieFor())).headers.get('location')).toContain('reason=scope_missing')
    expect(upsertConnection).not.toHaveBeenCalled()
  })

  it('never reports connected over a failed write', async () => {
    exchangeCode.mockResolvedValue(grant())
    upsertConnection.mockRejectedValue(new Error('db'))
    expect((await callback(cookieFor())).headers.get('location')).toContain('reason=unavailable')
  })
})
