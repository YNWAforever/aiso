import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'

// Component acceptance only: no authenticated route or provider request is bypassed.
// Generate HTML by running workspace-home-render.test.tsx with C8A_HTML_DIR set.
// Supply the CSS emitted by the sanitized local build, never production credentials.
for (const lang of ['en', 'zh-HK'] as const) for (const width of [375,1440]) for (const theme of ['light','dark'] as const) {
  test(`C8a workspace component ${lang} ${width} ${theme}`, async ({ page }) => {
    const cssPath = process.env.C8A_CSS_PATH
    const htmlDir = process.env.C8A_HTML_DIR
    test.skip(!cssPath || !htmlDir, 'Set C8A_CSS_PATH and C8A_HTML_DIR after generating sanitized component fixtures')
    const css = readFileSync(cssPath!, 'utf8')
    const copy = JSON.parse(readFileSync(`${htmlDir}/${lang}-copy.json`, 'utf8')) as { freshnessUnknown: string; draft: string; states: Record<string, string> }
    await page.route('**/*', route => route.abort())
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
    for (const state of ['empty','error','locked','ready'] as const) {
      const html = readFileSync(`${htmlDir}/${lang}-${state}.html`, 'utf8')
      await page.setContent(`<!doctype html><html lang="${lang}" class="${theme}"><head><title>Workspace component acceptance</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>${html}</body></html>`)
      await expect(page.getByRole('heading',{level:1})).toHaveText('Example Brand')
      await expect(page.getByRole('main')).toContainText(copy.freshnessUnknown)
      if (state !== 'ready') {
        await expect(page.getByRole('main')).toContainText(copy.states[state])
        await expect(page.getByRole('main')).not.toContainText('0%')
      } else {
        await expect(page.getByRole('main')).toContainText(copy.draft)
        await expect(page.getByRole('main')).toContainText('25%')
        await expect(page.getByRole('main')).toContainText('2026-09-05')
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      for (const step of ['scan','results','improve','monitor','roi']) await expect(page.locator(`a[href="/${lang}/dashboard/fixture-client?step=${step}"]`).first()).toBeVisible()
      const violations = (await new AxeBuilder({page}).analyze()).violations
      expect(violations).toEqual([])
    }
  })
}
