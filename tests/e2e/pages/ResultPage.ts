import type { Locator, Page } from '@playwright/test'

export class ResultPage {
  readonly page: Page
  readonly score: Locator
  readonly topIssue: Locator
  readonly emailInput: Locator
  readonly createAccountButton: Locator
  readonly googleSignupButton: Locator
  readonly fullCheckBreakdown: Locator
  readonly backLink: Locator

  constructor(page: Page) {
    this.page = page
    this.score = page.getByTestId('result-score')
    this.topIssue = page.getByTestId('result-top-issue').locator('h2')
    this.emailInput = page.locator('input[name="email"]')
    this.createAccountButton = page.getByRole('button', { name: /Create Free Account|免費建立帳戶/i })
    this.googleSignupButton = page.getByRole('button', { name: /Continue with Google|使用 Google 繼續/i })
    this.fullCheckBreakdown = page.getByTestId('full-check-breakdown')
    this.backLink = page.getByRole('link', { name: /Scan another|掃描另一個/i })
  }

  async gotoById(lang: string, scanId: string) {
    await this.page.goto('/' + lang + '/result/' + scanId)
    await this.page.waitForLoadState('networkidle')
  }

  async submitEmail(email: string) {
    await this.emailInput.fill(email)
    await this.createAccountButton.click()
  }
}
