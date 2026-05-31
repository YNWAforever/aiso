import type { Page, Locator } from '@playwright/test'

/**
 * Page Object Model for the scan result page.
 * Two phases: locked (score + email gate) and unlocked (full breakdown).
 */
export class ResultPage {
  readonly page: Page
  readonly scoreNumber: Locator
  readonly topIssueCard: Locator
  readonly emailInput: Locator
  readonly unlockButton: Locator
  readonly deepGeoSection: Locator
  readonly trialCta: Locator
  readonly backLink: Locator

  constructor(page: Page) {
    this.page = page
    // ScoreReveal component
    this.scoreNumber   = page.locator('[class*="tabular-nums"], [class*="text-8xl"], [class*="text-7xl"]').first()
    // TopIssueCard — typically red/orange card
    this.topIssueCard  = page.locator('[class*="border-red"], [class*="border-orange"], [class*="bg-red"], [class*="bg-orange"]').first()
    // EmailCaptureGate form
    this.emailInput    = page.locator('input[type="email"]')
    this.unlockButton  = page.locator('button[type="submit"]')
    // Deep GEO section (only visible after unlock)
    this.deepGeoSection = page.locator('text=Citation Density, text=Factual Density').first()
    // Trial CTA
    this.trialCta      = page.locator('text=Start Free Trial, text=Try Free, text=trial').first()
    // Back to home
    this.backLink      = page.locator('a[href*="/"]').first()
  }

  /** Navigate directly to a result by scan ID */
  async gotoById(lang: string, scanId: string) {
    await this.page.goto(`/${lang}/result/${scanId}`)
    await this.page.waitForLoadState('networkidle')
  }

  /** Wait for the score number to be rendered (count-up animation finishes) */
  async waitForScore() {
    await this.page.waitForFunction(
      () => {
        const els = document.querySelectorAll('[class*="text-8xl"], [class*="text-7xl"], h2')
        return [...els].some(el => /^\d+$/.test((el.textContent ?? '').trim()))
      },
      undefined,
      { timeout: 10_000 },
    )
  }

  async submitEmail(email: string) {
    await this.emailInput.fill(email)
    await this.unlockButton.click()
  }

  /** Wait for the page to transition to "unlocked" phase */
  async waitForUnlocked() {
    // After email submit, DeepGeoSection or full breakdown appears
    await this.page.waitForSelector(
      '[class*="DeepGeo"], [class*="deep-geo"], section',
      { timeout: 10_000 },
    )
  }

  /** Intercept the /api/scan/lead POST and return a stubbed 200 */
  async stubLeadCapture() {
    await this.page.route('**/api/scan/lead', route => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
  }

  /** Intercept /api/scan and return a canned scan result */
  async stubScanApi(scanId = 'test-scan-id-0000-0000-000000000001') {
    await this.page.route('**/api/scan', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: scanId }),
      })
    })
  }
}
