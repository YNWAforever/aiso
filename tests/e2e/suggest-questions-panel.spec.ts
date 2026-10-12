import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'

type Copy = Record<string, string>
const label = (copy: Copy, key: string, number = 1) => copy[key].replace('{number}', String(number))
const question = (language: string, text = 'Can Acme help?') => ({ question: text, category: 'brand_query', language, market: 'HK' })
const saved = (language: string, text: string) => ({ ...question(language, text), id: 'saved-1', client_id: 'client-1', is_active: true, created_at: '2026-10-12T00:00:00Z' })

async function fixture(page: Page, lang: string) {
  const dir = process.env.PROMPT_BANK_HTML_DIR
  if (!dir) throw new Error('Real QuestionBankSection fixtures are required')
  const html = readFileSync(dir + '/' + lang + '-suggestions.html', 'utf8')
  const js = readFileSync(dir + '/suggestions.js', 'utf8'), css = readFileSync(dir + '/build.css', 'utf8')
  const copy: Copy = JSON.parse(readFileSync(dir + '/' + lang + '-copy.json', 'utf8'))
  await page.route('**/*', route => route.abort())
  await page.route('https://suggestions.fixture/', route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: '<!doctype html><html lang="' + lang + '"><head><title>Question suggestions acceptance</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style></head><body>' + html + '<script>' + js + '</script></body></html>',
  }))
  await page.goto('https://suggestions.fixture/')
  await page.waitForFunction(() => Boolean((window as Window & { suggestionFixtureReady?: boolean }).suggestionFixtureReady))
  return copy
}
async function generate(page: Page, copy: Copy, lang: string) {
  await page.route('**/api/pulse/suggest-questions', route => route.fulfill({ json: { suggestions: [question(lang), question(lang, 'Which Acme option fits?')] } }))
  await page.getByRole('button', { name: copy.suggest_more, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: copy.panel_title, exact: true })
  await dialog.getByRole('button', { name: copy.generate_btn, exact: true }).click()
  await expect(dialog.getByRole('textbox', { name: label(copy, 'panel_question_label'), exact: true })).toBeVisible()
  return dialog
}

