import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

/**
 * The Neon Auth catch-all handler is one of only three intentionally public
 * routes, and the only one whose module body used to construct a client.
 *
 * `export const { GET, POST, ... } = auth().handler()` ran createNeonAuth at
 * module scope, which validates cookies.secret and throws when it is missing.
 * Next evaluates every route module during "Collecting page data", so a build
 * in an environment without NEON_AUTH_COOKIE_SECRET died with
 * "Failed to collect page data for /api/auth/[...path]" -- observed on a Vercel
 * preview deploy 2026-09-01. `export const dynamic = 'force-dynamic'` does not
 * exempt a route from that evaluation, which is why CLAUDE.md's rule is the
 * blunt one: never call db() or auth() at module scope in a route file.
 */
describe('app/api/auth/[...path] route', () => {
  it('imports without constructing the auth client', async () => {
    // Set-but-empty rather than unset: that is what a deploy environment with
    // the variable declared but never given a value actually presents.
    vi.stubEnv('NEON_AUTH_BASE_URL', '')
    vi.stubEnv('NEON_AUTH_COOKIE_SECRET', '')
    vi.resetModules()

    await expect(import('@/app/api/auth/[...path]/route')).resolves.toBeDefined()
  })

  it('still exports every method the Neon Auth handler provides', async () => {
    vi.stubEnv('NEON_AUTH_BASE_URL', 'https://auth.example.com')
    vi.stubEnv('NEON_AUTH_COOKIE_SECRET', 'x'.repeat(32))
    vi.resetModules()

    const route = await import('@/app/api/auth/[...path]/route')

    // Dropping one silently breaks that verb for every auth request, with no
    // error anywhere -- Next would simply 405 it.
    for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const) {
      expect(typeof route[method]).toBe('function')
    }
  })
})
