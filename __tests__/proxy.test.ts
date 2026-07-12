/**
 * proxy.ts routing decision: requests returning from a Neon Auth OAuth/magic-link
 * completion carry a `neon_auth_session_verifier` query param. The SDK middleware
 * can only complete the exchange when the challenge cookie (set at sign-in
 * initiation, on flows that set it) is ALSO present — delegating without it makes
 * the middleware bounce the user to the login page and kills the sign-in. So the
 * proxy delegates only on verifier+challenge, and lets everything else (including
 * verifier-without-challenge, which the /auth/complete client page handles) go
 * through next-intl routing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const authMiddlewareSpy = vi.fn(async () => new Response(null, { status: 302 }))
const middlewareFactory = vi.fn(() => authMiddlewareSpy)
vi.mock('@/lib/neon-auth', () => ({
  auth: () => ({ middleware: middlewareFactory }),
}))

const intlSpy = vi.fn(() => new Response('intl', { status: 200 }))
vi.mock('next-intl/middleware', () => ({
  default: () => intlSpy,
}))

const CHALLENGE_COOKIE = '__Secure-neon-auth.session_challange'

describe('proxy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delegates verifier requests WITH the challenge cookie to the auth middleware', async () => {
    const { proxy } = await import('@/proxy')
    const req = new NextRequest(
      'https://app.example.com/en/dashboard?neon_auth_session_verifier=abc123',
      { headers: { cookie: `${CHALLENGE_COOKIE}=challenge-value` } }
    )
    const res = await proxy(req)
    expect(middlewareFactory).toHaveBeenCalledWith({ loginUrl: '/en/auth/login' })
    expect(authMiddlewareSpy).toHaveBeenCalledTimes(1)
    expect(intlSpy).not.toHaveBeenCalled()
    expect(res.status).toBe(302)
  })

  it('derives a locale-aware loginUrl for zh-HK paths', async () => {
    const { proxy } = await import('@/proxy')
    const req = new NextRequest(
      'https://app.example.com/zh-HK/dashboard?neon_auth_session_verifier=abc123',
      { headers: { cookie: `${CHALLENGE_COOKIE}=challenge-value` } }
    )
    await proxy(req)
    expect(middlewareFactory).toHaveBeenCalledWith({ loginUrl: '/zh-HK/auth/login' })
  })

  it('routes verifier requests WITHOUT the challenge cookie through intl (magic-link flow — the client page completes the exchange)', async () => {
    const { proxy } = await import('@/proxy')
    // Regression: production logs showed exactly this request shape being
    // delegated to the middleware, which bounced the user to the login page
    // because the exchange requires the challenge cookie the magic-link flow
    // never sets.
    const req = new NextRequest(
      'https://app.example.com/en/auth/complete?next=%2Fen%2Fdashboard&neon_auth_session_verifier=abc123'
    )
    await proxy(req)
    expect(intlSpy).toHaveBeenCalledTimes(1)
    expect(middlewareFactory).not.toHaveBeenCalled()
  })

  it('routes ordinary requests through intl middleware without touching auth', async () => {
    const { proxy } = await import('@/proxy')
    const req = new NextRequest('https://app.example.com/en/pricing')
    await proxy(req)
    expect(intlSpy).toHaveBeenCalledTimes(1)
    expect(middlewareFactory).not.toHaveBeenCalled()
  })
})
