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
    ['/en/result/scan-123?claim=1', '/en/result/scan-123?claim=1'],
  ])('normalizes the post-auth target %s', (next, expected) => {
    expect(normalizeAuthNext('en', next)).toBe(expected)
  })


  it.each([
    ['en', '/en/result/scan-en?claim=1'],
    ['zh-HK', '/zh-HK/result/scan-zh?claim=1'],
  ])('preserves a valid locale-local continuation for %s', (lang, next) => {
    expect(normalizeAuthNext(lang, next)).toBe(next)
  })

  it.each([
    ['en', 'https://attacker.example/phish'],
    ['zh-HK', '//attacker.example/phish'],
    ['zh-HK', '/en/dashboard'],
  ])('falls back to the local dashboard for an unsafe %s continuation', (lang, next) => {
    expect(normalizeAuthNext(lang, next)).toBe(`/${lang}/dashboard`)
  })

  it('builds a same-origin top-level bridge URL that preserves the scan result target', () => {
    expect(authModule.buildGoogleAuthStartUrl('en', '/en/result/scan-123?claim=1')).toBe(
      '/en/auth/google?next=%2Fen%2Fresult%2Fscan-123%3Fclaim%3D1',
    )
  })

  it.each([
    ['https://attacker.example/phish', '/en/dashboard'],
    ['//attacker.example/phish', '/en/dashboard'],
    ['/zh-HK/dashboard', '/en/dashboard'],
  ])('sanitizes unsafe Google bridge continuations %s', (next, expected) => {
    expect(authModule.buildGoogleAuthStartUrl('en', next)).toBe(
      `/en/auth/google?next=${encodeURIComponent(expected)}`,
    )
  })

  it('builds a localized auth-complete URL with a same-origin continuation', () => {
    const previousWindow = globalThis.window
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { origin: 'https://preview.example.test' } },
    })

    expect(authModule.buildAuthCompleteUrl('en', '/en/result/scan-1?claim=1')).toBe(
      'https://preview.example.test/en/auth/complete?next=%2Fen%2Fresult%2Fscan-1%3Fclaim%3D1',
    )
    expect(authModule.buildAuthCompleteUrl('en', 'https://attacker.example/phish')).toBe(
      'https://preview.example.test/en/auth/complete?next=%2Fen%2Fdashboard',
    )
    expect(authModule.buildAuthCompleteUrl('zh-HK', '/zh-HK/result/scan-zh?claim=1')).toBe(
      'https://preview.example.test/zh-HK/auth/complete?next=%2Fzh-HK%2Fresult%2Fscan-zh%3Fclaim%3D1',
    )

    Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow })
  })

  it('returns an actionable failure when the top-level bridge cannot start Google auth', async () => {
    const result = await authModule.startGoogleAuthRedirect(
      vi.fn().mockRejectedValue(new Error('network down')),
    )

    expect(result.error?.code).toBe('GOOGLE_AUTH_START_FAILED')
  })

  it('passes through the SDK response when Google auth starts', async () => {
    const response = { data: { redirect: true, url: 'https://accounts.google.com' }, error: null }
    const request = vi.fn().mockResolvedValue(response)

    await expect(authModule.startGoogleAuthRedirect(request)).resolves.toBe(response)
    expect(request).toHaveBeenCalledOnce()
  })
})
