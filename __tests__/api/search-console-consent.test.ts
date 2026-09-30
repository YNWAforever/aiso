import { randomBytes } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GOOGLE_CONSENT_COOKIE, signConsentState, verifyConsentState } from '@/lib/integrations/google/consent-state'
import { GoogleApiError, SEARCH_CONSOLE_SCOPE } from '@/lib/integrations/google/oauth'
import { ANALYTICS_SCOPE } from '@/lib/integrations/google/scopes'
import { CONSENT_ERROR_REASONS } from '@/lib/integrations/google/consent-reasons'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'

const getProfile = vi.hoisted(() => vi.fn())
const upsertConnection = vi.hoisted(() => vi.fn())
const listConnections = vi.hoisted(() => vi.fn())
const exchangeCode = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth', () => ({ getProfile }))
// Wraps the real resolver so one test can grant Search Console without Analytics; the catalogue
// grants the two to exactly the same plans, so no real plan reaches that state.
const entitlementOverride = vi.hoisted(() => ({ analytics: null as boolean | null }))
vi.mock('@/lib/tier', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/tier')>()
  return {
    ...real,
    resolveCommercialEntitlement: (...args: Parameters<typeof real.resolveCommercialEntitlement>) => {
      const result = real.resolveCommercialEntitlement(...args)
      return entitlementOverride.analytics === null
        ? result
        : { ...result, features: { ...result.features, analytics: entitlementOverride.analytics } }
    },
  }
})
vi.mock('@/lib/integrations/search-console/store', () => ({ upsertConnection, listConnections }))
vi.mock('@/lib/integrations/google/oauth', async importOriginal => ({ ...(await importOriginal<object>()), exchangeCode }))

const profile = {
  id: '11111111-1111-4111-8111-111111111111',
  account_id: '22222222-2222-4222-8222-222222222222',
  accounts: { plan: 'pro', status: 'active', stripe_subscription_id: 'sub_1' },
}

