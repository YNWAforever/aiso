import { test, expect, type Page, type Request } from '@playwright/test'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
import { E2E_ASSESSED_SCAN_ID } from '@/lib/e2e-fixtures'
import { HomePage } from './pages/HomePage'

/**
 * The public journeys end to end, in fixture mode, with the funnel events
 * each step sends. Nothing leaves the test server: the scan and checkout APIs
 * are answered here, and funnel events are captured, not delivered.
 *
 *   home → scan → result → open the top fix → the free-account prompt
 *   pricing → choose a plan → sign in (checkout needs an account)
 *   sample report → Download PDF (the browser's print)
 */
const catalogs = { en, 'zh-HK': zhHK }

function captureFunnel(page: Page) {
  const events: Record<string, unknown>[] = []
  void page.route('**/api/funnel-events', async route => {
    events.push(JSON.parse(route.request().postData() ?? '{}'))
    await route.fulfill({ status: 204 })
  })
  return {
    names: () => events.map(event => event.name),
    // Events may carry only the redacted fields the endpoint accepts.
    keys: () => [...new Set(events.flatMap(event => Object.keys(event)))].sort(),
  }
}

for (const lang of ['en', 'zh-HK'] as const) {
  const copy = catalogs[lang]

  test(`journey ${lang}: home → scan → result → fix → free account`, async ({ page }) => {
    const funnel = captureFunnel(page)
    await page.route('**/api/scan', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: E2E_ASSESSED_SCAN_ID }) }))
    await page.emulateMedia({ reducedMotion: 'reduce' })

    const home = new HomePage(page, lang)
    await home.goto()
    await home.scan('https://example.com')
    await page.waitForURL(`**/${lang}/result/${E2E_ASSESSED_SCAN_ID}`)
    await expect(page.getByRole('heading', { level: 2, name: copy.resultPage.fixes_title })).toBeVisible()

    const fix = page.getByTestId('result-top-issue').getByRole('button').first()
    await fix.click()
    const drawer = page.getByRole('dialog')
    await expect(drawer).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden()
    await expect(fix).toBeFocused()

    await page.getByTestId('save-result').click()
    await expect(page.locator('#account-unlock-email')).toBeFocused()

    await expect.poll(funnel.names).toEqual(expect.arrayContaining(['scan_completed', 'scan_result_viewed', 'signup_cta_viewed', 'fix_opened']))
    expect(funnel.keys().every(key => ['attemptId', 'locale', 'name', 'provider', 'scanId', 'errorCode'].includes(key))).toBe(true)
  })

  test(`journey ${lang}: pricing → plan → sign in`, async ({ page }) => {
    await page.route('**/api/stripe/checkout', route => route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthorized"}' }))
    await page.goto(`/${lang}/pricing`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: copy.pricing.cta_pro }).first().click()
    await page.waitForURL(new RegExp(`/${lang}/auth/login\\?next=`))
    expect(new URL(page.url()).searchParams.get('next')).toBe(`/${lang}/pricing`)
  })

  test(`journey ${lang}: sample report → Download PDF`, async ({ page }) => {
    const funnel = captureFunnel(page)
    await page.goto(`/${lang}/sample-report`, { waitUntil: 'networkidle' })
    // Stand in for the print window, which a headless browser cannot show.
    await page.evaluate(() => { (window as unknown as { printed: number }).printed = 0; window.print = () => { (window as unknown as { printed: number }).printed += 1 } })
    await page.getByRole('button', { name: copy.reportPage.download_pdf }).click()
    expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1)
    await expect.poll(funnel.names).toContain('report_pdf_downloaded')
  })
}

test('funnel events never carry a URL, an email or scan results', async ({ page }) => {
  const bodies: string[] = []
  page.on('request', (request: Request) => { if (request.url().endsWith('/api/funnel-events')) bodies.push(request.postData() ?? '') })
  await page.route('**/api/funnel-events', route => route.fulfill({ status: 204 }))
  await page.route('**/api/scan', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: E2E_ASSESSED_SCAN_ID }) }))
  const home = new HomePage(page, 'en')
  await home.goto()
  await home.scan('https://example.com')
  await page.waitForURL(`**/result/${E2E_ASSESSED_SCAN_ID}`)
  await expect.poll(() => bodies.length).toBeGreaterThan(0)
  for (const body of bodies) expect(body).not.toMatch(/example\.com|@|"results"/)
})
