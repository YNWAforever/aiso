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
  readonly personalizeButton: Locator
  readonly scanStatus: Locator
  readonly industrySelect: Locator
  readonly regionSelect: Locator
  readonly errorMessage: Locator

  constructor(page: Page, private readonly lang = 'en') {
    this.page = page
    this.urlInput = this.page.getByLabel('Website URL').first()
    this.scanButton = this.page.getByRole('button', { name: 'Run Free Scan' }).first()
    this.personalizeButton = this.page.getByRole('button', { name: /Personalise/i }).first()
    this.scanStatus = this.page.getByRole('status').first()
    this.scanProgress = this.scanStatus
    this.industrySelect = this.page.getByLabel('Industry (optional)').first()
    this.regionSelect = this.page.getByLabel('Region (optional)').first()
    this.errorMessage = this.scanStatus
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
    await this.personalizeButton.click()
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
