import { describe, expect, it } from 'vitest'
import { PRODUCT_FACTS, getLocalizedProductFacts } from '@/lib/product-facts'
import enMessages from '@/messages/en.json'
import zhMessages from '@/messages/zh-HK.json'

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

  it('keeps pricing Fix Pack claims exact in both locales', () => {
    expect(enMessages.pricing.row_fixpack).toBe(
      'Fix Pack (llms.txt · robots.txt patch · FAQ JSON-LD)',
    )
    expect(zhMessages.pricing.row_fixpack).toBe(
      '修復包（llms.txt · robots.txt 修補檔 · FAQ JSON-LD）',
    )
  })

  it('uses the approved platform list in conversion and dashboard copy', () => {
    expect(enMessages.upsell.body).toBe(
      'See your Share of Voice across ChatGPT, Google AI, Perplexity, Claude, and Gemini — automatically.',
    )
    expect(zhMessages.upsell.body).toBe(
      '自動監測你在 ChatGPT、Google AI、Perplexity、Claude 及 Gemini 的品牌佔有率。',
    )
    expect(enMessages.dashboard.add_first_brand_body).toBe(
      'Track your Share of Voice across ChatGPT, Google AI, Perplexity, Claude, and Gemini. Each brand gets a full diagnostic dashboard with 20 AI readiness checks and agent analysis.',
    )
    expect(zhMessages.dashboard.add_first_brand_body).toBe(
      '追蹤你在 ChatGPT、Google AI、Perplexity、Claude 及 Gemini 的聲音份額。每個品牌都有完整診斷儀表板，包含 20 項 AI 就緒檢查及代理分析。',
    )
  })

  it('does not substitute GPT-4o in tracked-platform recommendations', () => {
    expect(enMessages.dashboard.step_improve_body).toBe(
      'AI agents analyze your scan and give you specific recommendations. Each platform (ChatGPT, Google AI, Perplexity, Claude, Gemini) evaluates your content differently — we show you what each one needs.',
    )
    expect(enMessages.dashboard.step_improve_locked).toBe(
      'Upgrade to Pro to unlock AI agent analysis. Get platform-specific recommendations from ChatGPT, Google AI, Perplexity, Claude, and Gemini. Track your progress over time with before-and-after metrics.',
    )
    expect(zhMessages.dashboard.step_improve_body).toBe(
      'AI 代理會分析你的掃描結果並提供具體建議。每個平台（ChatGPT、Google AI、Perplexity、Claude、Gemini）對內容的評估各有不同——我們會告訴你每個平台需要甚麼。',
    )
    expect(zhMessages.dashboard.step_improve_locked).toBe(
      '升級至專業版即可解鎖 AI 代理分析。獲取 ChatGPT、Google AI、Perplexity、Claude 及 Gemini 的平台專屬建議，並以前後對比指標追蹤你的進度。',
    )
  })
})
