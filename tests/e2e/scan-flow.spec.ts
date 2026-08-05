import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { HomePage } from './pages/HomePage'
import { ResultPage } from './pages/ResultPage'
import { TEST_SCAN_ID } from '../constants.js'

const hasSeededResult = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)
const authStorageState = process.env.PLAYWRIGHT_AUTH_STORAGE_STATE
const hasCredentialedFunnel = Boolean(
  hasSeededResult &&
  process.env.NEON_AUTH_BASE_URL &&
  authStorageState &&
  existsSync(authStorageState),
)

test.describe('Scan to signup journey', () => {
  test('English homepage exposes the proof-first scan contract', async ({ page }) => {
    const home = new HomePage(page, 'en')
    await home.goto()

    await expect(home.heading).toBeVisible()
    await expect(home.urlInput).toBeVisible()
    await expect(home.scanButton).toBeVisible()
    await expect(page.getByText('No signup to scan')).toBeVisible()
    await expect(page.getByText('5 AI platforms')).toBeVisible()
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(1)
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute('href', '#main-content')
    await expect(page.locator('main#main-content')).toHaveCount(1)
  })

  test('empty URL error is described, announced, and returns focus', async ({ page }) => {
    const home = new HomePage(page, 'en')
    await home.goto()
    await home.submitScan()

    await expect(home.urlInput).toBeFocused()
    await expect(home.urlInput).toHaveAttribute('aria-invalid', 'true')
    const errorId = await home.urlInput.getAttribute('aria-describedby')
    expect(errorId).toBeTruthy()
    await expect(page.locator('#' + errorId)).toHaveText('Enter your website URL to start the scan.')
    await expect(home.scanStatus).toBeEmpty()
  })

  test('personalisation fields are labeled and keyboard reachable', async ({ page }) => {
    const home = new HomePage(page, 'en')
    await home.goto()
    await home.personalizeButton.focus()
    await expect(home.personalizeButton).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(home.industrySelect).toBeVisible()
    await expect(home.regionSelect).toBeVisible()
  })

  test('zh-HK homepage keeps its localized hierarchy and scan action', async ({ page }) => {
    const home = new HomePage(page, 'zh-HK')
    await home.goto()
    await expect(home.heading).toBeVisible()
    await expect(home.heading).toHaveText('了解 AI 會否推薦你的品牌。')
    await expect(home.urlInput).toBeVisible()
    await expect(home.scanButton).toBeVisible()
  })

  test('submits once, preserves scan context, and saves the report after signup', async ({ page }) => {
    test.skip(!hasSeededResult, 'Requires Supabase URL, anon key, and service-role key to seed and read the public scan fixture.')

    const home = new HomePage(page, 'en')
    const result = new ResultPage(page, 'en')
    let scanPosts = 0
    let authRequestBody: Record<string, unknown> | null = null
    let claimIntentPosts = 0

    page.on('request', request => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/scan') scanPosts += 1
    })
    await page.route('**/api/scan', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: TEST_SCAN_ID }),
    }))
    await page.route(`**/api/scans/${TEST_SCAN_ID}/claim-intent`, route => {
      claimIntentPosts += 1
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    await page.route('**/sign-in/magic-link*', route => {
      authRequestBody = route.request().postDataJSON() as Record<string, unknown>
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })

    await home.goto()
    await home.scan('https://example.com')
    await home.waitForNavToResult()
    expect(scanPosts).toBe(1)
    await expect(result.score).toBeVisible()
    await expect(result.topIssue).toBeVisible()
    await expect(result.fullCheckBreakdown).not.toBeVisible()
    await expect(result.saveReportCta).toBeVisible()
    await expect(result.createAccountButton).toBeVisible()
    await expect(page.getByRole('link', { name: /Get full access/i })).toHaveCount(0)
    await expect.poll(() => claimIntentPosts).toBe(1)

    await result.submitEmail('unlock@example.com')
    await expect.poll(() => authRequestBody).not.toBeNull()
    const callback = new URL(String(authRequestBody?.callbackURL ?? authRequestBody?.callbackUrl ?? ''))
    expect(callback.pathname).toBe('/en/auth/complete')
    expect(callback.searchParams.get('next')).toBe('/en/result/' + TEST_SCAN_ID + '?claim=1')

    await page.route(`**/api/scans/${TEST_SCAN_ID}/claim`, route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, alreadyOwned: false }),
    }))
    await page.goto('/en/result/' + TEST_SCAN_ID + '?claim=1')
    await expect(result.claimStatus).toBeVisible()
    await expect(result.claimStatus).toContainText(/report saved/i)
    expect(scanPosts).toBe(1)
  })

  test('zh-HK account unlock preserves locale and scan ID', async ({ page }) => {
    test.skip(!hasSeededResult, 'Requires the seeded Supabase result fixture for localized account-unlock coverage.')
    await page.goto('/zh-HK/result/' + TEST_SCAN_ID)
    const result = new ResultPage(page, 'zh-HK')
    await expect(result.createAccountButton).toContainText(/免費|帳戶/)

    let body: Record<string, unknown> | null = null
    await page.route('**/sign-in/magic-link*', route => {
      body = route.request().postDataJSON() as Record<string, unknown>
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })
    await result.submitEmail('unlock@example.com')
    await expect.poll(() => body).not.toBeNull()
    const callback = new URL(String(body?.callbackURL ?? body?.callbackUrl ?? ''))
    expect(callback.pathname).toBe('/zh-HK/auth/complete')
    expect(callback.searchParams.get('next')).toBe('/zh-HK/result/' + TEST_SCAN_ID + '?claim=1')
  })

  test('authenticated onboarding claims the scan and renders the full existing report without rescanning', async ({ browser }) => {
    test.skip(
      !hasCredentialedFunnel,
      'Requires seeded Supabase credentials, NEON_AUTH_BASE_URL, and PLAYWRIGHT_AUTH_STORAGE_STATE for a real authenticated claim.',
    )
    const context = await browser.newContext({
      baseURL: process.env.BASE_URL || 'http://localhost:3000',
      storageState: authStorageState,
    })
    const page = await context.newPage()
    let scanPosts = 0
    page.on('request', request => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/scan') scanPosts += 1
    })
    await page.route('**/api/scan', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: TEST_SCAN_ID }),
    }))

    const home = new HomePage(page, 'en')
    await home.goto()
    await home.scan('https://example.com')
    await home.waitForNavToResult()
    await page.goto('/en/onboarding?scan=' + TEST_SCAN_ID)
    await expect(page.getByLabel('Industry (optional)')).toBeVisible()
    await page.getByRole('button', { name: 'Continue' }).click()
    const onboardingResponse = page.waitForResponse(response =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/onboarding/complete',
    )
    await page.getByRole('button', { name: 'Go to my dashboard' }).click()
    const response = await onboardingResponse
    expect(response.ok()).toBe(true)
    const data = await response.json() as { clientId: string; scanId: string }
    expect(data.scanId).toBe(TEST_SCAN_ID)
    await page.waitForURL('/en/dashboard/' + data.clientId + '/result/' + TEST_SCAN_ID)
    await expect(page.locator('main')).toContainText(/checks scanned/i)
    await expect(page.getByTestId('create-account')).toHaveCount(0)
    expect(scanPosts).toBe(1)
    await context.close()
  })

})

test.describe('375px pricing containment', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('pricing comparison stays inside the page and scrolls within its narrow region', async ({ page }) => {
    await page.goto('/en/pricing', { waitUntil: 'networkidle' })
    const pageWidth = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }))
    expect(pageWidth.scroll).toBeLessThanOrEqual(pageWidth.client)

    const comparison = page.getByRole('region', { name: 'Compare paid plan features' })
    await expect(comparison).toBeVisible()
    const widths = await comparison.evaluate(element => ({
      client: element.clientWidth,
      scroll: element.scrollWidth,
    }))
    expect(widths.scroll).toBeGreaterThan(widths.client)
  })
})
