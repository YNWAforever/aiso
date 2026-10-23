import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
import { E2E_ASSESSED_SCAN_ID } from '@/lib/e2e-fixtures'
import { A11Y_LOCALES } from './matrix'

const catalogs = { en, 'zh-HK': zhHK }

/**
 * WCAG 2.2 AA beyond what axe runs by default, on the public pages:
 *  - 2.5.8 target size: axe ships `target-size` disabled, so the rest of the
 *    matrix never checked it. Every control is at least 24×24 px or spaced.
 *  - 1.4.10 reflow: no horizontal scrolling at 320 CSS px, and at 200% zoom of
 *    a 1280 px window (640 CSS px).
 *  - 2.1.2 / 2.4.3 keyboard: menus and dialogs take focus, keep it inside
 *    while open, and give it back to the control that opened them.
 */
const ROUTES = [
  (lang: string) => `/${lang}`,
  (lang: string) => `/${lang}/pricing`,
  (lang: string) => `/${lang}/scan`,
  (lang: string) => `/${lang}/auth/login`,
  (lang: string) => `/${lang}/sample-report`,
  (lang: string) => `/${lang}/methodology`,
  (lang: string) => `/${lang}/result/${E2E_ASSESSED_SCAN_ID}`,
]

async function settle(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running'))
}

// Each test sets its own viewports, so one of the four a11y width projects is enough.
test.beforeEach(({}, info) => { test.skip(info.project.name !== 'a11y-375', 'runs once, in a11y-375') })

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

for (const locale of A11Y_LOCALES) {
  for (const route of ROUTES) {
    const path = route(locale)
    test(`wcag22 ${path}: target size, reflow at 320 px and 200% zoom`, async ({ page }) => {
      await page.route('**/api/**', r => r.abort('blockedbyclient'))
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.setViewportSize({ width: 375, height: 812 })
      await page.goto(path, { waitUntil: 'networkidle' })
      await settle(page)
      const targets = await new AxeBuilder({ page })
        .options({ runOnly: { type: 'rule', values: ['target-size'] }, rules: { 'target-size': { enabled: true } } })
        .analyze()
      expect(targets.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([])

      for (const viewport of [{ width: 320, height: 640 }, { width: 640, height: 450 }]) {
        await page.setViewportSize(viewport)
        await settle(page)
        expect(await overflow(page), `${viewport.width}px`).toBeLessThanOrEqual(0)
      }
    })
  }

  test(`wcag22 ${locale}: the mobile menu opens from the keyboard and Escape returns focus`, async ({ page }) => {
    const copy = catalogs[locale].nav
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto(`/${locale}`, { waitUntil: 'networkidle' })
    const toggle = page.getByRole('button', { name: copy.menu })
    await toggle.focus()
    await page.keyboard.press('Enter')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => document.activeElement?.closest('#mobile-navigation') !== null || document.activeElement?.getAttribute('aria-controls') === 'mobile-navigation')).toBe(true)
    await page.keyboard.press('Escape')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(toggle).toBeFocused()
  })

  test(`wcag22 ${locale}: dialog and command palette trap focus and return it`, async ({ page }) => {
    const copy = catalogs[locale].designSystem
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(`/${locale}/dev/design-system`, { waitUntil: 'networkidle' })

    const dialogTrigger = page.getByRole('button', { name: copy.sample.showDialog })
    await dialogTrigger.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Tab')
      expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(dialogTrigger).toBeFocused()

    const paletteTrigger = page.getByRole('button', { name: copy.sample.showPalette })
    await paletteTrigger.focus()
    await page.keyboard.press('Enter')
    const palette = page.getByRole('dialog')
    await expect(palette).toBeVisible()
    await expect(palette.getByRole('combobox')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(palette).toBeHidden()
    await expect(paletteTrigger).toBeFocused()
  })
}