beforeEach(() => {
  Object.assign(process.env, {
    FEATURE_SEARCH_CONSOLE: '1', FEATURE_ANALYTICS: '1', GOOGLE_OAUTH_CLIENT_ID: 'cid', GOOGLE_OAUTH_CLIENT_SECRET: 'cs',
    GOOGLE_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    REPORT_SHARE_SECRET: 'consent-route-test-secret-0123456789abcdef',
    NEXT_PUBLIC_APP_URL: 'https://app.test',
  })
  getProfile.mockReset().mockResolvedValue(profile)
  upsertConnection.mockReset().mockResolvedValue('conn-1')
  exchangeCode.mockReset()
  listConnections.mockReset().mockResolvedValue([])
  entitlementOverride.analytics = null
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

  it('sets a Secure, path-scoped cookie whose value verifies', async () => {
    const res = await start('?return=/en/dashboard/settings')
    const cookie = res.cookies.get(GOOGLE_CONSENT_COOKIE)
    expect(cookie?.secure).toBe(true)
    expect(cookie?.path).toBe('/api/integrations/google')
    const verified = verifyConsentState(cookie?.value)
    expect(verified?.profileId).toBe(profile.id)
    expect(verified?.accountId).toBe(profile.account_id)
    expect(verified?.returnPath).toBe('/en/dashboard/settings')
  })

  const consentUrl = (res: Response) => new URL(res.headers.get('location')!)
  const CONNECTION = '55555555-5555-4555-8555-555555555555'
  const OTHER = '66666666-6666-4666-8666-666666666666'
  const summary = (over = {}) => ({
    id: CONNECTION, googleEmail: 'owner@example.com', status: 'active', scopes: [SEARCH_CONSOLE_SCOPE],
    createdAt: '2026-09-01T00:00:00.000Z', ...over,
  })

  it('asks only for Search Console and records that product by default', async () => {
    const res = await start('?return=/en/dashboard/settings')
    const scope = consentUrl(res).searchParams.get('scope')!.split(' ')
    expect(scope).toContain(SEARCH_CONSOLE_SCOPE)
    expect(scope).not.toContain(ANALYTICS_SCOPE)
    expect(verifyConsentState(res.cookies.get(GOOGLE_CONSENT_COOKIE)?.value)?.product).toBe('search_console')
    expect(consentUrl(res).searchParams.get('login_hint')).toBeNull()
  })

  it.each(['ads', '', 'ANALYTICS'])('treats an unknown scope value %j as search_console', async value => {
    const res = await start(`?scope=${value}`)
    expect(consentUrl(res).searchParams.get('scope')).not.toContain(ANALYTICS_SCOPE)
    expect(verifyConsentState(res.cookies.get(GOOGLE_CONSENT_COOKIE)?.value)?.product).toBe('search_console')
  })

  it('scope=analytics asks for both scopes and records the analytics product', async () => {
    const res = await start('?scope=analytics')
    const scope = consentUrl(res).searchParams.get('scope')!.split(' ')
    expect(scope).toEqual(expect.arrayContaining([SEARCH_CONSOLE_SCOPE, ANALYTICS_SCOPE]))
    expect(verifyConsentState(res.cookies.get(GOOGLE_CONSENT_COOKIE)?.value)?.product).toBe('analytics')
    expect(listConnections).not.toHaveBeenCalled()
  })

  it("hints the caller's own connection email, looked up by the caller's account", async () => {
    listConnections.mockResolvedValue([summary({ id: OTHER, googleEmail: 'other@example.com' }), summary()])
    const res = await start(`?scope=analytics&connection=${CONNECTION}`)
    expect(res.status).toBe(302)
    expect(consentUrl(res).searchParams.get('login_hint')).toBe('owner@example.com')
    expect(listConnections).toHaveBeenCalledWith(profile.account_id)
  })

  it("gives no hint for another account's connection id, and still succeeds", async () => {
    listConnections.mockResolvedValue([summary({ id: OTHER })])
    const res = await start(`?scope=analytics&connection=${CONNECTION}`)
    expect(res.status).toBe(302)
    expect(consentUrl(res).searchParams.get('login_hint')).toBeNull()
  })

  it('gives no hint for a non-UUID connection and never queries', async () => {
    const res = await start('?scope=analytics&connection=not-a-uuid')
    expect(res.status).toBe(302)
    expect(consentUrl(res).searchParams.get('login_hint')).toBeNull()
    expect(listConnections).not.toHaveBeenCalled()
  })

  it('gives no hint when the matching connection has no email', async () => {
    listConnections.mockResolvedValue([summary({ googleEmail: null })])
    const res = await start(`?scope=analytics&connection=${CONNECTION}`)
    expect(res.status).toBe(302)
    expect(consentUrl(res).searchParams.get('login_hint')).toBeNull()
  })

  it('still succeeds when the connection lookup fails, logging only the error name', async () => {
    const boom = Object.assign(new Error('postgresql://user:secret@host/db'), { name: 'NeonDbError' })
    listConnections.mockRejectedValue(boom)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const res = await start(`?scope=analytics&connection=${CONNECTION}`)
      expect(res.status).toBe(302)
      expect(consentUrl(res).searchParams.get('login_hint')).toBeNull()
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('secret')
      expect(errorSpy).toHaveBeenCalledWith(expect.any(String), { name: 'NeonDbError' })
    } finally {
      errorSpy.mockRestore()
    }
  })

  describe('analytics is dark behind its flag and plan', () => {
    it('is 404 with FEATURE_ANALYTICS off, sets no consent cookie and never queries', async () => {
      delete process.env.FEATURE_ANALYTICS
      const res = await start(`?scope=analytics&connection=${CONNECTION}`)
      expect(res.status).toBe(404)
      expect(res.headers.get('location')).toBeNull()
      expect(res.cookies.get(GOOGLE_CONSENT_COOKIE)).toBeUndefined()
      expect(listConnections).not.toHaveBeenCalled()
    })

    it.each(['0', 'true', ''])('is 404 when FEATURE_ANALYTICS is %j (only exactly 1 counts)', async value => {
      process.env.FEATURE_ANALYTICS = value
      expect((await start('?scope=analytics')).status).toBe(404)
    })

    it('is 404 when the plan grants Search Console but not analytics, and sets no cookie', async () => {
      entitlementOverride.analytics = false
      const res = await start(`?scope=analytics&connection=${CONNECTION}`)
      expect(res.status).toBe(404)
      expect(res.headers.get('location')).toBeNull()
      expect(res.cookies.get(GOOGLE_CONSENT_COOKIE)).toBeUndefined()
      expect(listConnections).not.toHaveBeenCalled()
    })

    it('does not gate Search Console on the analytics feature', async () => {
      entitlementOverride.analytics = false
      expect((await start('')).status).toBe(302)
    })

    it.each(['free', 'basic'])('is refused on the %s plan before any product is considered, with no cookie', async plan => {
      getProfile.mockResolvedValue({ ...profile, accounts: { ...profile.accounts, plan } })
      const res = await start('?scope=analytics')
      expect(res.status).toBe(403)
      expect(res.cookies.get(GOOGLE_CONSENT_COOKIE)).toBeUndefined()
    })

    it('still starts analytics consent when the flag is on and the plan is entitled', async () => {
      const res = await start('?scope=analytics')
      expect(res.status).toBe(302)
      expect(verifyConsentState(res.cookies.get(GOOGLE_CONSENT_COOKIE)?.value)?.product).toBe('analytics')
    })

    it('leaves Search Console untouched with FEATURE_ANALYTICS off', async () => {
      delete process.env.FEATURE_ANALYTICS
      const res = await start('')
      expect(res.status).toBe(302)
      expect(consentUrl(res).searchParams.get('scope')).not.toContain(ANALYTICS_SCOPE)
    })

    it('treats an unknown scope value as search_console, so it is not gated by analytics', async () => {
      delete process.env.FEATURE_ANALYTICS
      expect((await start('?scope=ads')).status).toBe(302)
    })
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
    returnPath: '/en/dashboard/settings', product: 'search_console', ...over,
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

  it('clears the consent cookie on a successful connect', async () => {
    exchangeCode.mockResolvedValue(grant())
    const res = await callback(cookieFor())
    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).toContain('Max-Age=0')
    expect(setCookie).toContain('Path=/api/integrations/google')
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

  it('refuses a cookie started for a different account', async () => {
    expect((await callback(cookieFor({ accountId: '44444444-4444-4444-8444-444444444444' }))).headers.get('location'))
      .toContain('reason=session_mismatch')
    expect(exchangeCode).not.toHaveBeenCalled()
  })

  it('refuses a denied consent (no code, error=access_denied) without exchanging the code', async () => {
    expect((await callback(cookieFor(), `state=${STATE}&error=access_denied`)).headers.get('location'))
      .toContain('reason=denied')
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

  it('a search_console consent that also grants analytics stores every granted scope', async () => {
    exchangeCode.mockResolvedValue(grant({ scopes: ['openid', SEARCH_CONSOLE_SCOPE, ANALYTICS_SCOPE] }))
    const res = await callback(cookieFor())
    expect(res.headers.get('location')).toContain('google=connected')
    expect(upsertConnection.mock.calls[0]![0].scopes).toEqual(['openid', SEARCH_CONSOLE_SCOPE, ANALYTICS_SCOPE])
  })

  describe('product analytics', () => {
    const analytics = () => cookieFor({ product: 'analytics' })

    it('refuses a grant lacking the Analytics scope and stores nothing', async () => {
      exchangeCode.mockResolvedValue(grant({ scopes: ['openid', SEARCH_CONSOLE_SCOPE] }))
      expect((await callback(analytics())).headers.get('location')).toContain('reason=analytics_not_granted')
      expect(upsertConnection).not.toHaveBeenCalled()
    })

    it('refuses a grant lacking the Search Console scope and stores nothing', async () => {
      exchangeCode.mockResolvedValue(grant({ scopes: ['openid', ANALYTICS_SCOPE] }))
      expect((await callback(analytics())).headers.get('location')).toContain('reason=search_console_not_granted')
      expect(upsertConnection).not.toHaveBeenCalled()
    })

    it('refuses a grant with neither scope by naming Analytics first', async () => {
      exchangeCode.mockResolvedValue(grant({ scopes: ['openid'] }))
      expect((await callback(analytics())).headers.get('location')).toContain('reason=analytics_not_granted')
      expect(upsertConnection).not.toHaveBeenCalled()
    })

    it('stores the connection with the granted scopes when both are present', async () => {
      exchangeCode.mockResolvedValue(grant({ scopes: ['openid', SEARCH_CONSOLE_SCOPE, ANALYTICS_SCOPE] }))
      const res = await callback(analytics())
      expect(res.headers.get('location')).toBe('https://app.test/en/dashboard/settings?google=connected')
      expect(upsertConnection).toHaveBeenCalledTimes(1)
      expect(upsertConnection.mock.calls[0]![0].scopes).toEqual(['openid', SEARCH_CONSOLE_SCOPE, ANALYTICS_SCOPE])
    })
  })

  it('never reports connected over a failed write', async () => {
    exchangeCode.mockResolvedValue(grant())
    upsertConnection.mockRejectedValue(new Error('db'))
    expect((await callback(cookieFor())).headers.get('location')).toContain('reason=unavailable')
  })

  it('logs a misconfigured token-exchange failure for operators and never writes', async () => {
    exchangeCode.mockRejectedValue(new GoogleApiError('misconfigured', 401, 'invalid_client'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const res = await callback(cookieFor())
      expect(res.headers.get('location')).toContain('reason=unavailable')
      expect(upsertConnection).not.toHaveBeenCalled()
      expect(errorSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ code: 'invalid_client' }),
      )
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('gates before exchanging: 404 with the flag off', async () => {
    delete process.env.FEATURE_SEARCH_CONSOLE
    const res = await callback(cookieFor())
    expect(res.status).toBe(404)
    expect(exchangeCode).not.toHaveBeenCalled()
  })

  it('gates before exchanging: 401 when signed out', async () => {
    getProfile.mockResolvedValue(null)
    const res = await callback(cookieFor())
    expect(res.status).toBe(401)
    expect(exchangeCode).not.toHaveBeenCalled()
  })
})

describe('consent refusal copy', () => {
  it('names the two analytics reasons', () => {
    expect(CONSENT_ERROR_REASONS).toEqual(expect.arrayContaining(['analytics_not_granted', 'search_console_not_granted']))
  })

  it.each(CONSENT_ERROR_REASONS)('has copy for %s in both languages', reason => {
    for (const messages of [en, zhHK]) {
      const copy = messages.searchConsole as Record<string, string>
      expect(copy[`error_${reason}`]?.trim().length).toBeGreaterThan(0)
    }
  })

  it('translates the analytics reasons into Traditional Chinese, not English', () => {
    const copy = zhHK.searchConsole as Record<string, string>
    for (const reason of ['analytics_not_granted', 'search_console_not_granted']) {
      expect(copy[`error_${reason}`]).toMatch(/[一-鿿]/)
    }
  })
})
