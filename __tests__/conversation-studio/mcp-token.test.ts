import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import {
  isStudioMcpConfigured,
  mintStudioMcpToken,
  STUDIO_MCP_TOKEN_TTL_MS,
  verifyStudioMcpToken,
} from '@/lib/conversation-studio/mcp/token'

const SECRET = 's'.repeat(40)
const claims = {
  accountId: '10000000-0000-4000-8000-000000000001',
  clientId: '20000000-0000-4000-8000-000000000002',
  profileId: '30000000-0000-4000-8000-000000000003',
}

beforeEach(() => {
  vi.stubEnv('STUDIO_MCP_TOKEN_SECRET', SECRET)
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('Studio MCP token', () => {
  it('requires a configured secret of at least 32 characters', () => {
    expect(isStudioMcpConfigured()).toBe(true)
    vi.stubEnv('STUDIO_MCP_TOKEN_SECRET', 'short')
    expect(isStudioMcpConfigured()).toBe(false)
    expect(() => mintStudioMcpToken(claims)).toThrow('STUDIO_MCP_UNCONFIGURED')
    expect(verifyStudioMcpToken('anything')).toBeNull()
    vi.stubEnv('STUDIO_MCP_TOKEN_SECRET', '')
    expect(isStudioMcpConfigured()).toBe(false)
  })

  it('round-trips the exact member, brand and account', () => {
    const now = Date.UTC(2026, 10, 10, 12, 0, 0)
    const { token, expiresAt } = mintStudioMcpToken(claims, now)
    expect(expiresAt).toBe(now + STUDIO_MCP_TOKEN_TTL_MS)
    expect(verifyStudioMcpToken(token, now)).toEqual({ ...claims, expiresAt })
    expect(token.startsWith('v1.')).toBe(true)
  })

  it('rejects a tampered payload or signature', () => {
    const { token } = mintStudioMcpToken(claims, Date.now())
    const [version, body, signature] = token.split('.')
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    const forged = Buffer.from(JSON.stringify({ ...payload, clientId: '90000000-0000-4000-8000-000000000009' })).toString('base64url')
    expect(verifyStudioMcpToken(`${version}.${forged}.${signature}`)).toBeNull()
    expect(verifyStudioMcpToken(`${version}.${body}.${signature.slice(0, -1)}x`)).toBeNull()
    expect(verifyStudioMcpToken(`${version}.${body}.${signature}`)).not.toBeNull()
  })

  it('rejects the wrong version, malformed shapes and oversized input', () => {
    const { token } = mintStudioMcpToken(claims, Date.now())
    const body = token.split('.').slice(1).join('.')
    for (const value of [`v2.${body}`, token.replace(/\..*$/, ''), `v1.${body}.`, `v1..${token.split('.')[2]}`, '', 'v1.eyJ9.x', 'v1.' + 'a'.repeat(5000) + '.x']) {
      expect(verifyStudioMcpToken(value), value.slice(0, 24)).toBeNull()
    }
  })

  it('expires exactly at the TTL and refuses a future iat', () => {
    const now = Date.UTC(2026, 10, 10, 12, 0, 0)
    const { token } = mintStudioMcpToken(claims, now)
    expect(verifyStudioMcpToken(token, now + STUDIO_MCP_TOKEN_TTL_MS - 1)).not.toBeNull()
    expect(verifyStudioMcpToken(token, now + STUDIO_MCP_TOKEN_TTL_MS)).toBeNull()
    // A token minted in the future (clock skew beyond the allowance) is not accepted.
    expect(verifyStudioMcpToken(token, now - 61_000)).toBeNull()
  })

  it('does not verify under a different secret', () => {
    const { token } = mintStudioMcpToken(claims, Date.now())
    vi.stubEnv('STUDIO_MCP_TOKEN_SECRET', 'd'.repeat(40))
    expect(verifyStudioMcpToken(token)).toBeNull()
  })
})
