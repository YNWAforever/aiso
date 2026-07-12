/**
 * proxy.ts routing decision: requests returning from a Neon Auth OAuth/magic-link
 * completion carry a `neon_auth_session_verifier` query param and MUST be delegated
 * to the Neon Auth middleware (the only place the verifier → session-cookie
 * exchange is implemented). Everything else goes to next-intl routing.
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

describe('proxy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delegates requests carrying the Neon Auth session verifier to the auth middleware', async () => {
    const { proxy } = await import('@/proxy')
    const req = new NextRequest(
      'https://app.example.com/en/dashboard?neon_auth_session_verifier=abc123'
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
      'https://app.example.com/zh-HK/dashboard?neon_auth_session_verifier=abc123'
    )
    await proxy(req)
    expect(middlewareFactory).toHaveBeenCalledWith({ loginUrl: '/zh-HK/auth/login' })
  })

  it('routes ordinary requests through intl middleware without touching auth', async () => {
    const { proxy } = await import('@/proxy')
    const req = new NextRequest('https://app.example.com/en/pricing')
    await proxy(req)
    expect(intlSpy).toHaveBeenCalledTimes(1)
    expect(middlewareFactory).not.toHaveBeenCalled()
  })
})
