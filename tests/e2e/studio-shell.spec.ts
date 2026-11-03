import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync, mkdirSync } from 'node:fs'
import en from '../../messages/en.json'
import zh from '../../messages/zh-HK.json'

const clientId = '11111111-1111-4111-8111-111111111111'
// Bound Studio asks Search Console on submit only (AC-Q); that on-demand call is expected.
const unexpectedRequests = (requests: string[]) => requests.filter(url => !url.includes('/studio/search-console'))
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
  test(`follow-up drafts and feedback stay in their thread and clear across brands, accounts and exits in ${lang}`, async ({ page }) => {
    const { copy, requests } = await fixture(page, lang)
    const composer = page.locator('#studio-composer')
    const toast = page.locator('.as-toast')
    const openRecent = async (title: string) => {
      const toggle = page.getByRole('button', { name: copy.openNavigation, exact: true })
      if (await toggle.isVisible()) await toggle.click()
      await page.locator('.as-recent').getByRole('button').filter({ has: page.getByText(title, { exact: true }) }).click()
      await expect(composer).toBeFocused()
    }
    const switchBrand = async (name: string) => {
      const toggle = page.getByRole('button', { name: copy.openNavigation, exact: true })
      if (await toggle.isVisible()) await toggle.click()
      await page.getByRole('button', { name: copy.brandLabel, exact: true }).click()
      await page.getByRole('link', { name, exact: true }).click()
      await expect(composer).toHaveValue('')
      await expect(toast).toBeEmpty()
    }
    await composer.fill('First thread goal')
    await page.locator('button[type="submit"]').click()
    await composer.fill('First thread unsent')
    await page.getByRole('button', { name: copy.branchBrief, exact: true }).click()
    const briefTitle = copy.briefThreadTitle.replace('{title}', 'First thread goal')
    await expect(composer).not.toHaveValue('First thread unsent')
    await composer.fill('Second thread unsent')
    await openRecent('First thread goal')
    await expect(composer).toHaveValue('First thread unsent')
    await expect(toast).toBeEmpty()
    await openRecent(briefTitle)
    await expect(composer).toHaveValue('Second thread unsent')
    await expect(toast).toBeEmpty() // Do not revive the old brief-success message.
    await page.locator('button[type="submit"]').click()
    await expect(toast).toHaveText(copy.followUpSent)
    await openRecent('First thread goal')
    await expect(toast).toBeEmpty()
    await expect(composer).toHaveValue('First thread unsent')
    await page.getByRole('button', { name: copy.evidence.open, exact: true }).first().click()
    await page.keyboard.press('Escape')
    await openRecent(briefTitle)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await composer.fill('First brand private draft')
    await switchBrand('Second Brand')
    await composer.fill('Second brand goal')
    await page.locator('button[type="submit"]').click()
    await composer.fill('Second brand private draft')
    await switchBrand('Example Brand')
    await composer.fill('Account A goal')
    await page.locator('button[type="submit"]').click()
    await composer.fill('Account A private draft')
    // Synthetic session-account change uses the same account:brand key as the
    // guarded layout. This is UI memory evidence, not hosted authentication.
    for (const account of ['account-b', 'account-a']) {
      await page.evaluate(account => {
        history.pushState({}, '', `${location.pathname}?account=${account}`)
        window.dispatchEvent(new PopStateEvent('popstate'))
      }, account)
      await expect(composer).toHaveValue('')
      await expect(page.locator('.as-recent li')).toHaveCount(account === 'account-b' ? 0 : 3)
      await expect(toast).toBeEmpty()
      await composer.fill(`${account} goal`)
      await page.locator('button[type="submit"]').click()
      await composer.fill(`${account} unsent`)
    }
    await page.getByRole('log').getByRole('link', { name: copy.destinations.opportunities, exact: true }).click()
    await expect(page.getByTestId('dashboard-topbar')).toBeVisible()
    await page.getByTestId('dashboard-content').getByRole('link', { name: 'Studio', exact: true }).click()
    await expect(composer).toHaveValue('')
    await expect(page.locator('.as-recent li')).toHaveCount(4)
    await expect(toast).toBeEmpty()
    expect(unexpectedRequests(requests)).toEqual([])
  })

  test(`the dashboard back link uses the WorkspaceHome overview alias in ${lang}`, async ({ page }) => {
    const { copy } = await fixture(page, lang)
    const toggle = page.getByRole('button', { name: copy.openNavigation, exact: true })
    if (await toggle.isVisible()) await toggle.click()
    await expect(page.getByRole('link', { name: copy.backToDashboard, exact: true, includeHidden: true })).toHaveAttribute('href', `/${lang}/dashboard/${clientId}?step=overview`)
  })

  test(`result cards link to same-brand existing flows and restore dashboard chrome in ${lang}`, async ({ page }) => {
    const { copy, requests } = await fixture(page, lang)
    // Use the second brand as well, so a hardcoded first-brand link cannot pass.
    for (const brand of [clientId, '22222222-2222-4222-8222-222222222222']) {
      if (brand !== clientId) {
        const toggle = page.getByRole('button', { name: copy.openNavigation, exact: true })
        if (await toggle.isVisible()) await toggle.click()
        await page.getByRole('button', { name: copy.brandLabel, exact: true }).click()
        await page.getByRole('link', { name: 'Second Brand', exact: true }).click()
      }
      for (const destination of ['opportunities', 'reports', 'studio/tools'] as const) {
        await page.locator('#studio-composer').fill('Explain saved observations')
        await page.getByRole('button', { name: copy.send, exact: true }).click()
        const card = page.locator('.as-saved-reply > .as-result')
        const label = destination === 'studio/tools' ? copy.viewTools : copy.destinations[destination]
        const link = card.getByRole('link', { name: label, exact: true })
        await expect(link).toHaveAttribute('href', `/${lang}/dashboard/${brand}/${destination}`)
        await link.click()
        await expect(page).toHaveURL(`https://studio.fixture/${lang}/dashboard/${brand}/${destination}`)
        if (destination === 'studio/tools') {
          await expect(page.getByRole('heading', { name: copy.views.tools.title })).toBeVisible()
          await expect(page.locator('main a[href*="step=monitor"]')).toHaveCount(0)
          await page.locator('main a[href$="?step=scan"]').click()
        }
        await expect(page.getByTestId('dashboard-topbar')).toBeVisible()
        await expect(page.getByRole('complementary')).toBeVisible()
        await expect(page.locator('#aiso-studio')).toHaveCount(0)
        await page.getByTestId('dashboard-content').getByRole('link', { name: 'Studio', exact: true }).click()
        await expect(page.locator('#studio-home')).toBeVisible()
        const toggle = page.getByRole('button', { name: copy.openNavigation, exact: true })
        if (await toggle.isVisible()) await toggle.click()
        await expect(page.locator('.as-recent li').first()).toBeVisible()
      }
    }
    expect(unexpectedRequests(requests)).toEqual([])
  })

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
    await expect(page.getByRole('heading', { name: copy.views.threads.title })).toBeVisible()
    await expect(page.locator('main').getByText('Session goal', { exact: true }).first()).toBeVisible()
    expect(unexpectedRequests(requests)).toEqual([])
  })

  test(`redesign R1: skill chip, evidence trace, and thread search with skill tags in ${lang}`, async ({ page }) => {
    const { copy, requests } = await fixture(page, lang)
    await page.getByRole('button', { name: copy.templates.competitors.label }).click()
    const chip = copy.skillChip.label.replace('{skill}', copy.templates.competitors.label)
    await expect(page.locator('.as-composer').getByText(chip, { exact: true })).toBeVisible()
    await page.getByRole('button', { name: copy.send, exact: true }).click()
    // R2: the answer leads with its conclusion; a comparison is never claimed as verified.
    await expect(page.locator('.as-conclusion').first()).toContainText(copy.conclusion.title)
    await expect(page.locator('.as-conclusion').first()).toContainText(copy.conclusion.competitorsUnverified)
    const trace = page.locator('.as-trace').first()
    await expect(trace).toBeVisible()
    await expect(trace.locator('li').first()).toBeHidden() // collapsed until asked
    await trace.locator('summary').click()
    await expect(trace.locator('li').first()).toBeVisible()
    await expect(trace.locator('li').first()).toContainText(copy.savedDataLabel)
    const toggle = page.getByRole('button', { name: copy.openNavigation, exact: true })
    if (await toggle.isVisible()) await toggle.click()
    await page.locator('#studio-sidebar').getByRole('button', { name: copy.newThread, exact: true }).click()
    await page.locator('#studio-composer').fill('Bakery opening hours')
    await page.getByRole('button', { name: copy.send, exact: true }).click()
    await navigate(page, copy.threadsTitle, copy)
    const list = page.locator('main .as-record-list')
    await expect(list.locator('li')).toHaveCount(2)
    await expect(page.locator('main').getByText(copy.templates.competitors.label, { exact: true })).toHaveCount(1) // title only, no repeated tag
    const search = page.getByRole('searchbox', { name: copy.threadSearch.label })
    await search.fill('bakery')
    await expect(list.locator('li')).toHaveCount(1)
    await search.fill(copy.templates.competitors.label)
    await expect(list.locator('li')).toHaveCount(1)
    await search.fill('zzz-no-match')
    await expect(page.getByRole('status').filter({ hasText: 'zzz-no-match' })).toBeVisible()
    expect(unexpectedRequests(requests)).toEqual([])
  })

  test(`redesign R1b: overview cards and weekly report from saved data in ${lang}`, async ({ page }) => {
    const { copy, requests } = await fixture(page, lang)
    await navigate(page, copy.nav.overview, copy)
    for (const title of [copy.overview.visibility, copy.overview.scan, copy.overview.searchConsole, copy.overview.opportunities]) {
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
    }
    await expect(page.locator('main')).toContainText('37.5%')
    await expect(page.locator('main')).toContainText('72 · B')
    await expect(page.locator('main')).toContainText(copy.overview.unbound) // Search Console card, honestly
    await expect(page.locator('main')).toContainText(copy.overview.empty) // opportunities card
    // A card opens a fresh thread seeded with its skill.
    await page.getByRole('region', { name: copy.overview.visibility }).getByRole('button', { name: copy.overview.openThread }).click()
    await expect(page.locator('#studio-composer')).toHaveValue(copy.templates.pulse.prompt)
    await expect(page.locator('.as-composer').getByText(copy.skillChip.label.replace('{skill}', copy.templates.pulse.label), { exact: true })).toBeVisible()
    await navigate(page, copy.nav.weekly, copy)
    await expect(page.getByRole('heading', { name: copy.weekly.title, exact: true })).toBeVisible()
    await expect(page.locator('main tbody tr')).toHaveCount(3)
    await expect(page.getByRole('link', { name: copy.weekly.clientReports })).toHaveAttribute('href', `/${lang}/dashboard/${clientId}/reports`)
    expect(unexpectedRequests(requests)).toEqual([])
  })

  test(`brand switch, reload persistence, recent cap and command palette in ${lang}`, async ({ page }) => {
    const { copy, requests } = await fixture(page, lang)
    // One more than the sidebar shows, so the cap and the full-list link are both exercised.
    for (let i = 0; i < 9; i++) {
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
    await expect(page.locator('.as-recent li')).toHaveCount(8)
    // Saved rows show when they were updated; the section heading carries the privacy cue.
    await expect(page.locator('#studio-recent-title')).toHaveText(copy.recentThreadsTitle)
    await expect(page.locator('.as-recent').getByRole('link', { name: copy.allThreads, exact: true })).toBeVisible()
    await page.getByRole('button', { name: copy.brandLabel, exact: true }).click()
    await page.getByRole('link', { name: 'Second Brand', exact: true }).click()
    await expect(page.locator('.as-recent li')).toHaveCount(0)
    await expect(page.locator('#studio-composer')).toHaveValue('')
    await page.locator('#studio-composer').fill('Second brand temporary')
    await page.getByRole('button', { name: copy.send, exact: true }).click()
    await page.reload()
    await expect(page.locator('#studio-home')).toBeVisible()
    await expect(page.locator('.as-recent li')).toHaveCount(1)
    await expect(page.locator('.as-recent')).toContainText('Second brand temporary')
    await expect(page.locator('.as-recent').getByRole('link', { name: copy.allThreads, exact: true })).toHaveCount(0)
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
    expect(unexpectedRequests(requests)).toEqual([])
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

  for (const width of [1440, 900, 390]) for (const theme of ['light', 'dark'] as const) {
    test(`Studio R1b views ${lang} ${width} ${theme}: reflow and axe`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 })
      const { copy, requests } = await fixture(page, lang, '', theme === 'dark')
      for (const view of ['overview', 'weekly'] as const) {
        await navigate(page, copy.nav[view], copy)
        const result = await new AxeBuilder({ page }).analyze()
        expect(result.violations, view).toEqual([])
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), view).toBe(true)
        const targets = await page.locator('#aiso-studio').evaluate(root => [...root.querySelectorAll('a,button,input,textarea,summary')].filter(el => el.getBoundingClientRect().width && el.getBoundingClientRect().height).filter(el => { const box = el.getBoundingClientRect(); return box.width < 44 || box.height < 44 }).map(el => el.textContent))
        expect(targets, view).toEqual([])
      }
      expect(unexpectedRequests(requests)).toEqual([])
    })
  }
  for (const width of [1440, 900, 390]) for (const theme of ['light', 'dark']) {
    test(`Studio screens ${lang} ${width} ${theme}: reflow and axe`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 })
      const { copy, requests } = await fixture(page, lang, '', theme === 'dark')
      const breadcrumbCenters = await page.locator('.as-breadcrumb').evaluate(el => [...el.children].map(child => { const box = child.getBoundingClientRect(); return box.y + box.height / 2 }))
      expect(Math.max(...breadcrumbCenters) - Math.min(...breadcrumbCenters)).toBeLessThanOrEqual(1)
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
        // Post–Stage 6 vendor opacity: no evidence-vendor names on any Studio screen.
        if (view === 'connections') await expect(page.locator('#aiso-studio')).not.toContainText(/DataForSEO|Firecrawl/)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), view).toBe(true)
        const targets = await page.locator('#aiso-studio').evaluate(root => [...root.querySelectorAll('a,button,input,textarea,summary')].filter(el => el.getBoundingClientRect().width && el.getBoundingClientRect().height).filter(el => { const box = el.getBoundingClientRect(); return box.width < 44 || box.height < 44 }).map(el => el.textContent))
        expect(targets, view).toEqual([])
        const smallText = await page.locator('#aiso-studio').evaluate(root => [...root.querySelectorAll('*')].filter(el => el.getClientRects().length && [...el.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) && parseFloat(getComputedStyle(el).fontSize) < 12).map(el => el.textContent))
        expect(smallText, view).toEqual([])
        // Numeric, content-free evidence for the durable KD3 matrix. Keep raw
        // axe nodes, selectors, URLs and screenshots out of the committed receipt.
        await testInfo.attach('studio-a11y-cell', {
          contentType: 'application/json',
          body: Buffer.from(JSON.stringify({
            locale: lang, width, theme, view,
            axeViolations: result.violations.length,
            axeSerious: result.violations.filter(rule => rule.impact === 'serious').length,
            axeCritical: result.violations.filter(rule => rule.impact === 'critical').length,
            horizontalOverflowPx: await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth)),
            textBelow12px: smallText.length,
            controlsBelow44px: targets.length,
            unexpectedRequests: requests.length,
          })),
        })
        if (shots && testInfo.project.name === 'chromium') {
          // Composer focus can scroll the full-bleed shell. Compare the same
          // top-of-view framing as the concept, without a leftover hover state.
          await page.locator('#aiso-studio').evaluate(root => root.parentElement?.scrollTo(0, 0))
          await page.mouse.move(0, 0)
          await page.screenshot({ path: `${shots}/${lang}-${theme}-${width}-${view}.png`, fullPage: true })
          if (view === 'discussion') {
            await page.getByRole('button', { name: copy.branchBrief, exact: true }).click()
            await expect(page.locator('#studio-composer')).toBeFocused()
            await expect(page.locator('.as-toast')).toHaveText(copy.briefOpened)
            expect((await new AxeBuilder({ page }).analyze()).violations, 'brief').toEqual([])
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'brief').toBe(true)
            await page.locator('#aiso-studio').evaluate(root => root.parentElement?.scrollTo(0, 0))
            await page.mouse.move(0, 0)
            await page.screenshot({ path: `${shots}/${lang}-${theme}-${width}-brief.png`, fullPage: true })
            await page.locator('.as-composer').screenshot({ path: `${shots}/${lang}-${theme}-${width}-brief-draft.png` })
          }
        }
      }
      expect(unexpectedRequests(requests)).toEqual([])
    })
  }
}
