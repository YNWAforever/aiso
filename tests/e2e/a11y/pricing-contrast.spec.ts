import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
import { A11Y_LOCALES, A11Y_THEMES } from './matrix'

const catalogs = { en, 'zh-HK': zhHK }

for (const locale of A11Y_LOCALES) {
  for (const theme of A11Y_THEMES) {
    test(`pricing primary surfaces contrast ${locale} ${theme}`, async ({ page }) => {
      await page.route('**/api/**', route => route.abort('blockedbyclient'))
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
      await page.goto(`/${locale}/pricing`, { waitUntil: 'networkidle' })
      const copy = catalogs[locale].pricing
      const button = page.getByRole('button', { name: copy.cta_pro, exact: true })
      await expect(page.getByText(copy.popular, { exact: true })).toBeVisible()
      await expect(button).toBeVisible()
      await expect(page.locator('main span.bg-primary')).toHaveCount(1)
      await expect(page.locator('main button.bg-primary')).toHaveCount(1)
      const badge = page.getByText(copy.popular, { exact: true })
      // Exercise wider text metrics as well as the host font: Linux CI exposed
      // wrapping that the default Windows font did not reproduce.
      for (const textScale of [1, 2]) {
        const layout = await badge.evaluate((element, scale) => {
          const originalSize = element.style.fontSize
          const size = Number.parseFloat(getComputedStyle(element).fontSize)
          element.style.fontSize = `${size * scale}px`
          const range = document.createRange()
          range.selectNodeContents(element)
          const lines = new Set(Array.from(range.getClientRects(), rect => rect.top)).size
          const badgeRect = element.getBoundingClientRect()
          const planName = element.parentElement!.nextElementSibling!.getBoundingClientRect()
          element.style.fontSize = originalSize
          return { lines, bottom: badgeRect.bottom, planTop: planName.top }
        }, textScale)
        expect(layout.lines, `${locale} ${theme} badge at ${textScale}x text`).toBe(1)
        expect(layout.bottom, 'badge must not overlap the plan name').toBeLessThanOrEqual(layout.planTop)
      }
      for (const state of ['default', 'hover', 'focus'] as const) {
        if (state === 'hover') await button.hover()
        if (state === 'focus') {
          await page.mouse.move(0, 0)
          await button.focus()
        }
        const result = await new AxeBuilder({ page })
          .include('main span.bg-primary').include('main button.bg-primary')
          .withRules(['color-contrast']).analyze()
        expect(result.violations, `${locale} ${theme} ${state}`).toEqual([])
        expect(result.incomplete, `${locale} ${theme} ${state} must be measurable`).toEqual([])
      }
    })
  }
}
