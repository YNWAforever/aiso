import type { Locator, Page } from '@playwright/test'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'

type SupportedLang = 'en' | 'zh-HK'

// Read from the catalogues rather than copied: the hard-coded heading here
// went stale when the hero copy changed, and nothing noticed because a
// locator that matches nothing only fails when a test uses it.
const copyFor = (catalogue: typeof en) => ({
  heading: catalogue.home.proof_headline,
  url: catalogue.home.website_url,
  scan: catalogue.home.cta,
  personalise: catalogue.home.personalise_toggle,
  industry: catalogue.home.industry_placeholder,
  region: catalogue.home.region_placeholder,
})

const COPY = { en: copyFor(en), 'zh-HK': copyFor(zhHK) } as const

export class HomePage {
  readonly heading: Locator
  readonly urlInput: Locator
  readonly scanButton: Locator
  readonly personalizeButton: Locator
  readonly scanStatus: Locator
  readonly scanProgress: Locator
  readonly industrySelect: Locator
  readonly regionSelect: Locator
  readonly errorMessage: Locator

  constructor(readonly page: Page, private readonly lang: SupportedLang = 'en') {
    const copy = COPY[lang]
    this.heading = page.getByRole('heading', { level: 1, name: copy.heading })
    this.urlInput = page.getByLabel(copy.url).first()
    this.scanButton = page.getByRole('button', { name: copy.scan }).first()
    this.personalizeButton = page.getByRole('button', { name: copy.personalise }).first()
    this.scanStatus = page.getByRole('status').first()
    this.scanProgress = this.scanStatus
    this.industrySelect = page.getByLabel(copy.industry).first()
    this.regionSelect = page.getByLabel(copy.region).first()
    this.errorMessage = this.scanStatus
  }

  async goto() {
    await this.page.goto('/' + this.lang)
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
    await this.page.waitForURL(new RegExp('/' + this.lang + '/result/[a-z0-9-]+$'), { timeout: 30_000 })
  }

  get currentUrl() {
    return this.page.url()
  }
}
