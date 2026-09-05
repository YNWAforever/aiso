import AxeBuilder from '@axe-core/playwright'
import { test, expect } from '@playwright/test'

const families = [
  ['/platform', '/platform/site-health'],
  ['/platform/search-intelligence', '/platform/demand-intelligence', '/platform/brand-product-discovery'],
  ['/platform/ai-visibility', '/platform/action-studio', '/platform/governed-agents', '/platform/proof'],
  ['/solutions', '/solutions/sme', '/solutions/agencies', '/solutions/enterprise', '/solutions/regulated-industries'],
  ['/how-it-works', '/resources', '/contact'],
  ['/security', '/trust', '/integrations'],
]
const routes = families.slice(0, Number(process.env.PUBLIC_FAMILY_STAGE ?? 5) + 1).flat()

for (const locale of ['en', 'zh-HK']) for (const colorScheme of ['light', 'dark'] as const) for (const width of [375, 768, 1024, 1440]) {
  test(`public page coverage ${locale} ${colorScheme} ${width}`, async ({ page }) => {
    test.setTimeout(180_000)
    await page.route('**/api/**', route => route.abort())
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    const titles = new Set<string>()
    for (const route of routes) {
      const response = await page.goto(`/${locale}${route}`)
      expect(response?.status(), route).toBe(200)
      const main = page.getByRole('main')
      await expect(main.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(main.getByRole('heading', { level: 2 })).toHaveCount(4)
      const title = await page.title()
      expect(titles.has(title), route).toBe(false)
      titles.add(title)
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`/${locale}${route}$`))
      await expect(main.locator(`a[href="/${locale}#scan"]`)).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), route).toBe(true)
      if (route.endsWith('/brand-product-discovery') || route.endsWith('/governed-agents')) {
        await expect(main.getByText(locale === 'en' ? 'Planned · not available' : '規劃中 · 尚未提供', { exact: true })).toBeVisible()
        await expect(main.locator(`a[href="/${locale}/auth/login"]`)).toHaveCount(0)
      }
      const banner = page.getByRole('banner')
      if (width < 1280) {
        const menu = banner.getByRole('button', { name: locale === 'en' ? 'Menu' : '選單' })
        await menu.click()
        await expect(banner.locator(`#mobile-navigation a[href="/${locale}${route}"]`)).toHaveAttribute('aria-current', 'page')
        await page.keyboard.press('Escape')
        await expect(menu).toBeFocused()
      } else {
        const group = banner.locator('details').filter({ has: page.locator(`a[href="/${locale}${route}"]`) })
        const summary = group.locator('summary')
        await summary.click()
        const selected = group.locator(`a[href="/${locale}${route}"]`)
        await expect(selected).toHaveAttribute('aria-current', 'page')
        await selected.focus()
        await page.keyboard.press('Escape')
        await expect(summary).toBeFocused()
        await expect(group).not.toHaveAttribute('open', '')
      }
      const accessibility = await new AxeBuilder({ page }).options({ rules: { 'target-size': { enabled: true } } }).analyze()
      expect(accessibility.violations, route).toEqual([])
      const links = await main.locator('a').evaluateAll(elements => elements.map(element => element.getAttribute('href')!))
      for (const link of links) expect([`/${locale}#scan`, `/${locale}/auth/login`, `/${locale}/pricing`, ...routes.map(path => `/${locale}${path}`)]).toContain(link)
    }
  })
}
