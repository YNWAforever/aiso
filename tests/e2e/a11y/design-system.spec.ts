import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
import { A11Y_LOCALES, A11Y_THEMES } from './matrix'

const catalogs = { en, 'zh-HK': zhHK }

/**
 * The Phase 1 gallery (/[lang]/dev/design-system) renders every token and
 * component, so this one page is the accessibility gate for all of them in
 * both languages, both themes and all four a11y widths. Strict zero: it is new
 * code, so there is no baseline to ratchet against.
 */
for (const locale of A11Y_LOCALES) {
  for (const theme of A11Y_THEMES) {
    test(`design system ${locale} ${theme}: no axe violations, no overflow`, async ({ page }) => {
      await page.route('**/api/**', route => route.abort('blockedbyclient'))
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
      await page.goto(`/${locale}/dev/design-system`, { waitUntil: 'networkidle' })
      const copy = catalogs[locale].designSystem

      await expect(page.getByRole('heading', { level: 1, name: copy.title })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(theme === 'dark')
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)

      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
      expect(results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([])
    })
  }

  test(`design system ${locale}: reduced motion renders end states immediately`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(`/${locale}/dev/design-system`, { waitUntil: 'networkidle' })
    const rings = page.getByTestId('score-ring')
    await expect(rings.nth(1)).toContainText('68')
    await expect(page.getByTestId('pillar-gauge-core')).toContainText('38')
    // The hero shows its finished frame: score drawn, platforms lit.
    const hero = page.getByTestId('hero-demo')
    await hero.scrollIntoViewIfNeeded()
    await expect(hero.getByText('72', { exact: true })).toHaveCSS('opacity', '1')
  })

  test(`design system ${locale}: heatmap tile opens the detail drawer by keyboard`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(`/${locale}/dev/design-system`, { waitUntil: 'networkidle' })
    const tile = page.getByTestId('check-heatmap').getByRole('button').nth(1)
    await tile.focus()
    await page.keyboard.press('Enter')
    const drawer = page.getByRole('dialog')
    await expect(drawer).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden()
    await expect(tile).toBeFocused()
  })
}
