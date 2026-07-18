export const PRODUCT_FACTS = {
  checkCount: 20,
  scoreMaximum: 100,
  platforms: ['ChatGPT', 'Google AI', 'Perplexity', 'Claude', 'Gemini'],
  fixPack: ['llms.txt', 'robots.txt patch', 'FAQ JSON-LD'],
} as const

export type PlatformName = (typeof PRODUCT_FACTS.platforms)[number]

export function getLocalizedProductFacts(locale: string) {
  const isZh = locale === 'zh-HK'

  return {
    checkCount: PRODUCT_FACTS.checkCount,
    platformCount: PRODUCT_FACTS.platforms.length,
    platforms: PRODUCT_FACTS.platforms,
    fixPack: PRODUCT_FACTS.fixPack,
    noCreditCard: isZh ? '毋須信用卡' : 'No credit card',
    freeAccount: isZh ? '免費帳戶' : 'Free account',
  }
}
