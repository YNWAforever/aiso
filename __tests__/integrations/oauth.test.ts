import { describe, expect, it, vi } from 'vitest'
import {
  SEARCH_CONSOLE_SCOPE, buildConsentUrl, classifyGoogleFailure,
  exchangeCode, googleOAuthConfig, pkcePair, refreshAccessToken, revokeToken,
} from '@/lib/integrations/google/oauth'
import { createHash } from 'node:crypto'

const cfg = { clientId: 'cid', clientSecret: 'secret', redirectUri: 'https://app.test/api/integrations/google/callback' }
const json = (status: number, body: unknown) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }))
const idToken = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`
const validClaims = { aud: 'cid', iss: 'https://accounts.google.com' }

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

  it('code_challenge equals base64url(sha256(verifier)) and carries the required params', () => {
    const { verifier, challenge } = pkcePair()
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'))
    const url = new URL(buildConsentUrl(cfg, { state: 'state-value', challenge }))
    expect(url.searchParams.get('client_id')).toBe(cfg.clientId)
    expect(url.searchParams.get('redirect_uri')).toBe(cfg.redirectUri)
    expect(url.searchParams.get('state')).toBe('state-value')
    expect(url.searchParams.get('response_type')).toBe('code')
  })
})

describe('exchangeCode', () => {
  it('returns the grant with subject, email and scopes', async () => {
    const f = json(200, {
      access_token: 'ya29.x', refresh_token: '1//r', scope: `openid email ${SEARCH_CONSOLE_SCOPE}`,
      id_token: idToken({ sub: 'g-123', email: 'owner@example.com', ...validClaims }),
    })
    expect(await exchangeCode(cfg, { code: 'c', verifier: 'v' }, f)).toEqual({
      accessToken: 'ya29.x', refreshToken: '1//r', subject: 'g-123', email: 'owner@example.com',
      scopes: ['openid', 'email', SEARCH_CONSOLE_SCOPE],
    })
    expect(String(f.mock.calls[0]![1].body)).toContain('code_verifier=v')
  })

  it('reports a missing refresh token as null rather than inventing one', async () => {
    const f = json(200, { access_token: 'ya29.x', scope: SEARCH_CONSOLE_SCOPE, id_token: idToken({ sub: 'g', ...validClaims }) })
    expect((await exchangeCode(cfg, { code: 'c', verifier: 'v' }, f)).refreshToken).toBeNull()
  })

  it('rejects an id_token with the wrong aud', async () => {
    const f = json(200, {
      access_token: 'ya29.x',
      id_token: idToken({ sub: 'g', aud: 'someone-elses-client', iss: 'https://accounts.google.com' }),
    })
    await expect(exchangeCode(cfg, { code: 'c', verifier: 'v' }, f)).rejects.toMatchObject({ kind: 'unavailable' })
  })

  it('rejects an id_token with a foreign iss', async () => {
    const f = json(200, {
      access_token: 'ya29.x',
      id_token: idToken({ sub: 'g', aud: 'cid', iss: 'https://evil.example' }),
    })
    await expect(exchangeCode(cfg, { code: 'c', verifier: 'v' }, f)).rejects.toMatchObject({ kind: 'unavailable' })
  })

  it('sends client_secret in the body, never in the URL', async () => {
    const f = json(200, { access_token: 'ya29.x', id_token: idToken({ sub: 'g', ...validClaims }) })
    await exchangeCode(cfg, { code: 'c', verifier: 'v' }, f)
    const [url, init] = f.mock.calls[0]!
    expect(String(url)).not.toContain('secret')
    expect(String(init.body)).toContain(`client_secret=${cfg.clientSecret}`)
  })
})

describe('refreshAccessToken', () => {
  it('returns the access token', async () => {
    expect(await refreshAccessToken(cfg, '1//r', json(200, { access_token: 'ya29.new' }))).toBe('ya29.new')
  })

  it('throws revoked with code invalid_grant on 400 invalid_grant', async () => {
    await expect(refreshAccessToken(cfg, '1//r', json(400, { error: 'invalid_grant' })))
      .rejects.toMatchObject({ kind: 'revoked', code: 'invalid_grant' })
  })

  it('throws misconfigured on a bare 401', async () => {
    await expect(refreshAccessToken(cfg, '1//r', json(401, {}))).rejects.toMatchObject({ kind: 'misconfigured' })
  })

  it('throws unavailable when the network fails', async () => {
    await expect(refreshAccessToken(cfg, '1//r', vi.fn().mockRejectedValue(new TypeError('fetch failed'))))
      .rejects.toMatchObject({ kind: 'unavailable', status: 0 })
  })

  it('throws unavailable on a 502 with an HTML body', async () => {
    const f = vi.fn().mockResolvedValue(new Response('<html>gateway error</html>', { status: 502 }))
    await expect(refreshAccessToken(cfg, '1//r', f)).rejects.toMatchObject({ kind: 'unavailable' })
  })

  it('throws unavailable rather than a TypeError on a 200 JSON null body', async () => {
    const f = vi.fn().mockResolvedValue(new Response('null', { status: 200 }))
    await expect(refreshAccessToken(cfg, '1//r', f)).rejects.toMatchObject({ kind: 'unavailable' })
  })

  it('sends grant_type=refresh_token', async () => {
    const f = json(200, { access_token: 'ya29.new' })
    await refreshAccessToken(cfg, '1//r', f)
    expect(String(f.mock.calls[0]![1].body)).toContain('grant_type=refresh_token')
  })

  it('is called with an AbortSignal', async () => {
    const f = json(200, { access_token: 'ya29.new' })
    await refreshAccessToken(cfg, '1//r', f)
    expect(f.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal)
  })
})

describe('classifyGoogleFailure', () => {
  it.each([
    [400, { error: 'invalid_grant' }, 'revoked'],
    [401, {}, 'misconfigured'],
    [401, { error: 'invalid_client' }, 'misconfigured'],
    [400, { error: 'invalid_client' }, 'misconfigured'],
    [400, { error: 'deleted_client' }, 'misconfigured'],
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

  it('sends the token in the body, not the query', async () => {
    const f = json(200, {})
    await revokeToken('1//r', f)
    const [url, init] = f.mock.calls[0]!
    expect(String(url)).not.toContain('1//r')
    expect(String(init.body)).toContain('token=1%2F%2Fr')
  })

  it('is called with an AbortSignal', async () => {
    const f = json(200, {})
    await revokeToken('1//r', f)
    expect(f.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal)
  })
})
