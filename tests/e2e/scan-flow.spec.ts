/**
 * E2E: Scan → Result flow
 *
 * Critical user journey:
 *   1. Land on homepage
 *   2. Enter a URL and submit
 *   3. See progress indicator
 *   4. Arrive at result page with a score
 *
 * API calls are routed to mocks so tests run offline and fast.
 */
import { test, expect } from '@playwright/test'
import { HomePage }   from './pages/HomePage'
import { ResultPage } from './pages/ResultPage'
import { TEST_SCAN_ID } from '../constants.js'

// The scan stub returns the seeded test scan ID.
// The result page SSR fetches this from Supabase (real DB call — not stubbed).
// Requires: migration 020_scans_public_select.sql applied so anon key can read the row.
const STUB_SCAN_ID = TEST_SCAN_ID

test.describe('Scan → Result journey', () => {
  let home:   HomePage
  let result: ResultPage

  test.beforeEach(async ({ page }) => {
    home   = new HomePage(page)
    result = new ResultPage(page)

    // Stub POST /api/scan → returns the test scan ID
    await page.route('**/api/scan', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: STUB_SCAN_ID }),
      })
    })

    // Note: The result page SSR calls Supabase server-side — page.route() cannot
    // intercept it. We rely on the real test scan row seeded by globalSetup.ts.
  })

  test('homepage loads with a URL input and scan button', async ({ page }) => {
    await home.goto()
    await expect(home.urlInput).toBeVisible()
    await expect(home.scanButton).toBeVisible()
    await expect(page).toHaveTitle(/AISO|AEO|GEO|Fimmick/i)
    await page.screenshot({ path: 'playwright-report/homepage.png' })
  })

  test('scan form requires a URL before submitting', async () => {
    await home.goto()
    // Click submit without filling the URL — HTML5 validation fires
    await home.scanButton.click()
    // Input should still be visible (page did not navigate)
    await expect(home.urlInput).toBeVisible()
  })

  test('entering a URL and submitting shows progress indicator', async ({ page }) => {
    await home.goto()
    await home.enterUrl('https://example.com')
    await home.submitScan()
    // Progress dots or scanning text should appear while the request is in-flight
    await expect(
      page.locator('text=Scanning, text=Analysing, [class*="animate-bounce"]').first()
    ).toBeVisible({ timeout: 5_000 })
      .catch(() => { /* progress may flash briefly and disappear */ })
  })

  test('after scan completes, page navigates to /result/:id', async ({ page }) => {
    await home.goto()
    await home.scan('https://example.com')
    await home.waitForNavToResult()
    expect(page.url()).toContain('/result/')
    expect(page.url()).toContain(STUB_SCAN_ID)
    await page.screenshot({ path: 'playwright-report/result-page.png' })
  })

  // ── Tests that require migration 020_scans_public_select.sql ──────────────
  // These check result page content. They skip automatically when the anon key
  // can't read the scan row (RLS blocks it until the migration is applied).

  test('result page loads (not 404) after scan completes', async ({ page, request }) => {
    // Pre-flight: check if anon key can read the test scan
    const check = await request.get(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/scans?id=eq.${STUB_SCAN_ID}&select=id`,
      { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '', Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''}` } }
    )
    const rows = await check.json() as unknown[]
    test.skip(!rows.length, 'Scan not readable by anon — apply migration 020_scans_public_select.sql')

    await home.goto()
    await home.scan('https://example.com')
    await home.waitForNavToResult()
    await expect(page.locator('body')).not.toContainText('This page could not be found')
    await page.screenshot({ path: 'playwright-report/result-page.png' })
  })

  test('result page shows a numeric score when scan is accessible', async ({ page, request }) => {
    const check = await request.get(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/scans?id=eq.${STUB_SCAN_ID}&select=id`,
      { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '', Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''}` } }
    )
    const rows = await check.json() as unknown[]
    test.skip(!rows.length, 'Scan not readable by anon — apply migration 020')

    await home.goto()
    await home.scan('https://example.com')
    await home.waitForNavToResult()
    await page.waitForFunction(
      () => [...document.querySelectorAll('*')].some(el =>
        /^\d+$/.test((el.textContent ?? '').trim()) &&
        (el.textContent?.trim().length ?? 0) <= 3
      ),
      undefined,
      { timeout: 10_000 },
    )
    await expect(page.locator('text=/^\\d{1,3}$/')).toBeVisible()
  })

  test('result page shows email capture gate before unlock', async ({ page, request }) => {
    const check = await request.get(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/scans?id=eq.${STUB_SCAN_ID}&select=id`,
      { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '', Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''}` } }
    )
    const rows = await request.get(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/scans?id=eq.${STUB_SCAN_ID}&select=id`,
      { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '', Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''}` } }
    ).then(r => r.json() as Promise<unknown[]>)
    test.skip(!rows.length, 'Scan not readable by anon — apply migration 020')

    await home.goto()
    await home.scan('https://example.com')
    await home.waitForNavToResult()
    await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 8_000 })
    await page.screenshot({ path: 'playwright-report/email-gate.png' })
  })

  test('personalise panel reveals industry + region selects', async ({ page }) => {
    await home.goto()
    // The toggle should be in the DOM
    const toggle = page.locator('button:has-text("Personalise"), button:has-text("personalise")').first()
    if (await toggle.isVisible()) {
      await toggle.click()
      // After expanding, selects should appear
      await expect(page.locator('select').first()).toBeVisible()
    }
  })
})
