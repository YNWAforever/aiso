import { describe, expect, it } from 'vitest'
import { unstable_getResponseFromNextConfig } from 'next/experimental/testing/server'
import nextConfig from '../../next.config'

const aliases = [
  ['/platform/search-visibility', '/platform/search-intelligence'],
  ['/foundation', '/platform/site-health'],
  ['/answer-readiness', '/platform/demand-intelligence'],
  ['/citation-readiness', '/platform/ai-visibility'],
  ['/ai-pulse', '/platform/ai-visibility'],
] as const

describe('frozen public redirect contract', () => {
  for (const [source, destination] of aliases) {
    for (const locale of ['', '/en', '/zh-HK']) {
      it(`permanently redirects ${locale}${source} with locale and query preserved`, async () => {
        const response = await unstable_getResponseFromNextConfig({
          url: `https://example.test${locale}${source}?ref=review`,
          nextConfig,
        })
        expect(response.status).toBe(308)
        expect(response.headers.get('location')).toBe(
          `https://example.test${locale || '/en'}${destination}?ref=review`,
        )
      })
    }
  }

  for (const path of ['/pricing', '/auth/login', '/how-it-works']) {
    it(`redirects bare ${path} to English`, async () => {
      const response = await unstable_getResponseFromNextConfig({
        url: `https://example.test${path}`, nextConfig,
      })
      expect(response.status).toBe(308)
      expect(response.headers.get('location')).toBe(`https://example.test/en${path}`)
    })
  }

  for (const path of [
    '/en/r/signed-report', '/zh-HK/r/expired-report', '/en/result/scan-id',
    '/en/dashboard/client/integrations', '/en/sample-report', '/zh-HK/how-it-works',
    '/fr/foundation', '/foundation/extra',
  ]) {
    it(`does not intercept ${path}`, async () => {
      const response = await unstable_getResponseFromNextConfig({
        url: `https://example.test${path}`, nextConfig,
      })
      expect(response.headers.get('location')).toBeNull()
    })
  }
})
