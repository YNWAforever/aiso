import { test, expect } from '@playwright/test'

for (const locale of ['en', 'zh-HK']) for (const colorScheme of ['light', 'dark'] as const) for (const width of [375, 768, 1024, 1440]) {
  test(`public platform navigation ${locale} ${colorScheme} ${width}`, async ({ page }) => {
    await page.route('**/api/**', route => route.abort())
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ colorScheme })
    const response = await page.goto(`/${locale}/platform/site-health`)
    expect(response?.status()).toBe(200)
    // Hydration must not be required to supply the initial document language.
    expect(await response!.text()).toMatch(new RegExp(`<html[^>]*\\blang="${locale}"`))
    await expect(page.locator('html')).toHaveAttribute('lang', locale)
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveCount(1)
    const banner = page.getByRole('banner')
    const currentLink = banner.locator(`a[href="/${locale}/platform/site-health"]:not([hreflang]):visible`)
    if (width < 1280) {
      const menu = banner.getByRole('button', { name: locale === 'en' ? 'Menu' : '選單' })
      await expect(menu).toHaveAttribute('aria-expanded', 'false')
      await menu.focus()
      await page.keyboard.press('Enter')
      await expect(menu).toBeFocused()
      await expect(menu).toHaveAttribute('aria-expanded', 'true')
      await page.keyboard.press('Tab')
      await expect(banner.locator('#mobile-navigation a').first()).toBeFocused()
      await expect(currentLink).toHaveAttribute('aria-current', 'page')
      await page.keyboard.press('Escape')
      await expect(menu).toBeFocused()
      await expect(menu).toHaveAttribute('aria-expanded', 'false')
      await menu.click()
      await banner.locator(`#mobile-navigation a[href="/${locale}/platform"]`).click()
      await expect(page).toHaveURL(new RegExp(`/${locale}/platform$`))
      await expect(menu).toHaveAttribute('aria-expanded', 'false')
      // Enlarged root text must keep the trigger and language links reachable.
      await page.evaluate(() => { document.documentElement.style.fontSize = '32px' })
      await expect(menu).toBeInViewport()
    } else {
      const details = banner.locator('details').filter({ has: page.locator(`a[href="/${locale}/platform/site-health"]`) })
      const summary = details.locator('summary')
      await summary.click()
      await expect(currentLink).toHaveAttribute('aria-current', 'page')
      await currentLink.focus()
      await page.keyboard.press('Escape')
      await expect(summary).toBeFocused()
      await expect(details).not.toHaveAttribute('open', '')
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const target = locale === 'en' ? 'zh-HK' : 'en'
    const suffix = width < 1280 ? '/platform' : '/platform/site-health'
    const localeLink = banner.locator(`a[hreflang="${target}"]`)
    await expect(localeLink).toHaveAttribute('href', `/${target}${suffix}`)
    // A full page load would hide a stale cached root-layout language.
    const documentMarker = await page.evaluate(() => {
      const marker = crypto.randomUUID()
      ;(window as Window & { localeNavigationMarker?: string }).localeNavigationMarker = marker
      return marker
    })
    await localeLink.click()
    await expect(page).toHaveURL(new RegExp(`/${target}${suffix}$`))
    await expect(page.locator('html')).toHaveAttribute('lang', target)
    expect(await page.evaluate(() => (window as Window & { localeNavigationMarker?: string }).localeNavigationMarker)).toBe(documentMarker)

    // Returning also exercises the previously visited locale's cached layout.
    await banner.locator(`a[hreflang="${locale}"]`).click()
    await expect(page).toHaveURL(new RegExp(`/${locale}${suffix}$`))
    await expect(page.locator('html')).toHaveAttribute('lang', locale)
    expect(await page.evaluate(() => (window as Window & { localeNavigationMarker?: string }).localeNavigationMarker)).toBe(documentMarker)
  })
}
