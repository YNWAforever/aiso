import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
import { A11Y_LOCALES, A11Y_THEMES } from './matrix'

const catalogs = { en, 'zh-HK': zhHK }

async function settle(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running'))
}

/**
 * UX Phase 2 landing page. The repo-wide a11y matrix (scan.spec.ts) keeps
 * ratcheting the home route; this spec adds the landing-specific promises:
 * zero violations, one primary call to action per viewport, no overflow, and
 * reduced motion showing every section's finished state without scrolling.
 */
for (const locale of A11Y_LOCALES) {
  for (const theme of A11Y_THEMES) {
    test(`landing ${locale} ${theme}: zero axe violations and no overflow`, async ({ page }) => {
      await page.route('**/api/**', route => route.abort('blockedbyclient'))
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
      await page.goto(`/${locale}`, { waitUntil: 'networkidle' })
      await expect(page.getByRole('heading', { level: 1, name: catalogs[locale].landing.hero.title })).toBeVisible()
      await settle(page)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
      // Every axe rule, best practices included: the repo-wide ratchet counts them too,
      // and landmark-unique (a best practice) is what a WCAG-only scan missed here.
      const results = await new AxeBuilder({ page }).analyze()
      expect(results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([])
    })
  }

  test(`landing ${locale}: at most one primary call to action per viewport`, async ({ page }) => {
    await page.route('**/api/**', route => route.abort('blockedbyclient'))
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(`/${locale}`, { waitUntil: 'networkidle' })
    const counts = await page.evaluate(async () => {
      const seen: number[] = []
      const height = window.innerHeight
      for (let y = 0; y < document.documentElement.scrollHeight; y += Math.round(height / 2)) {
        window.scrollTo(0, y)
        await new Promise(resolve => requestAnimationFrame(() => resolve(null)))
        seen.push([...document.querySelectorAll('[data-cta="primary"]')].filter(el => {
          const box = el.getBoundingClientRect()
          return box.width > 0 && box.bottom > 0 && box.top < height
        }).length)
      }
      return seen
    })
    expect(Math.max(...counts)).toBe(1)
  })

  test(`landing ${locale}: reduced motion shows finished sections without scrolling`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(`/${locale}`, { waitUntil: 'networkidle' })
    const copy = catalogs[locale].landing
    await expect(page.getByRole('list', { name: copy.how.title }).locator('li').last()).toHaveCSS('opacity', '1')
    await expect(page.getByTestId('check-heatmap').locator('li').last()).toHaveCSS('opacity', '1')
    await expect(page.getByText(copy.compare.source)).toHaveCSS('opacity', '1')
  })
}
