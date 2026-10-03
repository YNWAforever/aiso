import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
async function openPrompts(page: Page, lang: string) {
  const dir = process.env.PROMPT_BANK_HTML_DIR
  if (!dir) throw new Error('Real prompt component fixtures required')
  const html = readFileSync(`${dir}/${lang}.html`, 'utf8'), js = readFileSync(`${dir}/fixture.js`, 'utf8'), css = readFileSync(`${dir}/build.css`, 'utf8')
  const copy = JSON.parse(readFileSync(`${dir}/${lang}-copy.json`, 'utf8'))
  await page.route('**/*', route => route.abort())
  await page.route('https://prompts.fixture/', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="${lang}"><head><title>Context acceptance</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${html}<script>${js}</script></body></html>` }))
  await page.goto('https://prompts.fixture/')
  await page.waitForFunction(() => Boolean((window as Window & { promptFixtureReady?: boolean }).promptFixtureReady))
  return copy
}
for (const lang of ['en', 'zh-HK']) test(`confirmed language market survives add and edit retry ${lang}`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 })
  const copy = await openPrompts(page, lang)
  const form = page.locator('form').first()
  const language = form.getByRole('combobox', { name: copy.qb_language }), market = form.getByRole('combobox', { name: copy.qb_market })
  await expect(language).toHaveValue(lang)
  await market.selectOption('HK')
  await form.getByRole('textbox').fill('Synthetic context question?')
  const writes: Record<string, unknown>[] = []
  await page.route('**/api/dashboard/clients/*/prompts', route => {
    const body = route.request().postDataJSON(); writes.push(body)
    return route.fulfill({ status: 201, json: { prompt: { ...body, id: 'context-1', client_id: 'client-1', is_active: true, created_at: '2026-10-03' } } })
  })
  await form.getByRole('button', { name: copy.qb_add, exact: true }).click()
  expect(writes[0]).toMatchObject({ language: lang, market: 'HK' })
  const edit = page.getByRole('button', { name: copy.qb_edit_label.replace('{question}', 'Synthetic context question?'), exact: true })
  await expect(edit).toBeVisible(); await edit.click()
  const row = page.locator('[aria-busy]').filter({ has: page.getByRole('textbox', { name: copy.qb_edit_label.replace('{question}', 'Synthetic context question?'), exact: true }) })
  await row.getByRole('combobox', { name: copy.qb_language }).selectOption(lang === 'en' ? 'zh-HK' : 'en')
  await row.getByRole('combobox', { name: copy.qb_market }).selectOption('US')
  let status = 503
  await page.route('**/api/dashboard/clients/*/prompts/context-1', route => { writes.push(route.request().postDataJSON()); return route.fulfill({ status, json: {} }) })
  await row.getByRole('button', { name: copy.save, exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(row.getByRole('combobox', { name: copy.qb_market })).toHaveValue('US')
  status = 200
  await row.getByRole('button', { name: copy.save, exact: true }).click()
  await expect(edit).toBeVisible()
  expect(writes.at(-1)).toMatchObject({ language: lang === 'en' ? 'zh-HK' : 'en', market: 'US' })
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: `artifacts/aiso/T11/${lang}-${test.info().project.name}-context.png`, fullPage: true })
})
