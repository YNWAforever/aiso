import AxeBuilder from '@axe-core/playwright'
import { test, expect } from '@playwright/test'
import en from '../../messages/en.json'
import zhHK from '../../messages/zh-HK.json'
import { TEST_SCAN_ID } from '../constants.js'

for (const locale of ['en', 'zh-HK'] as const) {
  const copy = locale === 'en' ? en : zhHK
  for (const width of [375, 1440]) for (const colorScheme of ['light', 'dark'] as const) {
    test(`C7 public routes ${locale} ${width} ${colorScheme}`, async ({ page }) => {
      await page.route('**/api/**', route => route.abort())
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
      for (const path of ['/scan', '/methodology']) {
        expect((await page.goto(`/${locale}${path}`))?.status()).toBe(200)
        await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveCount(1)
        await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`/${locale}${path}$`))
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
      }
      await expect(page.getByRole('main')).toContainText('0.67')
      await expect(page.getByRole('main')).toContainText('0.85')
      await page.getByRole('main').getByRole('link', { name: copy.methodologyPage.scan }).click()
      await expect(page).toHaveURL(new RegExp(`/${locale}/scan$`))
      await expect(page.getByRole('textbox', { name: copy.home.website_url })).toBeVisible()
    })
  }

  test(`C7 localized failures and retry ${locale}`, async ({ page }) => {
    await page.route('**/api/**', route => route.abort())
    await page.goto(`/${locale}/scan`)
    const input = page.getByRole('textbox', { name: copy.home.website_url })
    const submit = page.locator('form button[type="submit"]')
    await submit.click()
    await expect(input).toHaveAttribute('aria-invalid', 'true')
    await expect(input).toBeFocused()
    await input.fill('example.com/path')
    const cases = [
      [503, 'Authentication service unavailable', copy.home.scan_auth_unavailable],
      [503, 'Public scan temporarily unavailable', copy.home.scan_unavailable],
      [503, 'Authenticated scan quota unavailable', copy.home.scan_quota_unavailable],
      [403, 'AUTHENTICATED_SCAN_UPGRADE_REQUIRED', copy.home.scan_upgrade_required],
      [429, 'AUTHENTICATED_SCAN_LIMIT_REACHED', copy.home.scan_quota_reached],
      [429, 'rate limit', copy.home.scan_rate_limited],
      [500, 'Insert returned no data', copy.home.scan_save_failed],
      [500, 'private-database-secret', copy.home.scan_error_action],
      [400, 'Invalid JSON body', copy.home.scan_error_action],
      [400, 'unknown-private-message', copy.home.scan_error_action],
      [400, 'URL must resolve to a public HTTP or HTTPS address', copy.home.url_invalid],
    ] as const
    for (const [status, error, message] of cases) {
      await page.route('**/api/scan', route => route.fulfill({ status, json: { error } }))
      await submit.click()
      await expect(page.getByRole('status')).toHaveText(message)
      await expect(submit).toHaveText(copy.home.retry_scan)
      await expect(input).toBeEnabled()
      await expect(page.getByRole('main')).not.toContainText('private-database-secret')
      await page.unroute('**/api/scan')
    }
    await page.route('**/api/scan', route => route.abort())
    await submit.click()
    await expect(page.getByRole('status')).toHaveText(copy.home.scan_error_action)
    await expect(submit).toBeEnabled()
  })

  test(`C7 malformed success stays retryable ${locale}`, async ({ page }) => {
    const completed: unknown[] = []
    await page.route('**/api/**', async route => {
      if (route.request().url().endsWith('/funnel-events')) completed.push(route.request().postDataJSON())
      await route.abort()
    })
    await page.goto(`/${locale}/scan`)
    await page.getByRole('textbox', { name: copy.home.website_url }).fill('example.com')
    for (const id of ['', '../methodology', 123]) {
      await page.route('**/api/scan', route => route.fulfill({ status: 200, json: { id } }))
      await page.locator('form button[type="submit"]').click()
      await expect(page.getByRole('status')).toHaveText(copy.home.scan_error_action)
      await expect(page).toHaveURL(new RegExp(`/${locale}/scan$`))
      await expect(page.locator('form button[type="submit"]')).toBeEnabled()
      await page.unroute('**/api/scan')
    }
    expect(JSON.stringify(completed)).not.toContain('scan_completed')
  })

  for (const partial of [false, true]) {
    test(`C7 pending and ${partial ? 'partial' : 'complete'} result routing ${locale}`, async ({ page }) => {
      await page.route('**/api/**', route => route.abort())
      let release!: () => void
      const ready = new Promise<void>(resolve => { release = resolve })
      let requests = 0
      await page.route('**/api/scan', async route => {
        requests++
        expect(route.request().postDataJSON().url).toBe('https://example.com/path')
        await ready
        await route.fulfill({ status: 200, json: { id: TEST_SCAN_ID, ...(partial ? { partial: true } : {}) } })
      })
      await page.goto(`/${locale}/scan`)
      const input = page.getByRole('textbox', { name: copy.home.website_url })
      await input.fill('example.com/path')
      await page.locator('form button[type="submit"]').click()
      await expect(page.getByRole('status')).toHaveText(copy.home.scan_loading)
      await expect(input).toBeDisabled()
      await expect(page.locator('form button[type="submit"]')).toBeDisabled()
      release()
      await expect(page).toHaveURL(new RegExp(`/${locale}/result/${TEST_SCAN_ID}$`))
      expect(requests).toBe(1)
    })
  }
}
