import type { Page, Locator } from '@playwright/test'

/**
 * Page Object Model for the AEOGEO homepage (scan entry point).
 * Supports both English (/en) and Traditional Chinese (/zh-HK) locales.
 */
export class HomePage {
  readonly page: Page
  readonly urlInput: Locator
  readonly scanButton: Locator
  readonly scanProgress: Locator
  readonly personaliseToggle: Locator
  readonly industrySelect: Locator
  readonly regionSelect: Locator
  readonly errorMessage: Locator

  constructor(page: Page, private readonly lang = 'en') {
    this.page = page
    // Use attribute selectors that survive translation changes
    this.urlInput        = page.locator('input[type="text"][required]').first()
    this.scanButton      = page.locator('button[type="submit"]').first()
    this.scanProgress    = page.locator('.animate-bounce').first()
    this.personaliseToggle = page.locator('button:has-text("Personalise")')
    this.industrySelect  = page.locator('select').nth(0)
    this.regionSelect    = page.locator('select').nth(1)
    this.errorMessage    = page.locator('[role="alert"], .text-destructive, .text-red-500').first()
  }

  async goto() {
    await this.page.goto(`/${this.lang}`)
    await this.page.waitForLoadState('networkidle')
  }

  async enterUrl(url: string) {
    await this.urlInput.fill(url)
  }

  async submitScan() {
    await this.scanButton.click()
  }

  async scan(url: string) {
    await this.enterUrl(url)
    await this.submitScan()
  }

  async waitForNavToResult() {
    // Result page URL pattern: /<lang>/result/<uuid>
    await this.page.waitForURL(/\/result\/[a-f0-9-]{36}/, { timeout: 30_000 })
  }

  async openPersonalise() {
    await this.personaliseToggle.click()
  }

  async selectIndustry(industry: string) {
    await this.industrySelect.selectOption(industry)
  }

  async selectRegion(region: string) {
    await this.regionSelect.selectOption(region)
  }

  get currentUrl() {
    return this.page.url()
  }
}
