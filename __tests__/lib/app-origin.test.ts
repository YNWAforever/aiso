import { describe, it, expect, vi, afterEach } from 'vitest'
import { DEFAULT_APP_ORIGIN, appOrigin } from '@/lib/app-origin'

afterEach(() => { vi.unstubAllEnvs() })

describe('appOrigin', () => {
  it('prefers the configured origin', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://staging.example.com')
    expect(appOrigin()).toBe('https://staging.example.com')
  })

  it('falls back to a single default when unconfigured', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', undefined)
    expect(appOrigin()).toBe(DEFAULT_APP_ORIGIN)
  })

  // Set-but-empty is a different state from unset, and it is the one that
  // actually happens: Vercel and GitHub Actions both substitute '' for a
  // variable that is declared but has no value. `??` does not fall back on '',
  // so appOrigin() returned '' and lib/seo.ts's module-scope
  // `new URL(appOrigin())` threw `TypeError: Invalid URL { input: '' }` during
  // "Collecting page data", failing the whole build. Observed on Vercel
  // 2026-09-01; the GitHub Actions build job passed at the same commit, so the
  // config gap was invisible until a second builder ran.
  it('falls back when the variable is set but empty', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    expect(appOrigin()).toBe(DEFAULT_APP_ORIGIN)
  })

  it('falls back when the variable is only whitespace', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '   ')
    expect(appOrigin()).toBe(DEFAULT_APP_ORIGIN)
  })

  // The failure this guards is a build crash, not a wrong string, so assert the
  // property the crash violated rather than only the return value.
  it('always returns something new URL() accepts', () => {
    for (const value of ['', '   ', undefined]) {
      vi.stubEnv('NEXT_PUBLIC_APP_URL', value)
      expect(() => new URL(appOrigin())).not.toThrow()
    }
  })

  it('is the only origin every consumer resolves to', async () => {
    // The regression: lib/seo.ts, lib/stripe.ts and lib/reports/service.ts each
    // carried a *different* hardcoded fallback, so an unconfigured deploy put
    // SEO canonicals, Stripe redirects and signed share links on three hosts.
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://one-host.example.com')
    vi.resetModules()

    const { SITE_URL } = await import('@/lib/seo')
    const { APP_URL } = await import('@/lib/stripe')

    expect(SITE_URL.origin).toBe('https://one-host.example.com')
    expect(APP_URL).toBe('https://one-host.example.com')
  })
})
