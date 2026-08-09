import { test, expect } from '@playwright/test'
import { TEST_SCAN_ID } from '../constants.js'

const LANG = 'en'

test.describe('Email capture gate', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/${LANG}/result/${TEST_SCAN_ID}`, { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle')
  })

  test('fixture result page loads without error', async ({ page }) => {
    await expect(page.locator('body')).not.toContainText('404')
    await expect(page.locator('body')).not.toContainText('This page could not be found')
  })

  test('score number is visible', async ({ page }) => {
    await expect(page.locator('text=/^\\d{1,3}$/').first()).toBeVisible({ timeout: 8_000 })
  })

  test('result page shows email input and submit button in locked state', async ({ page }) => {
    await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 8_000 })
    await expect(page.locator('button[type="submit"]')).toBeVisible()
  })

  test('email gate calls /api/scan/lead on submit', async ({ page }) => {
    const leadRequests: string[] = []
    await page.route('**/api/scan/lead', route => {
      leadRequests.push(route.request().url())
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    await page.locator('input[type="email"]').fill('test@example.com')
    await page.locator('button[type="submit"]').click()
    await expect.poll(() => leadRequests.length).toBeGreaterThan(0)
  })

  test('submitting email transitions to the unlocked state', async ({ page }) => {
    await page.route('**/api/scan/lead', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
    await page.locator('input[type="email"]').fill('unlock@example.com')
    await page.locator('button[type="submit"]').click()
    await expect(page.locator('input[type="email"]')).not.toBeVisible({ timeout: 10_000 })
  })

  test('deep GEO section is visible after unlock', async ({ page }) => {
    await page.route('**/api/scan/lead', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
    await page.locator('input[type="email"]').fill('geo@example.com')
    await page.locator('button[type="submit"]').click()
    await expect(page.locator('text=/Citation|Factual|Topical|Chunkability/i').first()).toBeVisible({ timeout: 10_000 })
  })

  test('invalid email format prevents submission', async ({ page }) => {
    await page.locator('input[type="email"]').fill('not-an-email')
    await page.locator('button[type="submit"]').click()
    await expect(page.locator('input[type="email"]')).toBeVisible()
  })
})

test.describe('Email gate unknown scan ID', () => {
  test('result page returns not-found for an unknown scan ID', async ({ page }) => {
    const response = await page.goto(`/${LANG}/result/00000000-dead-beef-0000-000000000000`, { waitUntil: 'networkidle' })
    expect(response).not.toBeNull()
    expect(response?.status()).toBe(404)
    await expect(page.locator('text=/not found|404|could not be found/i').first()).toBeVisible({ timeout: 5_000 })
  })
})
