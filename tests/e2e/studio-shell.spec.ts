import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync, mkdirSync } from 'node:fs'
import en from '../../messages/en.json'
import zh from '../../messages/zh-HK.json'

const clientId = '11111111-1111-4111-8111-111111111111'
async function fixture(page: Page, lang: string, view = '', dark = false) {
  const directory = process.env.STUDIO_HTML_DIR ?? '.next/component-fixtures/STUDIO'
  const js = readFileSync(`${directory}/shell-fixture.js`, 'utf8')
  const css = readFileSync(`${directory}/build.css`, 'utf8')
  const requests: string[] = []
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/*', route => { requests.push(route.request().url()); return route.abort() })
  await page.route('https://studio.fixture/**', route => {
    if (!route.request().isNavigationRequest()) { requests.push(route.request().url()); return route.abort() }
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="${lang}" class="${dark ? 'dark' : ''}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Studio shell fixture</title><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>` })
  })
  await page.goto(`https://studio.fixture/${lang}/dashboard/${clientId}/studio${view}`)
  await expect(page.locator('#aiso-studio.as-shell')).toBeVisible()
  return { copy: (lang === 'en' ? en : zh).conversationStudio, requests }
}
async function navigate(page: Page, label: string, copy: typeof en.conversationStudio) {
  const toggle = page.getByRole('button', { name: copy.openNavigation, exact: true })
  if (await toggle.isVisible()) await toggle.click()
  const link = page.getByRole('navigation', { name: copy.mainNavigationLabel, includeHidden: true }).getByRole('link', { name: label, exact: true, includeHidden: true })
  await link.click()
  await expect(link).toHaveAttribute('aria-current', 'page')
}

for (const lang of ['en', 'zh-HK']) {
  test(`Layout B navigation, temporary discussions, READ pages and dashboard escape in ${lang}`, async ({ page }) => {
    const { copy, requests } = await fixture(page, lang)
    await expect(page.getByTestId('dashboard-topbar')).toHaveCount(0)
    await page.locator('#studio-composer').fill('Session goal')
    await page.getByRole('button', { name: copy.send, exact: true }).click()
    await page.locator('#studio-composer').fill('Isolated follow-up draft')
    await navigate(page, copy.threadsTitle, copy)
    await expect(page.getByRole('heading', { name: copy.views.threads.title })).toBeVisible()
    await page.locator('main').getByRole('button', { name: /Session goal/ }).click()
    await expect(page.locator('#studio-composer')).toHaveValue('Isolated follow-up draft')
    const evidence = page.getByRole('button', { name: copy.evidence.open, exact: true }).first()
    await evidence.click()
    await expect(page.getByRole('dialog', { name: copy.evidence.panelTitle })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(evidence).toBeFocused()
    await navigate(page, copy.nav.documents, copy)
    await expect(page.getByText('Approved brand facts', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: /Existing work output/ })).toHaveAttribute('href', new RegExp('/work-items/fixture-output/versions$'))
    await expect(page.locator('main form, main button')).toHaveCount(0)
    await navigate(page, copy.nav.connections, copy)
    await expect(page.getByText(copy.connections.hkEndpointPending, { exact: true })).toBeVisible()
    await expect(page.getByText(copy.connections.disconnected, { exact: true })).toHaveCount(2)
    await expect(page.getByRole('link', { name: copy.connections.viewScope })).toHaveAttribute('href', `/${lang}/dashboard/${clientId}/assets`)
    await expect(page.locator('main form, main button')).toHaveCount(0)
    await navigate(page, copy.nav.tools, copy)
    await expect(page.locator('main a[href*="/admin"], main a[href*="step=monitor"]')).toHaveCount(0)
    const scan = page.locator('main a[href$="?step=scan"]')
    await scan.click()
    await expect(page.getByTestId('dashboard-topbar')).toBeVisible()
    await expect(page.locator('#aiso-studio')).toHaveCount(0)
    await page.getByTestId('dashboard-content').getByRole('link', { name: 'Studio', exact: true }).click()
    await navigate(page, copy.threadsTitle, copy)
    await expect(page.getByRole('heading', { name: copy.recentThreadsEmpty, exact: true })).toBeVisible()
    await expect(page.getByText('Session goal', { exact: true })).toHaveCount(0)
    expect(requests).toEqual([])
  })

  test(`brand switch, refresh reset, recent cap and command palette in ${lang}`, async ({ page }) => {
    const { copy, requests } = await fixture(page, lang)
    for (let i = 0; i < 5; i++) {
      if (i) {
        const toggle = page.getByRole('button', { name: copy.openNavigation, exact: true })
        if (await toggle.isVisible()) await toggle.click()
        await page.locator('#studio-sidebar').getByRole('button', { name: copy.newThread, exact: true }).click()
      }
      await page.locator('#studio-composer').fill(`Temporary goal ${i}`)
      await page.getByRole('button', { name: copy.send, exact: true }).click()
    }
    const toggle = page.getByRole('button', { name: copy.openNavigation, exact: true })
    if (await toggle.isVisible()) await toggle.click()
    await expect(page.locator('.as-recent li')).toHaveCount(4)
    await expect(page.locator('.as-recent')).toContainText(copy.temporaryLabel)
    await page.getByRole('button', { name: copy.brandLabel, exact: true }).click()
    await page.getByRole('link', { name: 'Second Brand', exact: true }).click()
    await expect(page.locator('.as-recent li')).toHaveCount(0)
    await expect(page.locator('#studio-composer')).toHaveValue('')
    await page.locator('#studio-composer').fill('Second brand temporary')
    await page.getByRole('button', { name: copy.send, exact: true }).click()
    await page.reload()
    await expect(page.locator('#studio-home')).toBeVisible()
    await expect(page.locator('.as-recent li')).toHaveCount(0)
    await page.locator('#studio-composer').focus()
    await page.keyboard.press('Control+k')
    await expect(page.getByRole('combobox')).toBeVisible()
    await page.getByRole('combobox').fill(copy.nav.documents)
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: copy.views.documents.title })).toBeVisible()
    await page.keyboard.press('Control+k')
    await page.getByRole('combobox').fill(copy.title)
    await page.keyboard.press('Enter')
    await expect(page.locator('#studio-home')).toBeVisible()
    await page.locator('#studio-composer').fill('Unsent goal')
    await page.keyboard.press('Control+k')
    await page.getByRole('combobox').fill(copy.newThread)
    await page.keyboard.press('Enter')
    await expect(page.locator('#studio-composer')).toHaveValue('')
    expect(requests).toEqual([])
  })

  test(`mobile menu breakpoint, keyboard and 44px targets in ${lang}`, async ({ page }) => {
    await page.setViewportSize({ width: 620, height: 900 })
    const { copy } = await fixture(page, lang)
    const toggle = page.getByRole('button', { name: copy.openNavigation, exact: true })
    await expect(page.locator('#studio-sidebar')).toBeHidden()
    const box = await toggle.boundingBox()
    expect(box!.width).toBeGreaterThanOrEqual(44)
    expect(box!.height).toBeGreaterThanOrEqual(44)
    await toggle.click()
    await expect(page.locator('#studio-sidebar')).toBeVisible()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Escape')
    await expect(toggle).toBeFocused()
    await expect(page.locator('#studio-sidebar')).toBeHidden()
    await page.setViewportSize({ width: 621, height: 900 })
    await expect(page.locator('#studio-sidebar')).toBeVisible()
    await expect(toggle).toBeHidden()
  })

  for (const width of [1440, 900, 390]) for (const theme of ['light', 'dark']) {
    test(`Studio screens ${lang} ${width} ${theme}: reflow and axe`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 })
      const { copy, requests } = await fixture(page, lang, '', theme === 'dark')
      const shots = process.env.STUDIO_STAGE5_SHOTS_DIR
      if (shots) mkdirSync(shots, { recursive: true })
      for (const view of ['home', 'discussion', 'threads', 'documents', 'connections', 'tools']) {
        if (view === 'discussion') {
          await page.locator('#studio-composer').fill('Explain saved observations')
          await page.getByRole('button', { name: copy.send, exact: true }).click()
        } else if (view !== 'home') {
          await navigate(page, view === 'threads' ? copy.threadsTitle : copy.nav[view as 'documents' | 'connections' | 'tools'], copy)
        }
        const result = await new AxeBuilder({ page }).analyze()
        expect(result.violations, view).toEqual([])
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), view).toBe(true)
        const targets = await page.locator('#aiso-studio').evaluate(root => [...root.querySelectorAll('a,button,input,textarea,summary')].filter(el => el.getBoundingClientRect().width && el.getBoundingClientRect().height).filter(el => { const box = el.getBoundingClientRect(); return box.width < 44 || box.height < 44 }).map(el => el.textContent))
        expect(targets, view).toEqual([])
        const smallText = await page.locator('#aiso-studio').evaluate(root => [...root.querySelectorAll('*')].filter(el => el.getClientRects().length && [...el.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) && parseFloat(getComputedStyle(el).fontSize) < 12).map(el => el.textContent))
        expect(smallText, view).toEqual([])
        if (shots && testInfo.project.name === 'chromium') await page.screenshot({ path: `${shots}/${lang}-${theme}-${width}-${view}.png`, fullPage: true })
      }
      expect(requests).toEqual([])
    })
  }
}
