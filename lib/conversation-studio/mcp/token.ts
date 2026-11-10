import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * The MCP transport cannot rely on a browser cookie: an MCP client runs outside
 * the page. A member mints a short-lived signed token from their own session
 * (POST .../studio/mcp-token), hands it to the client, and the transport uses it
 * as the bearer identity. The token proves *who asked*, never *what they may
 * read*: the transport re-loads the profile, brand access and plan on every
 * call, so removal, a brand transfer or a downgrade takes effect immediately and
 * the token cannot outlive them.
 *
 * Format: `v1.<base64url(payload)>.<base64url(hmac-sha256)>`.
 */
export const STUDIO_MCP_TOKEN_PREFIX = 'v1'
export const STUDIO_MCP_TOKEN_TTL_MS = 60 * 60 * 1000
export const STUDIO_MCP_TOKEN_AUDIENCE = 'studio-mcp'

export type StudioMcpTokenClaims = {
  accountId: string
  clientId: string
  profileId: string
  expiresAt: number
}

type TokenPayload = Omit<StudioMcpTokenClaims, 'expiresAt'> & { v: 1; aud: typeof STUDIO_MCP_TOKEN_AUDIENCE; iat: number; exp: number }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const encoder = new TextEncoder()

function secret(): string | null {
  const value = process.env.STUDIO_MCP_TOKEN_SECRET
  return typeof value === 'string' && value.length >= 32 ? value : null
}

export function isStudioMcpConfigured(): boolean {
  return secret() !== null
}

function sign(secretValue: string, value: string): string {
  return createHmac('sha256', secretValue).update(value).digest('base64url')
}

function isClaims(value: unknown): value is TokenPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as Record<string, unknown>
  return payload.v === 1
    && payload.aud === STUDIO_MCP_TOKEN_AUDIENCE
    && typeof payload.iat === 'number'
    && typeof payload.exp === 'number'
    && typeof payload.accountId === 'string' && UUID.test(payload.accountId)
    && typeof payload.clientId === 'string' && UUID.test(payload.clientId)
    && typeof payload.profileId === 'string' && UUID.test(payload.profileId)
}

/** Throws STUDIO_MCP_UNCONFIGURED when the secret is missing or shorter than 32 chars. */
export function mintStudioMcpToken(claims: Omit<StudioMcpTokenClaims, 'expiresAt'>, now = Date.now()): { token: string; expiresAt: number } {
  const key = secret()
  if (!key) throw new Error('STUDIO_MCP_UNCONFIGURED')
  const iat = Math.floor(now / 1000)
  const exp = iat + Math.floor(STUDIO_MCP_TOKEN_TTL_MS / 1000)
  const payload: TokenPayload = { v: 1, aud: STUDIO_MCP_TOKEN_AUDIENCE, accountId: claims.accountId, clientId: claims.clientId, profileId: claims.profileId, iat, exp }
  const body = `${STUDIO_MCP_TOKEN_PREFIX}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`
  return { token: `${body}.${sign(key, body)}`, expiresAt: exp * 1000 }
}

/** Returns the claims only when the version, signature, audience and expiry all verify. */
export function verifyStudioMcpToken(token: unknown, now = Date.now()): StudioMcpTokenClaims | null {
  const key = secret()
  if (!key || typeof token !== 'string' || token.length > 4096) return null
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== STUDIO_MCP_TOKEN_PREFIX) return null
  const body = `${parts[0]}.${parts[1]}`
  const expected = sign(key, body)
  if (parts[2].length !== expected.length) return null
  if (!timingSafeEqual(encoder.encode(parts[2]), encoder.encode(expected))) return null
  let payload: unknown
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!isClaims(payload)) return null
  if (payload.exp * 1000 <= now || payload.iat * 1000 > now + 60_000) return null
  return { accountId: payload.accountId, clientId: payload.clientId, profileId: payload.profileId, expiresAt: payload.exp * 1000 }
}
