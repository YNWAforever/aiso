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

async function resetSeededScanOwnership() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) throw new Error('Seeded scan ownership reset requires Supabase test credentials.')

  const response = await fetch(`${url}/rest/v1/scans?id=eq.${TEST_SCAN_ID}`, {
    method: 'PATCH',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ account_id: null }),
  })
  if (!response.ok) throw new Error(`Could not reset seeded scan ownership: ${response.status}`)
}

test.describe('Scan to signup journey', () => {
  // The credentialed return contracts update the shared seeded scan to the test account.
  test.describe.configure({ mode: 'serial' })

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

  test('submits once, returns from Google, and unlocks the full report after signup', async ({ browser }) => {
    test.skip(
      !hasCredentialedFunnel,
      'Requires the seeded Supabase fixture, Neon Auth, and an authenticated storage state to verify ownership-backed return claiming.',
    )

    const context = await browser.newContext({
      baseURL: process.env.BASE_URL || 'http://localhost:3000',
      storageState: authStorageState,
    })
    const page = await context.newPage()
    await resetSeededScanOwnership()

    const home = new HomePage(page, 'en')
    const result = new ResultPage(page, 'en')
    let scanPosts = 0
    let googleRequestBody: Record<string, unknown> | null = null
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
    await page.route('**/sign-in/social*', route => {
      googleRequestBody = route.request().postDataJSON() as Record<string, unknown>
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=e2e',
          redirect: true,
        }),
      })
    })
    await page.route('https://accounts.google.com/**', route =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Google sign-in</h1>' }),
    )

    try {
      await home.goto()
      await home.scan('https://example.com')
      await home.waitForNavToResult()
      expect(scanPosts).toBe(1)
      await expect(result.score).toBeVisible()
      await expect(result.topIssue).toBeVisible()
      await expect(result.fullCheckBreakdown).not.toBeVisible()
      await expect(result.saveReportCta).toBeVisible()
      await expect(result.googleSignupButton).toBeVisible()
      await expect(result.googleSignupButton).toBeEnabled()
      await expect(result.createAccountButton).toBeVisible()
      await expect(page.getByRole('link', { name: /Get full access/i })).toHaveCount(0)
      await expect.poll(() => claimIntentPosts).toBe(1)

      await result.googleSignupButton.click()
      await expect.poll(() => googleRequestBody).not.toBeNull()
      expect(googleRequestBody?.provider).toBe('google')
      const callback = new URL(String(googleRequestBody?.callbackURL ?? googleRequestBody?.callbackUrl ?? ''))
      expect(callback.pathname).toBe('/en/auth/complete')
      expect(callback.searchParams.get('next')).toBe('/en/result/' + TEST_SCAN_ID + '?claim=1')

      await page.goto('/en/result/' + TEST_SCAN_ID + '?claim=1')
      await page.waitForURL('/en/result/' + TEST_SCAN_ID)
      expect(new URL(page.url()).search).toBe('')
      await expect(result.fullCheckBreakdown).toBeVisible()
      await expect(result.saveReportCta).toHaveCount(0)
      expect(scanPosts).toBe(1)
    } finally {
      await resetSeededScanOwnership()
      await context.close()
    }
  })

  test('retries a failed return claim once without rescanning and then unlocks the report', async ({ browser }) => {
    test.skip(
      !hasCredentialedFunnel,
      'Requires the seeded Supabase fixture, Neon Auth, and an authenticated storage state to verify retry ownership claiming.',
    )

    const context = await browser.newContext({
      baseURL: process.env.BASE_URL || 'http://localhost:3000',
      storageState: authStorageState,
    })
    const page = await context.newPage()
    await resetSeededScanOwnership()
    const result = new ResultPage(page, 'en')
    let scanPosts = 0
    let claimPosts = 0

    page.on('request', request => {
      const parsed = new URL(request.url())
      if (request.method() === 'POST' && parsed.pathname === '/api/scan') scanPosts += 1
      if (request.method() === 'POST' && parsed.pathname === `/api/scans/${TEST_SCAN_ID}/claim`) claimPosts += 1
    })
    await page.route(`**/api/scans/${TEST_SCAN_ID}/claim`, async route => {
      if (claimPosts === 1) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Failed to claim scan' }),
        })
        return
      }
      await route.fallback()
    })

    try {
      await page.goto('/en/result/' + TEST_SCAN_ID + '?claim=1')
      await expect(result.claimStatus).toContainText(/could not save/i)
      await expect(result.retrySaving).toBeVisible()
      expect(claimPosts).toBe(1)

      await result.retrySaving.click()
      await expect.poll(() => claimPosts).toBe(2)
      await page.waitForURL('/en/result/' + TEST_SCAN_ID)
      expect(new URL(page.url()).search).toBe('')
      await expect(result.fullCheckBreakdown).toBeVisible()
      await expect(result.saveReportCta).toHaveCount(0)
      expect(scanPosts).toBe(0)
    } finally {
      await resetSeededScanOwnership()
      await context.close()
    }
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
