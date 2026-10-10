import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
for (const lang of ['en', 'zh-HK']) for (const scenario of ['mixed', 'warning', 'incomplete', 'unknown', 'pass', 'not-applicable']) test(`public and owner priority ${lang} ${scenario}`, async ({ page }) => {
  const dir = process.env.AISO_PRIORITY_HTML_DIR
  if (!dir) throw new Error('T03 component fixtures required; no skipped acceptance')
  const html = readFileSync(`${dir}/${lang}-${scenario}.html`, 'utf8'), css = readFileSync(`${dir}/build.css`, 'utf8')
  await page.route('**/*', route => route.abort())
  await page.route('https://priorities.fixture/', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="${lang}"><head><title>Priority acceptance</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${html}</body></html>` }))
  await page.goto('https://priorities.fixture/')
  for (const surface of ['Public', 'Owner']) {
    const region = page.getByRole('region', { name: surface })
    if (['mixed', 'warning', 'incomplete'].includes(scenario)) {
      await expect(region.locator('[data-priority-check]')).toHaveAttribute('data-priority-check', scenario === 'mixed' ? 'c8_sitemap' : 'c6_llms_full_txt')
      await expect(region.locator('[data-severity]')).toHaveAttribute('data-severity', scenario === 'mixed' ? 'fail' : 'warn')
    } else {
      const state = scenario === 'unknown' ? 'insufficient-evidence' : scenario === 'pass' ? 'all-clear' : 'not-applicable'
      await expect(region.locator('[data-priority-state]')).toHaveAttribute('data-priority-state', state)
      await expect(region.locator('[data-severity]')).toHaveCount(0)
      if (scenario === 'unknown') await expect(region.getByRole('link')).toHaveAttribute('href', `/${lang}`)
      else await expect(region.getByRole('link')).toHaveCount(0)
    }
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  if (scenario === 'mixed' || scenario === 'unknown') await page.screenshot({ path: `artifacts/aiso/T03/${lang}-${scenario}-${test.info().project.name}.png`, fullPage: true })
})
