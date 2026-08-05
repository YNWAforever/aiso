import type { Locator, Page } from '@playwright/test'

type SupportedLang = 'en' | 'zh-HK'

export class ResultPage {
  readonly score: Locator
  readonly topIssue: Locator
  readonly emailInput: Locator
  readonly createAccountButton: Locator
  readonly googleSignupButton: Locator
  readonly saveReportCta: Locator
  readonly claimStatus: Locator
  readonly retrySaving: Locator
  readonly fullCheckBreakdown: Locator
  readonly backLink: Locator

  constructor(readonly page: Page, private readonly lang: SupportedLang = 'en') {
    this.score = page.getByTestId('result-score')
    this.topIssue = page.getByTestId('result-top-issue').locator('h2')
    this.emailInput = page.locator('input[name="email"]')
    this.createAccountButton = page.getByTestId('create-account')
    this.googleSignupButton = page.getByTestId('google-signup')
    this.saveReportCta = page.getByTestId('save-report-cta')
    this.claimStatus = page.getByTestId('claim-status')
    this.retrySaving = this.claimStatus.getByRole('button')
    this.fullCheckBreakdown = page.getByTestId('full-check-breakdown')
    this.backLink = page.getByRole('link', {
      name: lang === 'zh-HK' ? /再次掃描|掃描另一個/ : /Scan another/i,
    })
  }

  async gotoById(scanId: string) {
    await this.page.goto('/' + this.lang + '/result/' + scanId)
    await this.page.waitForLoadState('networkidle')
  }

  async submitEmail(email: string) {
    await this.emailInput.fill(email)
    await this.createAccountButton.click()
  }
}
