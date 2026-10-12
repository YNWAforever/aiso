import { test, expect } from '@playwright/test'

/**
 * WCAG 1.4.4 / 1.4.10: /pricing must not scroll sideways at 200% text.
 *
 * Root font-size, not browser zoom: media queries ignore it, so this is the
 * case where `md:` layouts stay wide while their text doubles. It caught two
 * faults: the comparison table's sr-only labels are position:absolute and
 * escaped the overflow-x:auto region (it was not their containing block), and
 * md:grid-cols-3 kept 197px plan cards that the price could not fit.
 */
for (const locale of ['en', 'zh-HK']) for (const width of [375, 768, 1024, 1440]) {
  test(`pricing reflows at 200% text ${locale} ${width}`, async ({ page }) => {
    await page.route('**/api/**', route => route.abort())
    await page.setViewportSize({ width, height: 900 })
    await page.goto(`/${locale}/pricing`)
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible()
    for (const fontSize of ['16px', '32px']) {
      await page.evaluate(size => { document.documentElement.style.fontSize = size }, fontSize)
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `${fontSize} root text`,
      ).toBe(true)
    }
  })
}
