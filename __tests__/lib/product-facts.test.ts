import { describe, expect, it } from 'vitest'
import { PRODUCT_FACTS, getLocalizedProductFacts } from '@/lib/product-facts'

describe('PRODUCT_FACTS', () => {
  it('uses the approved five-platform claim everywhere', () => {
    expect(PRODUCT_FACTS.platforms).toEqual([
      'ChatGPT',
      'Google AI',
      'Perplexity',
      'Claude',
      'Gemini',
    ])
    expect(PRODUCT_FACTS.platforms).toHaveLength(5)
  })

  it('defines the core Fix Pack without marketing drift', () => {
    expect(PRODUCT_FACTS.fixPack).toEqual([
      'llms.txt',
      'robots.txt patch',
      'FAQ JSON-LD',
    ])
  })

  it('keeps critical English and Hong Kong Chinese facts aligned', () => {
    const en = getLocalizedProductFacts('en')
    const zh = getLocalizedProductFacts('zh-HK')
    expect(en.platformCount).toBe(zh.platformCount)
    expect(en.checkCount).toBe(zh.checkCount)
    expect(en.fixPack).toEqual(zh.fixPack)
  })
})
