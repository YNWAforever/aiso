import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mkdirSync, readFileSync } from 'node:fs'
import en from '../../messages/en.json'
import zh from '../../messages/zh-HK.json'

// Real server-component markup + final build CSS. All network is denied;
// these cases do not establish production auth, persistence or user acceptance.
const states = ['primary', 'setup', 'scoped', 'recorded', 'unavailable', 'empty', 'dedup', 'long', 'sitefix'] as const
for (const lang of ['en', 'zh-HK'] as const) for (const width of [320, 390, 768, 1440]) for (const theme of ['light', 'dark'] as const) {
  test(`SME activation Today ${lang} ${width} ${theme}`, async ({ page }, testInfo) => {
    const directory = process.env.C8A_HTML_DIR, cssPath = process.env.C8A_CSS_PATH
    if (!directory || !cssPath) throw new Error('Generate real Today component fixtures with final build CSS')
    const css = readFileSync(cssPath, 'utf8'), copy = (lang === 'en' ? en : zh).today
    const requests: string[] = [], errors: string[] = []
    await page.route('**/*', route => { requests.push(route.request().method()); return route.abort() })
    page.on('pageerror', error => errors.push(error.message))
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
    const base = `/${lang}/dashboard/c1`
    const primaryHref: Record<typeof states[number], string> = {
      primary: `${base}/opportunities?draft=work-1`,
      setup: `${base}/prompts`,
      scoped: `${base}/observations?run=saved&week=2026-11-09#run-status`,
      recorded: `${base}/opportunities`,
      unavailable: `${base}/opportunities`,
      empty: `${base}/opportunities`,
      dedup: `${base}/opportunities?draft=work-1`,
      long: `${base}/opportunities?draft=work-1`,
      sitefix: `${base}?step=results&scanId=scan-a`,
    }
    for (const state of states) {
      const html = readFileSync(`${directory}/${lang}-today-${state}.html`, 'utf8')
      await page.setContent(`<!doctype html><html lang="${lang}" class="${theme}"><head><meta charset="utf-8"><title>Controlled Today component acceptance</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${html}</body></html>`)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Example')
      const hero = page.locator('section[aria-labelledby="today-action-heading"]')
      const links = hero.getByRole('link')
      await expect(links).toHaveCount(['primary', 'empty', 'dedup', 'long'].includes(state) ? 1 : 2)
      await expect(links.first()).toHaveAttribute('href', primaryHref[state])
      for (const link of await links.all()) expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44)
      await links.first().focus()
      await expect(links.first()).toBeFocused()
      if (await links.count() === 2) {
        await page.keyboard.press('Tab')
        await expect(links.nth(1)).toBeFocused()
      }
      if (state === 'recorded') {
        await expect(hero).toContainText(copy.savedWork.status.delivered)
        await expect(hero).not.toContainText(/verified|已驗證|verified_live/i)
      }
      if (state === 'unavailable') {
        await expect(hero).toContainText(copy.savedWork.unavailable)
        await expect(hero).not.toContainText('STALE PRIVATE TITLE')
        await expect(links.nth(1)).toHaveAttribute('href', `${base}/tasks`)
      }
      if (state === 'primary' || state === 'long') await expect(links.first()).toHaveText(copy.savedWork.open)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
      expect(errors).toEqual([])
      if (state === 'primary' && ((lang === 'en' && width === 1440 && theme === 'light') || (lang === 'zh-HK' && width === 390 && theme === 'dark'))) {
        mkdirSync('artifacts/ux', { recursive: true })
        await page.screenshot({ path: `artifacts/ux/activation1-today-${lang}-${width}-${theme}-${testInfo.project.name}.png`, fullPage: true })
      }
    }
    expect(requests.filter(method => !['GET', 'HEAD', 'OPTIONS'].includes(method))).toEqual([])
  })
}
