import { describe, expect, it, vi } from 'vitest'

vi.mock('@neondatabase/auth/next', () => ({
  createAuthClient: vi.fn(() => ({})),
}))

import * as authModule from '@/lib/auth-client'
import { normalizeAuthNext } from '@/lib/auth-navigation'

describe('Google auth navigation', () => {
  it.each([
    ['https://attacker.example', '/en/dashboard'],
    ['//attacker.example', '/en/dashboard'],
    ['/zh-HK/dashboard', '/en/dashboard'],
    ['/en/../zh-HK/dashboard', '/en/dashboard'],
    ['/en/dashboard#section', '/en/dashboard#section'],
    ['/en/onboarding?scan=scan-123', '/en/onboarding?scan=scan-123'],
  ])('normalizes the post-auth target %s', (next, expected) => {
    expect(normalizeAuthNext('en', next)).toBe(expected)
  })


  it('builds a same-origin top-level bridge URL that preserves the scan onboarding target', () => {
    const buildURL = authModule.buildGoogleAuthStartUrl ?? (() => '')

    expect(buildURL('en', '/en/onboarding?scan=scan-123')).toBe(
      '/en/auth/google?next=%2Fen%2Fonboarding%3Fscan%3Dscan-123',
    )
  })

  it('returns an actionable failure when the top-level bridge cannot start Google auth', async () => {
    const start = authModule.startGoogleAuthRedirect ?? (async () => ({ error: null }))

    const result = await start(vi.fn().mockRejectedValue(new Error('network down')))

    expect(result.error?.code).toBe('GOOGLE_AUTH_START_FAILED')
  })

  it('passes through the SDK response when Google auth starts', async () => {
    const response = { data: { redirect: true, url: 'https://accounts.google.com' }, error: null }
    const request = vi.fn().mockResolvedValue(response)
    const start = authModule.startGoogleAuthRedirect ?? (async () => ({ error: null }))

    await expect(start(request)).resolves.toBe(response)
    expect(request).toHaveBeenCalledOnce()
  })
})
