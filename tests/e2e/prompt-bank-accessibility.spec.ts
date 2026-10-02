import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
async function fixture(page: Page, lang: string) {
  const dir = process.env.PROMPT_BANK_HTML_DIR
  if (!dir) throw new Error('Question bank fixtures required; skips are not acceptance')
  const html = readFileSync(`${dir}/${lang}.html`, 'utf8'), js = readFileSync(`${dir}/fixture.js`, 'utf8'), css = readFileSync(`${dir}/build.css`, 'utf8')
  const copy = JSON.parse(readFileSync(`${dir}/${lang}-copy.json`, 'utf8')) as Record<string, string>
  await page.route('**/*', route => route.abort())
  await page.route('https://prompts.fixture/', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="${lang}"><head><title>Question bank acceptance</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${html}<script>${js}</script></body></html>` }))
  await page.goto('https://prompts.fixture/')
  await page.waitForFunction(() => Boolean((window as Window & { promptFixtureReady?: boolean }).promptFixtureReady))
  return copy
}
for (const lang of ['en', 'zh-HK']) for (const width of [360, 390]) test(`keyboard names, retry and touch areas ${lang} ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 850 })
  const copy = await fixture(page, lang)
  const label = (key: string, question = 'What is AcmeCo?') => copy[key].replace('{question}', question)
  let status = 503, writes = 0
  await page.route('**/api/dashboard/clients/*/prompts/*', route => { writes++; return route.fulfill({ status, json: {} }) })
  const toggle = page.getByRole('switch', { name: label('qb_toggle_label'), exact: true })
  await toggle.focus()
  await page.keyboard.press('Space')
  await expect(page.getByRole('alert')).toHaveText(copy.qb_save_failed)
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect(toggle).toBeFocused()
  status = 200
  await page.keyboard.press('Space')
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByRole('status')).toHaveText(copy.qb_saved)
  expect(writes).toBe(2)
  const edit = page.getByRole('button', { name: label('qb_edit_label'), exact: true })
  await edit.focus(); await page.keyboard.press('Enter')
  const input = page.getByRole('textbox', { name: label('qb_edit_label'), exact: true })
  await expect(input).toBeFocused()
  await input.fill('Unsaved question edit')
  status = 503
  await page.keyboard.press('Enter')
  await expect(input).toHaveValue('Unsaved question edit')
  await expect(page.getByRole('alert')).toHaveText(copy.qb_save_failed)
  await expect(input).toBeEnabled()
  await expect(input).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(edit).toBeFocused()
  await expect(page.getByText('What is AcmeCo?', { exact: true })).toBeVisible()
  await edit.click(); await input.fill('Retried question')
  status = 200
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: label('qb_edit_label', 'Retried question'), exact: true })).toBeFocused()
  const add = page.getByLabel(copy.qb_add_label.replace('{category}', copy.cat_brand_query), { exact: true })
  await add.fill('New question draft')
  await page.route('**/api/dashboard/clients/*/prompts', route => route.fulfill({ status: 503, json: {} }))
  await add.press('Enter')
  await expect(add).toHaveValue('New question draft')
  await expect(add).toBeEnabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  for (const button of await page.getByRole('button').all()) {
    const rect = await button.boundingBox()
    if (rect) { expect(rect.height).toBeGreaterThanOrEqual(44); expect(rect.width).toBeGreaterThanOrEqual(44) }
  }
  const toggleBox = await page.getByRole('switch', { name: label('qb_toggle_label', 'Retried question'), exact: true }).boundingBox()
  expect(toggleBox!.height).toBeGreaterThanOrEqual(44)
  expect(toggleBox!.width).toBeGreaterThanOrEqual(44)
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  await page.screenshot({ path: `artifacts/aiso/T13/${lang}-${width}-${test.info().project.name}.png`, fullPage: true })
})
