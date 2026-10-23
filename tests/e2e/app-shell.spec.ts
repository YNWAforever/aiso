import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import en from '../../messages/en.json'
import zh from '../../messages/zh-HK.json'

// Offline presentation acceptance for the Phase 4 app shell and task list,
// never an authenticated route bypass. Generate the HTML by running
// app-shell-fixture.test.tsx with AISO_SHELL_HTML_DIR set.
for (const lang of ['en', 'zh-HK'] as const) for (const width of [375, 1440]) for (const theme of ['light', 'dark'] as const) {
  test(`app shell ${lang} ${width} ${theme}`, async ({ page }) => {
    const dir = process.env.AISO_SHELL_HTML_DIR
    const cssPath = process.env.AISO_SHELL_CSS_PATH ?? process.env.C8A_CSS_PATH
    test.skip(!dir || !cssPath, 'Set AISO_SHELL_HTML_DIR using sanitized component artifacts')
    const css = readFileSync(cssPath!, 'utf8')
    const copy = (lang === 'en' ? en : zh).dashboard
    await page.route('**/*', route => route.abort())
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
    const load = async (state: string) => {
      await page.setContent(`<!doctype html><html lang="${lang}" class="${theme}"><head><meta charset="utf-8"><title>App shell acceptance</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>${readFileSync(`${dir}/${lang}-${state}.html`, 'utf8')}</body></html>`)
    }

    for (const state of ['tasks', 'tasks-empty', 'tasks-unavailable', 'portfolio']) {
      await load(state)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), state).toBe(true)
      expect((await new AxeBuilder({ page }).analyze()).violations, state).toEqual([])
    }

    await load('tasks')
    const sidebar = page.getByRole('navigation', { name: copy.workspace_navigation })
    if (width < 768) {
      // The mobile sidebar is collapsed behind its toggle.
      await expect(page.getByRole('button', { name: copy.toggle_navigation })).toHaveAttribute('aria-expanded', 'false')
    } else {
      for (const label of [copy.nav_overview, copy.nav_scan_fix, copy.nav_reports, copy.nav_settings]) await expect(sidebar.getByText(label, { exact: true })).toBeVisible()
      await expect(sidebar.getByText(copy.nav_monitor, { exact: true })).toHaveCount(0)
      await expect(sidebar.locator('a[aria-current="page"]')).toHaveText(copy.nav_tasks)
      const crumbs = page.getByRole('navigation', { name: (lang === 'en' ? en : zh).ui.breadcrumbs })
      await expect(crumbs.locator('[aria-current="page"]')).toHaveText(copy.nav_tasks)
    }
    const list = page.getByTestId('task-list')
    await expect(list.getByRole('link')).toHaveCount(5)
    for (const status of ['draft', 'in_review', 'changes_requested', 'approved', 'delivered'] as const) await expect(list).toContainText(copy.tasks.status[status])
    await expect(page.getByRole('group', { name: copy.tasks.filters }).getByRole('button', { pressed: true })).toHaveCount(1)
    if (width === 1440 && theme === 'light') await page.screenshot({ path: `${dir}/${lang}-tasks-desktop.png`, fullPage: true })
    if (width === 375 && theme === 'light') await page.screenshot({ path: `${dir}/${lang}-tasks-mobile.png`, fullPage: true })
  })
}
