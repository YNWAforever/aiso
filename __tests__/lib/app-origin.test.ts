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
