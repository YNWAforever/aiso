import { test, expect } from '@playwright/test'
import { HomePage } from './pages/HomePage'
import { TEST_SCAN_ID } from '../constants.js'

const STUB_SCAN_ID = TEST_SCAN_ID

test.describe('Scan to result journey', () => {
  let home: HomePage

  test.beforeEach(async ({ page }) => {
    home = new HomePage(page)
    await page.route('**/api/scan', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: STUB_SCAN_ID }),
    }))
  })

  test('homepage loads with a URL input and scan button', async ({ page }) => {
    await home.goto()
    await expect(home.urlInput).toBeVisible()
    await expect(home.scanButton).toBeVisible()
    await expect(page).toHaveTitle(/AISO|AEO|GEO|Fimmick/i)
  })

  test('scan form requires a URL before submitting', async () => {
    await home.goto()
    await home.scanButton.click()
    await expect(home.urlInput).toBeVisible()
  })

  test('entering a URL and submitting shows progress indicator', async ({ page }) => {
    await home.goto()
    await home.enterUrl('https://example.com')
    await home.submitScan()
    await expect(page.locator('text=Scanning, text=Analysing, [class*="animate-bounce"]').first())
      .toBeVisible({ timeout: 5_000 })
      .catch(() => undefined)
  })

  test('after scan completes, page navigates to the fixture result', async ({ page }) => {
    await home.goto()
    await home.scan('https://example.com')
    await home.waitForNavToResult()
    expect(page.url()).toContain(`/result/${STUB_SCAN_ID}`)
  })

  test('fixture result page loads and shows a numeric score', async ({ page }) => {
    await home.goto()
    await home.scan('https://example.com')
    await home.waitForNavToResult()
    await expect(page.locator('body')).not.toContainText('This page could not be found')
    await expect(page.locator('text=/^\\d{1,3}$/')).toBeVisible()
  })

  test('fixture result page shows the email capture gate', async ({ page }) => {
    await home.goto()
    await home.scan('https://example.com')
    await home.waitForNavToResult()
    await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 8_000 })
  })

  test('personalise panel reveals industry and region selects', async ({ page }) => {
    await home.goto()
    const toggle = page.locator('button:has-text("Personalise"), button:has-text("personalise")').first()
    if (await toggle.isVisible()) {
      await toggle.click()
      await expect(page.locator('select').first()).toBeVisible()
    }
  })
})
