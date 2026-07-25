import { test, expect, type Page } from '@playwright/test'

async function mockGoogleRedirect(page: Page) {
  const requests: Array<Record<string, unknown>> = []

  await page.route('**/sign-in/social*', async route => {
    requests.push(route.request().postDataJSON())
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=test',
        redirect: true,
      }),
    })
  })
  await page.route('https://accounts.google.com/**', route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Google sign-in</h1>' }),
  )

  return requests
}

test.describe('top-level Google auth bridge', () => {
  test('starts once and preserves locale plus scan target in the callback', async ({ page }) => {
    const requests = await mockGoogleRedirect(page)

    await page.goto('/en/auth/google?next=%2Fen%2Fonboarding%3Fscan%3Dscan-123')
    await expect(page).toHaveURL(url => url.hostname === 'accounts.google.com')

    expect(requests).toHaveLength(1)
    expect(requests[0].provider).toBe('google')
    const callback = new URL(String(requests[0].callbackURL))
    expect(callback.pathname).toBe('/en/auth/complete')
    expect(callback.searchParams.get('next')).toBe('/en/onboarding?scan=scan-123')
  })

  test('normalizes a hostile next target before starting Google auth', async ({ page }) => {
    const requests = await mockGoogleRedirect(page)

    await page.goto('/en/auth/google?next=https%3A%2F%2Fattacker.example')
    await expect(page).toHaveURL(url => url.hostname === 'accounts.google.com')

    expect(requests).toHaveLength(1)
    const callback = new URL(String(requests[0].callbackURL))
    expect(callback.searchParams.get('next')).toBe('/en/dashboard')
  })

  test('announces a returned startup failure', async ({ page }) => {
    await page.route('**/sign-in/social*', route =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'GOOGLE_START_FAILED', message: 'Could not start' }),
      }),
    )

    await page.goto('/en/auth/google?next=%2Fen%2Fdashboard')

    await expect(page.locator('main [role="alert"]')).toHaveText(
      'Could not start Google sign-in in this window.',
    )
  })
})
