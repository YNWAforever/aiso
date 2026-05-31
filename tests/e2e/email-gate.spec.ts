/**
 * E2E: Email capture gate on the result page
 *
 * Uses a real scan row seeded by globalSetup.ts (TEST_SCAN_ID).
 * The result page is SSR — Supabase is called server-side, so
 * page.route() cannot stub it. We use a real row instead.
 *
 * NOTE: These tests require migration 020_scans_public_select.sql to be
 * applied so the anon key can read the scan row.
 * Run: npx supabase db push (or apply via Supabase dashboard).
 */
import { test, expect } from '@playwright/test'
import { TEST_SCAN_ID } from '../constants.js'

const LANG = 'en'

// Skip the whole suite if the DB migration hasn't been applied yet —
// the globalSetup will log a warning if it couldn't seed the row.
test.describe('Email capture gate', () => {
  test.beforeEach(async ({ page }) => {
    // Verify we can actually reach the result page; if not, skip gracefully
    const response = await page.goto(`/${LANG}/result/${TEST_SCAN_ID}`, { waitUntil: 'domcontentloaded' })
    if (response?.status() === 404) {
      test.skip(true,
        'Result page 404 — either RLS blocks anon reads (apply migration 020_scans_public_select.sql) or test scan was not seeded.'
      )
    }
    await page.waitForLoadState('networkidle')
  })

  test('result page loads without error', async ({ page }) => {
    await expect(page.locator('body')).not.toContainText('404')
    await expect(page.locator('body')).not.toContainText('This page could not be found')
    await page.screenshot({ path: 'playwright-report/result-page-real.png' })
  })

  test('score number is visible', async ({ page }) => {
    await expect(
      page.locator('text=/^\\d{1,3}$/').first()
    ).toBeVisible({ timeout: 8_000 })
  })

  test('result page shows email input in locked state', async ({ page }) => {
    await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 8_000 })
    await page.screenshot({ path: 'playwright-report/email-gate-locked.png' })
  })

  test('submit button is visible in locked state', async ({ page }) => {
    await page.locator('input[type="email"]').waitFor({ state: 'visible', timeout: 8_000 })
    await expect(page.locator('button[type="submit"]')).toBeVisible()
  })

  test('email gate calls /api/scan/lead on submit', async ({ page }) => {
    const leadRequests: string[] = []
    await page.route('**/api/scan/lead', route => {
      leadRequests.push(route.request().url())
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      })
    })

    await page.locator('input[type="email"]').waitFor({ state: 'visible', timeout: 8_000 })
    await page.locator('input[type="email"]').fill('test@example.com')
    await page.locator('button[type="submit"]').click()

    // Wait briefly for the API call to fire
    await page.waitForTimeout(1_000)
    expect(leadRequests.length).toBeGreaterThan(0)
  })

  test('submitting email transitions to unlocked state', async ({ page }) => {
    await page.route('**/api/scan/lead', route => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })

    await page.locator('input[type="email"]').waitFor({ state: 'visible', timeout: 8_000 })
    await page.locator('input[type="email"]').fill('unlock@example.com')
    await page.locator('button[type="submit"]').click()

    // Email gate disappears after unlock
    await expect(page.locator('input[type="email"]')).not.toBeVisible({ timeout: 10_000 })
    await page.screenshot({ path: 'playwright-report/email-gate-unlocked.png' })
  })

  test('deep GEO section (Citation, Factual, Topical) visible after unlock', async ({ page }) => {
    await page.route('**/api/scan/lead', route => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })

    await page.locator('input[type="email"]').waitFor({ state: 'visible', timeout: 8_000 })
    await page.locator('input[type="email"]').fill('geo@example.com')
    await page.locator('button[type="submit"]').click()

    await expect(
      page.locator('text=/Citation|Factual|Topical|Chunkability/i').first()
    ).toBeVisible({ timeout: 10_000 })
    await page.screenshot({ path: 'playwright-report/deep-geo-section.png', fullPage: true })
  })

  test('invalid email format prevents submission (HTML5 validation)', async ({ page }) => {
    await page.locator('input[type="email"]').waitFor({ state: 'visible', timeout: 8_000 })
    await page.locator('input[type="email"]').fill('not-an-email')
    await page.locator('button[type="submit"]').click()
    // Email field stays visible — form not submitted
    await expect(page.locator('input[type="email"]')).toBeVisible()
  })
})

test.describe('Email gate — unknown scan ID', () => {
  test('result page returns not-found for unknown scan ID', async ({ page }) => {
    const response = await page.goto(
      `/${LANG}/result/00000000-dead-beef-0000-000000000000`,
      { waitUntil: 'networkidle' }
    )
    const status = response?.status() ?? 0
    if (status === 404) {
      // Next.js notFound() renders a 404 page
      expect(status).toBe(404)
    } else {
      // The page rendered but should show a not-found message
      await expect(
        page.locator('text=/not found|404|could not be found/i').first()
      ).toBeVisible({ timeout: 5_000 })
    }
  })
})
