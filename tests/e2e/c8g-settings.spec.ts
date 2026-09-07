import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'

// Offline presentation acceptance. Generate with settings-render.test.tsx and
// C8G_HTML_DIR; use the built stylesheet via C8G_CSS_PATH. No auth bypass route.
for (const lang of ['en', 'zh-HK']) for (const width of [375, 1440]) for (const theme of ['light', 'dark'] as const) {
  test(`C8g settings ${lang} ${width} ${theme}`, async ({ page }) => {
    const htmlDir = process.env.C8G_HTML_DIR
    const cssPath = process.env.C8G_CSS_PATH
    test.skip(!htmlDir || !cssPath, 'Set C8G_HTML_DIR and C8G_CSS_PATH using sanitized component artifacts')
    const copy = JSON.parse(readFileSync(`${htmlDir}/${lang}-copy.json`, 'utf8')) as {
      title: string; billingUnavailable: string; manageBilling: string; pricing: string
      statusLabels: Record<string, string>
    }
    const css = readFileSync(cssPath!, 'utf8')
    await page.route('**/*', route => route.abort())
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
    for (const status of ['unknown', 'active', 'trialing', 'past_due', 'cancelled']) {
      const html = readFileSync(`${htmlDir}/${lang}-${status}.html`, 'utf8')
      await page.setContent(`<!doctype html><html lang="${lang}" class="${theme}"><head><title>Settings component acceptance</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>${html}</body></html>`)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(copy.title)
      await expect(page.getByRole('main')).toContainText(copy.statusLabels[status])
      const portal = page.getByRole('link', { name: copy.manageBilling })
      if (status === 'unknown') {
        await expect(portal).toHaveCount(0)
        await expect(page.getByRole('main')).toContainText(copy.billingUnavailable)
        await expect(page.getByRole('main')).not.toContainText(copy.statusLabels.active)
      } else {
        await expect(portal).toHaveAttribute('href', '/api/stripe/portal')
        await portal.focus()
        await expect(portal).toBeFocused()
      }
      const pricing = page.getByRole('link', { name: copy.pricing })
      await expect(pricing).toHaveAttribute('href', `/${lang}/pricing`)
      await pricing.focus()
      await expect(pricing).toBeFocused()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    }
  })
}
