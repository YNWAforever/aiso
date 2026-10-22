import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
import { E2E_ASSESSED_SCAN_ID, E2E_FIXTURE_SCAN_ID } from '@/lib/e2e-fixtures'
import { A11Y_LOCALES, A11Y_THEMES } from './matrix'

const catalogs = { en, 'zh-HK': zhHK }

async function settle(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running'))
}

/**
 * UX Phase 3 result page, on the fixture whose checks carry complete
 * evidence: zero violations with every axe rule, no overflow, the drawer,
 * the filters, Save, the print view, and the live checklist during a scan.
 */
for (const locale of A11Y_LOCALES) {
  const copy = catalogs[locale].resultPage

  for (const theme of A11Y_THEMES) {
    test(`result ${locale} ${theme}: zero axe violations and no overflow`, async ({ page }) => {
      await page.route('**/api/**', route => route.abort('blockedbyclient'))
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
      await page.goto(`/${locale}/result/${E2E_ASSESSED_SCAN_ID}`, { waitUntil: 'networkidle' })
      await expect(page.getByRole('heading', { level: 2, name: copy.fixes_title })).toBeVisible()
      await settle(page)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
      const results = await new AxeBuilder({ page }).analyze()
      expect(results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([])
    })
  }

  test(`result ${locale}: a top fix opens its drawer, which passes axe and returns focus`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(`/${locale}/result/${E2E_ASSESSED_SCAN_ID}`, { waitUntil: 'networkidle' })
    const fix = page.getByTestId('result-top-issue').getByRole('button').first()
    await fix.click()
    const drawer = page.getByRole('dialog')
    await expect(drawer).toBeVisible()
    await expect(drawer.getByText(copy.drawer.how)).toBeVisible()
    await expect(drawer.getByRole('button', { name: copy.drawer.copy })).toBeVisible()
    await expect(drawer.getByTestId('drawer-fix-pack')).toHaveText(copy.drawer.generate_signup)
    await settle(page)
    const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze()
    expect(results.violations.map(v => v.id)).toEqual([])
    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden()
    await expect(fix).toBeFocused()
  })

  test(`result ${locale}: heatmap tiles and filters reach every check`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(`/${locale}/result/${E2E_ASSESSED_SCAN_ID}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('check-heatmap').getByRole('button')).toHaveCount(20)
    await page.getByTestId('check-heatmap').getByRole('button').first().click()
    await expect(page.getByRole('dialog')).toHaveAttribute('data-check', 'c1_robots')
    await page.keyboard.press('Escape')

    const failing = page.getByRole('group', { name: copy.filters_label }).getByRole('button', { name: copy.filter.fail.replace('{count}', '5') })
    await failing.click()
    await expect(failing).toHaveAttribute('aria-pressed', 'true')
    const list = page.getByRole('heading', { name: copy.list_title }).locator('xpath=..').getByRole('listitem')
    await expect(list).toHaveCount(5)
  })

  test(`result ${locale}: Save moves to the free-account card, and the print view drops the controls`, async ({ page }) => {
    await page.goto(`/${locale}/result/${E2E_ASSESSED_SCAN_ID}`, { waitUntil: 'networkidle' })
    await page.getByTestId('save-result').click()
    await expect(page.locator('#account-unlock-email')).toBeFocused()
    await page.getByTestId('result-top-issue').getByRole('button').first().click()
    await page.getByRole('dialog').getByTestId('drawer-fix-pack').click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.locator('#account-unlock-email')).toBeFocused()
    await page.emulateMedia({ media: 'print' })
    await expect(page.getByTestId('save-result')).toBeHidden()
    await expect(page.getByTestId('save-report-cta')).toBeHidden()
    await expect(page.getByTestId('score-reveal')).toBeVisible()
  })

  test(`result ${locale}: a check without evidence reads as not checked, never as a fix`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(`/${locale}/result/${E2E_FIXTURE_SCAN_ID}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('result-top-issue').locator('[data-priority-state="insufficient-evidence"]')).toBeVisible()
    await expect(page.getByTestId('potential-score-bar')).toHaveCount(0)
    await expect(page.getByTestId('check-heatmap').getByRole('button', { name: new RegExp(catalogs[locale].visuals.status.unknown) })).toHaveCount(20)
  })

  test(`scan ${locale}: the live checklist shows checks running, never a verdict, until the result`, async ({ page }) => {
    let release: () => void = () => {}
    const answered = new Promise<void>(resolve => { release = resolve })
    await page.route('**/api/scan', async route => {
      await answered
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: E2E_ASSESSED_SCAN_ID, score: 61.5, grade: 'C' }) })
    })
    await page.goto(`/${locale}`, { waitUntil: 'networkidle' })
    await page.getByLabel(catalogs[locale].home.website_url).first().fill('https://example.com')
    await page.getByRole('button', { name: catalogs[locale].home.cta }).first().click()
    const timeline = page.getByTestId('scan-timeline')
    await expect(timeline).toBeVisible()
    await expect(timeline.getByText(catalogs[locale].visuals.status.running).first()).toBeAttached()
    for (const verdict of ['pass', 'warn', 'fail'] as const) {
      await expect(timeline.getByText(catalogs[locale].visuals.status[verdict], { exact: false })).toHaveCount(0)
    }
    release()
    await page.waitForURL(`**/result/${E2E_ASSESSED_SCAN_ID}`, { waitUntil: 'commit', timeout: 15_000 })
  })
}
