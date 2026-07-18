import type { Locator, Page } from '@playwright/test'

type SupportedLang = 'en' | 'zh-HK'

const COPY = {
  en: {
    heading: 'See whether AI recommends your brand.',
    url: 'Website URL',
    scan: 'Run Free Scan',
    personalise: /Personalise/i,
    industry: 'Industry (optional)',
    region: 'Region (optional)',
  },
  'zh-HK': {
    heading: '了解 AI 會否推薦你的品牌。',
    url: '網站網址',
    scan: '立即免費掃描',
    personalise: /個人化/,
    industry: '行業（可選）',
    region: '地區（可選）',
  },
} as const

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
