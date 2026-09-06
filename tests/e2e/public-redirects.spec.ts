import { test, expect } from '@playwright/test'

const aliases = [
  ['/platform/search-visibility', '/platform/search-intelligence'],
  ['/foundation', '/platform/site-health'],
  ['/answer-readiness', '/platform/demand-intelligence'],
  ['/citation-readiness', '/platform/ai-visibility'],
  ['/ai-pulse', '/platform/ai-visibility'],
] as const

test.describe('public alias redirects', () => {
  for (const [source, destination] of aliases) {
    for (const locale of ['', '/en', '/zh-HK']) {
      test(`${locale}${source} returns 308 and renders its destination`, async ({ request, page }) => {
        const response = await request.get(`${locale}${source}?ref=compatibility`, { maxRedirects: 0 })
        expect(response.status()).toBe(308)
        const target = new URL(response.headers().location, response.url())
        expect(target.pathname).toBe(`${locale || '/en'}${destination}`)
        expect(target.searchParams.get('ref')).toBe('compatibility')

        const rendered = await page.goto(`${locale}${source}?ref=compatibility`)
        expect(rendered?.status()).toBe(200)
        await expect(page).toHaveURL(target.href)
        await expect(page.locator('main h1')).toHaveCount(1)
        await expect(page.locator('html')).toHaveAttribute('lang', locale === '/zh-HK' ? 'zh-HK' : 'en')
      })
    }
  }

  for (const path of ['/pricing', '/auth/login', '/how-it-works']) {
    test(`bare ${path} redirects to English`, async ({ request }) => {
      const response = await request.get(path, { maxRedirects: 0 })
      expect(response.status()).toBe(308)
      expect(new URL(response.headers().location, response.url()).pathname).toBe(`/en${path}`)
    })
  }
})
