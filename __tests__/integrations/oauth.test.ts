import { describe, expect, it, vi } from 'vitest'
import {
  GoogleApiError, SEARCH_CONSOLE_SCOPE, buildConsentUrl, classifyGoogleFailure,
  exchangeCode, googleOAuthConfig, pkcePair, refreshAccessToken, revokeToken,
} from '@/lib/integrations/google/oauth'

const cfg = { clientId: 'cid', clientSecret: 'secret', redirectUri: 'https://app.test/api/integrations/google/callback' }
const json = (status: number, body: unknown) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }))
const idToken = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`

describe('googleOAuthConfig', () => {
  it('is null unless both credentials are set', () => {
    expect(googleOAuthConfig({ GOOGLE_OAUTH_CLIENT_ID: 'x' }, 'https://a.test')).toBeNull()
    expect(googleOAuthConfig({ GOOGLE_OAUTH_CLIENT_ID: 'x', GOOGLE_OAUTH_CLIENT_SECRET: 'y' }, 'https://a.test/'))
      .toEqual({ clientId: 'x', clientSecret: 'y', redirectUri: 'https://a.test/api/integrations/google/callback' })
  })

  it('typechecks with process.env directly', () => {
    const result = googleOAuthConfig(process.env, 'https://a.test')
    expect(result === null || typeof result === 'object').toBe(true)
  })
})

describe('consent URL', () => {
  it('uses S256 PKCE and asks for offline, forced-consent access', () => {
    const { verifier, challenge } = pkcePair()
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    const url = new URL(buildConsentUrl(cfg, { state: 's'.repeat(43), challenge }))
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('code_challenge')).toBe(challenge)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('scope')).toBe(`openid email ${SEARCH_CONSOLE_SCOPE}`)
  })
})

describe('exchangeCode', () => {
  it('returns the grant with subject, email and scopes', async () => {
    const f = json(200, {
      access_token: 'ya29.x', refresh_token: '1//r', scope: `openid email ${SEARCH_CONSOLE_SCOPE}`,
      id_token: idToken({ sub: 'g-123', email: 'owner@example.com' }),
    })
    expect(await exchangeCode(cfg, { code: 'c', verifier: 'v' }, f)).toEqual({
      accessToken: 'ya29.x', refreshToken: '1//r', subject: 'g-123', email: 'owner@example.com',
      scopes: ['openid', 'email', SEARCH_CONSOLE_SCOPE],
    })
    expect(String(f.mock.calls[0]![1].body)).toContain('code_verifier=v')
  })

  it('reports a missing refresh token as null rather than inventing one', async () => {
    const f = json(200, { access_token: 'ya29.x', scope: SEARCH_CONSOLE_SCOPE, id_token: idToken({ sub: 'g' }) })
    expect((await exchangeCode(cfg, { code: 'c', verifier: 'v' }, f)).refreshToken).toBeNull()
  })
})

describe('refreshAccessToken', () => {
  it('returns the access token', async () => {
    expect(await refreshAccessToken(cfg, '1//r', json(200, { access_token: 'ya29.new' }))).toBe('ya29.new')
  })

  it('throws revoked on invalid_grant', async () => {
    await expect(refreshAccessToken(cfg, '1//r', json(400, { error: 'invalid_grant' }))).rejects.toMatchObject({ kind: 'revoked' })
  })

  it('throws unavailable when the network fails', async () => {
    await expect(refreshAccessToken(cfg, '1//r', vi.fn().mockRejectedValue(new TypeError('fetch failed'))))
      .rejects.toBeInstanceOf(GoogleApiError)
  })
})

describe('classifyGoogleFailure', () => {
  it.each([
    [400, { error: 'invalid_grant' }, 'revoked'],
    [401, {}, 'revoked'],
    [403, {}, 'forbidden'],
    [429, {}, 'quota'],
    [500, {}, 'unavailable'],
    [400, { error: 'invalid_request' }, 'unavailable'],
  ])('%i %j -> %s', (status, body, kind) => {
    expect(classifyGoogleFailure(status, body)).toBe(kind)
  })
})

describe('revokeToken', () => {
  it('is true on 200 and false otherwise, never throwing', async () => {
    expect(await revokeToken('1//r', json(200, {}))).toBe(true)
    expect(await revokeToken('1//r', json(400, {}))).toBe(false)
    expect(await revokeToken('1//r', vi.fn().mockRejectedValue(new Error('down')))).toBe(false)
  })
})