for (const lang of ['en', 'zh-HK']) {
  test('suggestion dialog traps focus, announces generation errors and restores opener ' + lang, async ({ page }) => {
    const copy = await fixture(page, lang)
    const opener = page.getByRole('button', { name: copy.suggest_more, exact: true })
    let generates = 0
    await page.route('**/api/pulse/suggest-questions', route => { generates++; return route.fulfill({ status: 503, json: {} }) })
    await opener.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: copy.panel_title, exact: true })
    const close = dialog.getByRole('button', { name: copy.panel_close, exact: true })
    await expect(close).toBeFocused()
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press(i < 6 ? 'Tab' : 'Shift+Tab')
      expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true)
    }
    expect(generates).toBe(0)
    await dialog.getByRole('button', { name: copy.generate_btn, exact: true }).click()
    await expect(dialog.getByRole('alert')).toHaveText(copy.panel_generate_failed)
    await expect(dialog.getByRole('combobox', { name: copy.qb_market, exact: true })).toHaveValue('HK')
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    for (const button of await dialog.getByRole('button').all()) {
      const box = await button.boundingBox()
      expect(box!.height).toBeGreaterThanOrEqual(44)
      expect(box!.width).toBeGreaterThanOrEqual(44)
    }
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(opener).toBeFocused()
  })

  test('suggestion save serializes clicks, retains rejected edit and uses the acknowledged row ' + lang, async ({ page }, testInfo) => {
    const copy = await fixture(page, lang)
    const dialog = await generate(page, copy, lang)
    const text = dialog.getByRole('textbox', { name: label(copy, 'panel_question_label'), exact: true })
    const accept = dialog.getByRole('button', { name: label(copy, 'panel_accept_label'), exact: true })
    await text.fill('Edited first draft')
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const writes: Record<string, unknown>[] = []
    await page.route('**/api/dashboard/clients/client-1/prompts', async route => {
      const body = route.request().postDataJSON(); writes.push(body)
      if (writes.length === 1) { await pending; await route.fulfill({ status: 400, json: {} }) }
      else await route.fulfill({ status: 201, json: { prompt: saved(lang, body.question) } })
    })
    await accept.dblclick()
    await expect.poll(() => writes.length).toBe(1)
    await expect(accept).toBeDisabled()
    await expect(dialog.getByRole('button', { name: copy.panel_close, exact: true })).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    release()
    await expect(dialog.getByRole('alert')).toHaveText(copy.qb_save_failed)
    await expect(text).toHaveValue('Edited first draft')
    await expect(text).toBeFocused()
    await text.fill('Confirmed edited question')
    await accept.click()
    await expect(dialog.getByRole('textbox', { name: label(copy, 'panel_question_label', 2), exact: true })).toBeFocused()
    expect(writes).toEqual([
      question(lang, 'Edited first draft'),
      question(lang, 'Confirmed edited question'),
    ])
    await page.screenshot({ path: testInfo.outputPath('suggestion-review.png'), fullPage: true })
    await dialog.getByRole('button', { name: label(copy, 'panel_dismiss_label', 2), exact: true }).click()
    await expect(dialog.getByRole('button', { name: copy.panel_close, exact: true })).toBeFocused()
    await expect(dialog.getByText(copy.all_done, { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    const editName = copy.qb_edit_label.replace('{question}', 'Confirmed edited question')
    await expect(page.getByRole('button', { name: editName, exact: true })).toBeVisible()
    expect(writes.length).toBe(2)
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  })

  for (const failure of ['network', 'server'] as const) test('unknown ' + failure + ' outcome blocks repeated save but keeps the draft ' + lang, async ({ page }) => {
    const copy = await fixture(page, lang)
    const dialog = await generate(page, copy, lang)
    const text = dialog.getByRole('textbox', { name: label(copy, 'panel_question_label'), exact: true })
    await text.fill('Keep my uncertain draft')
    let writes = 0
    await page.route('**/api/dashboard/clients/client-1/prompts', route => {
      writes++
      return failure === 'network' ? route.abort('failed') : route.fulfill({ status: 500, json: {} })
    })
    const accept = dialog.getByRole('button', { name: label(copy, 'panel_accept_label'), exact: true })
    await accept.click()
    await expect(dialog.getByRole('alert')).toHaveText(copy.panel_save_unknown)
    await expect(text).toHaveValue('Keep my uncertain draft')
    await expect(accept).toBeDisabled()
    await expect(dialog.getByRole('button', { name: label(copy, 'panel_dismiss_label'), exact: true })).toBeDisabled()
    await expect(dialog.getByRole('button', { name: copy.panel_change_context, exact: true })).toBeDisabled()
    expect(writes).toBe(1)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: copy.suggest_more, exact: true })).toBeFocused()
    await expect(page.getByRole('alert')).toHaveText(copy.panel_save_unknown)
    await expect(page.getByRole('button', { name: copy.qb_edit_label.replace('{question}', 'Keep my uncertain draft'), exact: true })).toHaveCount(0)
  })

  test('empty suggestions are not reported as accepted work ' + lang, async ({ page }) => {
    const copy = await fixture(page, lang)
    await page.route('**/api/pulse/suggest-questions', route => route.fulfill({ json: { suggestions: [] } }))
    await page.getByRole('button', { name: copy.suggest_more, exact: true }).click()
    const dialog = page.getByRole('dialog', { name: copy.panel_title, exact: true })
    await dialog.getByRole('button', { name: copy.generate_btn, exact: true }).click()
    await expect(dialog.getByText(copy.panel_empty, { exact: true })).toBeVisible()
    await expect(dialog.getByText(copy.all_done, { exact: true })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: copy.generate_btn, exact: true })).toBeEnabled()
  })

  test('an unresolved save warning survives another success and reopening ' + lang, async ({ page }) => {
    const copy = await fixture(page, lang)
    const dialog = await generate(page, copy, lang)
    let writes = 0
    await page.route('**/api/dashboard/clients/client-1/prompts', route => {
      writes++
      return writes === 1 ? route.abort('failed') : route.fulfill({ status: 201, json: { prompt: saved(lang, route.request().postDataJSON().question) } })
    })
    await dialog.getByRole('button', { name: label(copy, 'panel_accept_label'), exact: true }).click()
    await expect(dialog.getByRole('alert')).toHaveText(copy.panel_save_unknown)
    await dialog.getByRole('button', { name: label(copy, 'panel_accept_label', 2), exact: true }).click()
    await expect(dialog.getByRole('textbox', { name: label(copy, 'panel_question_label', 2), exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('alert')).toHaveText(copy.panel_save_unknown)
    await page.getByRole('button', { name: copy.suggest_more, exact: true }).click()
    await expect(dialog.getByRole('alert')).toHaveText(copy.panel_save_unknown)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('alert')).toHaveText(copy.panel_save_unknown)
    expect(writes).toBe(2)
  })

  test('stalled generation ends with an inline retry and preserves context ' + lang, async ({ page }) => {
    const copy = await fixture(page, lang)
    await page.clock.install()
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    let calls = 0
    await page.route('**/api/pulse/suggest-questions', async route => {
      calls++; await pending
      await route.fulfill({ json: { suggestions: [question(lang)] } })
    })
    await page.getByRole('button', { name: copy.suggest_more, exact: true }).click()
    const dialog = page.getByRole('dialog', { name: copy.panel_title, exact: true })
    await dialog.getByRole('button', { name: copy.generate_btn, exact: true }).click()
    await expect.poll(() => calls).toBe(1)
    await page.clock.runFor(30_001)
    await expect(dialog.getByRole('alert')).toHaveText(copy.panel_generate_failed)
    await expect(dialog.getByRole('button', { name: copy.generate_btn, exact: true })).toBeEnabled()
    await expect(dialog.getByRole('combobox', { name: copy.qb_market, exact: true })).toHaveValue('HK')
    release()
    await expect(dialog.getByRole('textbox')).toHaveCount(0)
    expect(calls).toBe(1)
  })

  test('closing pending generation restores focus and ignores a late response ' + lang, async ({ page }) => {
    const copy = await fixture(page, lang)
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    let calls = 0
    await page.route('**/api/pulse/suggest-questions', async route => {
      calls++; await pending
      await route.fulfill({ json: { suggestions: [question(lang)] } })
    })
    const opener = page.getByRole('button', { name: copy.suggest_more, exact: true })
    await opener.click()
    const dialog = page.getByRole('dialog', { name: copy.panel_title, exact: true })
    await dialog.getByRole('button', { name: copy.generate_btn, exact: true }).click()
    await expect.poll(() => calls).toBe(1)
    await page.keyboard.press('Escape')
    await expect(opener).toBeFocused()
    release()
    await opener.click()
    await expect(dialog.getByRole('button', { name: copy.generate_btn, exact: true })).toBeVisible()
    await expect(dialog.getByRole('textbox')).toHaveCount(0)
    expect(calls).toBe(1)
  })

  test('a stalled save ends in an unknown state and allows closing ' + lang, async ({ page }) => {
    const copy = await fixture(page, lang)
    const dialog = await generate(page, copy, lang)
    await page.clock.install()
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    let writes = 0
    await page.route('**/api/dashboard/clients/client-1/prompts', async route => {
      writes++; await pending
      await route.fulfill({ status: 201, json: { prompt: saved(lang, 'Can Acme help?') } })
    })
    await dialog.getByRole('button', { name: label(copy, 'panel_accept_label'), exact: true }).click()
    await expect.poll(() => writes).toBe(1)
    await page.clock.runFor(15_001)
    await expect(dialog.getByRole('alert')).toHaveText(copy.panel_save_unknown)
    await expect(dialog.getByRole('button', { name: copy.panel_close, exact: true })).toBeEnabled()
    release()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    expect(writes).toBe(1)
  })
}

for(const lang of ['en','zh-HK']){
 test('modal locks background scroll and restores original body style '+lang,async({page})=>{
  const copy=await fixture(page,lang)
  await page.addStyleTag({content:'body{min-height:300vh}'})
  await page.evaluate(()=>{document.body.style.overflow='auto'})
  await page.getByRole('button',{name:copy.suggest_more,exact:true}).click()
  const dialog=page.getByRole('dialog',{name:copy.panel_title,exact:true})
  await expect(dialog).toBeVisible()
  const before=await page.evaluate(()=>scrollY), y=page.viewportSize()!.height-8
  await page.mouse.move(2,y);await page.mouse.wheel(0,500)
  await page.waitForTimeout(100)
  expect(await page.evaluate(()=>scrollY)).toBe(before)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  expect(await page.evaluate(()=>document.body.style.overflow)).toBe('auto')
  await page.mouse.move(2,y);await page.mouse.wheel(0,500)
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(before)
 })
}
