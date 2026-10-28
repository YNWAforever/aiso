import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import en from '../../messages/en.json'
import zh from '../../messages/zh-HK.json'

async function fixture(page: Page, lang: string, empty = false, scan = false) {
  const directory = process.env.STUDIO_HTML_DIR ?? '.next/component-fixtures/STUDIO'
  const js = readFileSync(`${directory}/fixture.js`, 'utf8')
  const css = readFileSync(`${directory}/build.css`, 'utf8')
  const requests: string[] = []
  // Block and record ALL attempted outbound requests, including provider URLs,
  // unexpected same-origin calls and browser-triggered source prefetches.
  await page.route('**/*', route => { requests.push(route.request().url()); return route.abort() })
  const url = `https://studio.fixture/${lang}${empty ? '?empty=1' : scan ? '?scan=1' : ''}`
  await page.route(url, route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Studio fixture</title><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`,
  }))
  await page.goto(url)
  return { copy: (lang === 'en' ? en : zh).conversationStudio, requests }
}

for (const lang of ['en', 'zh-HK']) {
  test(`saved evidence, citations and temporary threads without outbound HTTP in ${lang}`, async ({ page }) => {
    const { copy, requests } = await fixture(page, lang)
    const composer = page.getByRole('textbox', { name: copy.composerLabel })
    const send = page.getByRole('button', { name: copy.send, exact: true })
    const log = page.getByRole('log')
    await expect(send).toBeDisabled()
    await composer.fill('   ')
    await expect(send).toBeDisabled()
    await page.getByRole('button', { name: copy.templates.brief.label, exact: true }).click()
    await expect(composer).toHaveValue(copy.templates.brief.prompt)
    await expect(composer).toBeFocused()
    await send.click()
    await expect(log).toContainText(copy.evidence.savedSummary)
    await expect(log).toContainText('Example Brand offers sourdough.')
    await expect(log).toContainText(copy.evidence.historicalQuote)
    await log.getByText(copy.evidence.panelTitle, { exact: true }).click()
    await log.getByText(copy.evidence.sourcesTitle, { exact: true }).click()
    await expect(log.getByRole('link', { name: 'Bread', exact: true })).toHaveAttribute('href', 'https://example.com/bread')
    await expect(log).toContainText('30000000-0000-4000-8000-000000000001')
    await expect(log).toContainText('2026-10-27T03:00:00Z')
    await expect(log).toContainText(copy.evidence.searchUnknown)
    await expect(log).toContainText(copy.evidence.status.missing)
    await expect(log).toContainText(copy.evidence.status.unsupported)
    await expect(composer).toHaveValue('')
    await composer.fill('Keep this draft')
    await page.getByRole('button', { name: copy.newThread, exact: true }).click()
    await expect(log).not.toContainText(copy.evidence.savedSummary)
    await composer.fill('unrelated helicopters')
    await send.click()
    await expect(log).toContainText(copy.evidence.insufficient)
    await expect(log).not.toContainText('offers sourdough')
    await page.getByRole('button', { name: copy.templates.brief.prompt, exact: true }).click()
    await expect(composer).toHaveValue('Keep this draft')
    await expect(log).not.toContainText('unrelated helicopters')
    // Editing a template drops its structured intent; no confident generic reply.
    await page.getByRole('button', { name: copy.templates.pulse.label, exact: true }).click()
    await composer.fill('Is sourdough gluten free today?')
    await send.click()
    await expect(log).toContainText(copy.evidence.questionLimit)
    expect(requests).toEqual([])
    await page.reload()
    await expect(page.getByText(copy.threadsEmpty, { exact: true })).toBeVisible()
    await expect(log).not.toContainText(copy.evidence.savedSummary)
    expect(requests).toEqual([])
  })

  test(`all saved-data templates and insufficient competitor comparison in ${lang}`, async ({ page }) => {
    const { copy, requests } = await fixture(page, lang)
    for (const key of ['pulse', 'report', 'competitors'] as const) {
      await page.getByRole('button', { name: copy.newThread, exact: true }).click()
      await page.getByRole('button', { name: copy.templates[key].label, exact: true }).click()
      await page.getByRole('button', { name: copy.send, exact: true }).click()
      await expect(page.getByRole('log')).toContainText(key === 'competitors' ? copy.evidence.comparisonLimit : copy.evidence.savedSummary)
      await expect(page.getByRole('log')).toContainText('Example Brand offers sourdough.')
    }
    expect(requests).toEqual([])
  })

  test(`empty evidence stays insufficient and has no invented sources in ${lang}`, async ({ page }) => {
    const { copy, requests } = await fixture(page, lang, true)
    await page.getByRole('button', { name: copy.templates.brief.label, exact: true }).click()
    await page.getByRole('button', { name: copy.send, exact: true }).click()
    const log = page.getByRole('log')
    await expect(log).toContainText(copy.evidence.insufficient)
    await expect(log).toContainText(copy.evidence.noSources)
    await expect(log.getByRole('link')).toHaveCount(0)
    expect(requests).toEqual([])
  })

  test(`IME, accessibility and reflow in ${lang}`, async ({ page }) => {
    const { copy, requests } = await fixture(page, lang, false, true)
    const composer = page.getByRole('textbox', { name: copy.composerLabel })
    await composer.fill('廣東話測試')
    await composer.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229 })
    await expect(page.getByRole('log').getByRole('heading', { name: copy.evidence.insufficient, exact: true })).toHaveCount(0)
    await expect(composer).toHaveValue('廣東話測試')
    await page.getByRole('button', { name: copy.send, exact: true }).click()
    await expect(page.getByRole('log')).toContainText(copy.evidence.insufficient)
    await page.getByRole('button', { name: copy.templates.brief.label, exact: true }).click()
    await page.getByRole('button', { name: copy.send, exact: true }).click()
    await page.getByRole('button', { name: copy.templates.brief.label, exact: true }).click()
    await page.getByRole('button', { name: copy.send, exact: true }).click()
    await page.getByRole('log').getByText(copy.evidence.panelTitle).last().click()
    await page.getByRole('log').getByText(copy.evidence.sourcesTitle).last().click()
    await composer.fill('x'.repeat(300))
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    expect(requests).toEqual([])
    await page.screenshot({ path: `artifacts/studio/${lang}-${test.info().project.name}.png`, fullPage: true })
  })
}
