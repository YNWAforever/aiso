import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import en from '../../messages/en.json'
import zh from '../../messages/zh-HK.json'

async function fixture(page: Page, lang: string) {
  const directory = process.env.STUDIO_HTML_DIR ?? '.next/component-fixtures/STUDIO'
  const js = readFileSync(`${directory}/fixture.js`, 'utf8')
  const css = readFileSync(`${directory}/build.css`, 'utf8')
  const requests: string[] = []
  await page.route('**/*', route => { requests.push(route.request().url()); return route.abort() })
  await page.route(`https://studio.fixture/${lang}`, route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Studio fixture</title><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`,
  }))
  await page.goto(`https://studio.fixture/${lang}`)
  return { copy: (lang === 'en' ? en : zh).conversationStudio, requests }
}

for (const lang of ['en', 'zh-HK']) {
  test(`templates and submit create only temporary demo threads in ${lang}`, async ({ page }) => {
    const { copy, requests } = await fixture(page, lang)
    const composer = page.getByRole('textbox', { name: copy.composerLabel })
    const send = page.getByRole('button', { name: copy.send, exact: true })
    await expect(send).toBeDisabled()
    await composer.fill('   ')
    await expect(send).toBeDisabled()
    await page.getByRole('button', { name: copy.templates.visibility.label, exact: true }).click()
    await expect(composer).toHaveValue(copy.templates.visibility.prompt)
    await expect(composer).toBeFocused()
    await send.click()
    await expect(page.getByRole('log')).toContainText(copy.stubReply)
    await expect(page.getByRole('log')).toContainText(copy.templates.visibility.prompt)
    await expect(composer).toHaveValue('')
    await page.getByRole('button', { name: copy.newThread, exact: true }).click()
    await expect(page.getByRole('log')).not.toContainText(copy.stubReply)
    await composer.fill('Second synthetic prompt')
    await send.click()
    await page.getByRole('button', { name: copy.templates.visibility.prompt, exact: true }).click()
    await expect(page.getByRole('log')).toContainText(copy.templates.visibility.prompt)
    await expect(page.getByRole('log')).not.toContainText('Second synthetic prompt')
    expect(requests).toEqual([])
    await page.reload()
    await expect(page.getByText(copy.threadsEmpty, { exact: true })).toBeVisible()
    await expect(page.getByRole('log')).not.toContainText(copy.stubReply)
    expect(requests).toEqual([])
  })

  test(`IME, accessibility and reflow in ${lang}`, async ({ page }) => {
    const { copy, requests } = await fixture(page, lang)
    const composer = page.getByRole('textbox', { name: copy.composerLabel })
    await composer.fill('廣東話測試')
    await composer.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229 })
    await expect(page.getByRole('log')).not.toContainText(copy.stubReply)
    await expect(composer).toHaveValue('廣東話測試')
    await page.getByRole('button', { name: copy.send, exact: true }).click()
    await expect(page.getByRole('log')).toContainText(copy.stubReply)
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
