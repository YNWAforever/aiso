import { describe, it, expect } from 'vitest'
import { brandTerms, isBrandedQuery, draftQuestion, draftDemandQuestions, demandDraftsCsv, DEMAND_DRAFT_MAX } from '@/lib/prompts/demand'
import { parsePromptCsv, previewPromptRows } from '@/lib/prompts/bulk'

const q = (query: string, impressions: number, clicks = 0, position: number | null = 5) => ({ query, impressions, clicks, position })

describe('brand terms', () => {
  it('uses the brand name and a domain label of four or more letters', () => {
    expect(brandTerms('Acme Dental', 'https://www.acmedental.com.hk/path')).toEqual(['acmedental'])
    expect(brandTerms('Zen', 'zenspa.hk')).toEqual(['zen', 'zenspa'])
    expect(brandTerms(null, 'abc.hk')).toEqual([])
  })
  it('matches across spaces, dots and case', () => {
    expect(isBrandedQuery('ACME dental opening hours', ['acmedental'])).toBe(true)
    expect(isBrandedQuery('dental clinic central', ['acmedental'])).toBe(false)
  })
})

describe('draft wording', () => {
  it('turns a plain English query into a Hong Kong recommendation question', () => {
    expect(draftQuestion('  teeth   whitening ')).toEqual({ question: 'Can you recommend teeth whitening in Hong Kong?', language: 'en' })
  })
  it('keeps a query that is already a question', () => {
    expect(draftQuestion('best dentist in central')).toEqual({ question: 'Best dentist in central?', language: 'en' })
    expect(draftQuestion('how much is invisalign??')).toEqual({ question: 'How much is invisalign?', language: 'en' })
  })
  it('drafts Traditional Chinese queries in zh-HK', () => {
    expect(draftQuestion('牙齒美白')).toEqual({ question: '可以推薦香港的牙齒美白嗎？', language: 'zh-HK' })
    expect(draftQuestion('洗牙幾多錢')).toEqual({ question: '洗牙幾多錢？', language: 'zh-HK' })
  })
})

describe('drafting from demand', () => {
  const base = { brandName: 'Acme Dental', domain: 'acmedental.hk', existingQuestions: [] as string[], activeSlots: 10 }

  it('ranks by impressions, leaves out branded and junk queries, and carries each source', () => {
    const out = draftDemandQuestions({ ...base, queries: [
      q('teeth whitening', 100, 4), q('acme dental', 900, 80), q('https://acmedental.hk/', 50), q('12345', 40),
      q('牙齒美白', 300, 9), q('x', 30), q('zero', 0),
    ] })
    expect(out.excludedBranded).toBe(1)
    expect(out.rows.map(r => r.question)).toEqual(['可以推薦香港的牙齒美白嗎？', 'Can you recommend teeth whitening in Hong Kong?'])
    expect(out.rows.every(r => r.category === 'category_query' && r.market === 'HK')).toBe(true)
    expect(out.sources).toEqual([
      { query: '牙齒美白', clicks: 9, impressions: 300, position: 5, language: 'zh-HK' },
      { query: 'teeth whitening', clicks: 4, impressions: 100, position: 5, language: 'en' },
    ])
  })

  it('skips drafts that already exist in the bank', () => {
    const out = draftDemandQuestions({ ...base, existingQuestions: ['can you recommend TEETH whitening in hong kong?'],
      queries: [q('teeth whitening', 100), q('braces', 50)] })
    expect(out.rows.map(r => r.question)).toEqual(['Can you recommend braces in Hong Kong?'])
  })

  it('stops at the draft maximum and proposes only free slots as active', () => {
    const out = draftDemandQuestions({ ...base, activeSlots: 3,
      queries: Array.from({ length: 30 }, (_, i) => q(`service ${String.fromCharCode(97 + (i % 26))}${i}`, 100 - i)) })
    expect(out.rows).toHaveLength(DEMAND_DRAFT_MAX)
    expect(out.rows.filter(r => r.is_active)).toHaveLength(3)
    expect(out.rows.slice(0, 3).every(r => r.is_active)).toBe(true)
    expect(draftDemandQuestions({ ...base, activeSlots: -4, queries: [q('braces', 5)] }).rows[0].is_active).toBe(false)
  })

  it('round-trips through the bulk CSV path and stays inside the active budget as drafted', () => {
    const existing = Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, question: `Existing ${i}`, category: 'brand_query', language: 'en', market: 'HK', is_active: true }))
    const out = draftDemandQuestions({ ...base, activeSlots: 3, existingQuestions: existing.map(e => e.question),
      queries: [q('dentist, "central"', 90), q('braces', 80), q('implants', 70), q('veneers', 60)] })
    const csv = demandDraftsCsv(out.rows)
    expect(csv.split('\n')[0]).toBe('question,category,language,market,is_active')
    const parsed = parsePromptCsv(csv)
    expect(parsed).toEqual(out.rows)
    expect(previewPromptRows(existing, parsed).errors).toEqual([])
  })
})
