import { createHash, randomBytes } from 'node:crypto'

/**
 * Google OAuth for the Search Console connector (spec §4.1, §5). Plain HTTP over
 * an injected fetch, so the caller can see status codes: a dead credential
 * (revoked) and a Google outage (unavailable) lead to different owner states.
 * A third case is neither: a 401 (or an `invalid_client`/`unauthorized_client`/
 * `deleted_client`/`disabled_client` error) from the token endpoint means OUR
 * client id/secret is wrong or the OAuth client was deleted/disabled — not that
 * the user revoked consent. Treating that as 'revoked' would tell every owner
 * to "reconnect" after a single bad deploy, and reconnecting can't fix it.
 */

export const SEARCH_CONSOLE_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'
export const CALLBACK_PATH = '/api/integrations/google/callback'
export const GOOGLE_TIMEOUT_MS = 10_000

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'

export type GoogleFetch = (input: string, init?: RequestInit) => Promise<Response>
export type GoogleOAuthConfig = { clientId: string; clientSecret: string; redirectUri: string }
export type GoogleFailure = 'revoked' | 'forbidden' | 'quota' | 'unavailable' | 'misconfigured'

const ERROR_CODE_RE = /^[a-z_]{1,64}$/

export class GoogleApiError extends Error {
  constructor(readonly kind: GoogleFailure, readonly status: number, readonly code: string | null = null) {
    super(`google_${kind}_${status}`)
    this.name = 'GoogleApiError'
  }
}

export type TokenGrant = {
  accessToken: string
  refreshToken: string | null
  subject: string
  email: string | null
  scopes: string[]
}

export function googleOAuthConfig(
  env: { GOOGLE_OAUTH_CLIENT_ID?: string; GOOGLE_OAUTH_CLIENT_SECRET?: string; [key: string]: string | undefined },
  origin: string,
): GoogleOAuthConfig | null {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim()
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret, redirectUri: `${origin.replace(/\/$/, '')}${CALLBACK_PATH}` }
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

export function randomState(): string {
  return randomBytes(32).toString('base64url')
}

export function buildConsentUrl(cfg: GoogleOAuthConfig, input: { state: string; challenge: string }): string {
  const url = new URL(AUTH_URL)
  url.search = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: `openid email ${SEARCH_CONSOLE_SCOPE}`,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: 'S256',
  }).toString()
  return url.toString()
}

const MISCONFIGURED_ERRORS = new Set(['invalid_client', 'unauthorized_client', 'deleted_client', 'disabled_client'])

/** Classifies a failure from the TOKEN endpoint specifically — see the module doc for why 401 is not 'revoked'. */
export function classifyGoogleFailure(status: number, body: unknown): GoogleFailure {
  const error = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined
  if (status === 400 && error === 'invalid_grant') return 'revoked'
  if (status === 401 || (typeof error === 'string' && MISCONFIGURED_ERRORS.has(error))) return 'misconfigured'
  if (status === 403) return 'forbidden'
  if (status === 429) return 'quota'
  return 'unavailable'
}

function errorCode(body: Record<string, unknown>): string | null {
  const error = body.error
  return typeof error === 'string' && ERROR_CODE_RE.test(error) ? error : null
}

async function postForm(url: string, form: Record<string, string>, f: GoogleFetch): Promise<Record<string, unknown>> {
  let res: Response
  try {
    res = await f(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    })
  } catch {
    throw new GoogleApiError('unavailable', 0)
  }
  const parsed: unknown = await res.json().catch(() => ({}))
  const body: Record<string, unknown> = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {}
  if (!res.ok) throw new GoogleApiError(classifyGoogleFailure(res.status, body), res.status, errorCode(body))
  return body
}

/**
 * Claims are read without verifying the id_token's signature. That is safe here
 * only because the token came in the direct TLS response from Google's token
 * endpoint (TOKEN_URL) to this server, never via the browser — so `aud`/`iss`
 * are still checked to make sure the token really is Google's, for this client.
 */
function idTokenClaims(idToken: unknown, cfg: GoogleOAuthConfig): { sub: string; email: string | null } {
  if (typeof idToken !== 'string') throw new GoogleApiError('unavailable', 200)
  let claims: { sub?: unknown; email?: unknown; aud?: unknown; iss?: unknown }
  try {
    claims = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8'))
  } catch {
    throw new GoogleApiError('unavailable', 200)
  }
  if (typeof claims.sub !== 'string' || !claims.sub) throw new GoogleApiError('unavailable', 200)
  if (claims.aud !== cfg.clientId) throw new GoogleApiError('unavailable', 200)
  if (claims.iss !== 'accounts.google.com' && claims.iss !== 'https://accounts.google.com') {
    throw new GoogleApiError('unavailable', 200)
  }
  return { sub: claims.sub, email: typeof claims.email === 'string' ? claims.email : null }
}

export async function exchangeCode(
  cfg: GoogleOAuthConfig,
  input: { code: string; verifier: string },
  f: GoogleFetch = fetch,
): Promise<TokenGrant> {
  const body = await postForm(TOKEN_URL, {
    code: input.code,
    code_verifier: input.verifier,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    grant_type: 'authorization_code',
  }, f)
  if (typeof body.access_token !== 'string') throw new GoogleApiError('unavailable', 200)
  const { sub, email } = idTokenClaims(body.id_token, cfg)
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === 'string' && body.refresh_token ? body.refresh_token : null,
    subject: sub,
    email,
    scopes: typeof body.scope === 'string' ? body.scope.split(' ').filter(Boolean) : [],
  }
}

export async function refreshAccessToken(cfg: GoogleOAuthConfig, refreshToken: string, f: GoogleFetch = fetch): Promise<string> {
  const body = await postForm(TOKEN_URL, {
    refresh_token: refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: 'refresh_token',
  }, f)
  if (typeof body.access_token !== 'string') throw new GoogleApiError('unavailable', 200)
  return body.access_token
}

/** Best effort. The caller deletes its own copy whatever this returns (spec §5). */
export async function revokeToken(token: string, f: GoogleFetch = fetch): Promise<boolean> {
  try {
    const res = await f(REVOKE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    })
    return res.ok
  } catch {
    return false
  }
}
