import type { PromptBatchRow } from './bulk'
import { PULSE_ACTIVE_QUESTIONS_PER_BRAND } from '@/lib/pulse/limits'

/**
 * Retainer OS Slice A: turn a brand's real Hong Kong search demand (its top
 * Search Console queries) into DRAFT Pulse questions. Pure — the store reads
 * the rows, the operator edits and applies the drafts through the existing bulk
 * preview → apply path. Nothing here writes, calls a model or invents a figure.
 *
 * - Branded queries (the brand name, or the domain's own name) are left out:
 *   asking an AI about the brand by name says nothing about whether the AI
 *   recommends it unprompted, so they would inflate share of voice.
 * - The wording is a plain template, flagged as a draft: the operator rewrites
 *   it before anything is activated (brief Q3: rule-based, no LLM spend).
 * - At most `PULSE_ACTIVE_QUESTIONS_PER_BRAND` drafts, and only as many are
 *   proposed as active as the brand has free active slots.
 */

export type DemandQuery = { query: string; clicks: number; impressions: number; position: number | null }
export type DemandSource = DemandQuery & { language: 'en' | 'zh-HK' }
export type DemandDrafts = {
  rows: PromptBatchRow[]
  /** The query and its figures behind each row, same order. */
  sources: DemandSource[]
  excludedBranded: number
}

export const DEMAND_DRAFT_MAX = PULSE_ACTIVE_QUESTIONS_PER_BRAND

const CJK = /[㐀-鿿豈-﫿]/
const QUESTION_START = /^(what|which|where|who|why|how|is|are|can|does|do|should|best)\b/i
const ZH_QUESTION = /(嗎|呢|邊|點|咩|什麼|甚麼|哪|如何|怎樣|幾多|多少)/

const collapse = (text: string) => text.normalize('NFC').replace(/\s+/g, ' ').trim()
const squash = (text: string) => collapse(text).toLowerCase().replace(/[\s._-]+/g, '')

/** The words that make a query "about the brand": its name, and the domain's own label. */
export function brandTerms(brandName: string | null, domain: string | null): string[] {
  const terms = new Set<string>()
  if (brandName && squash(brandName).length >= 2) terms.add(squash(brandName))
  if (domain) {
    const host = domain.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/:]/)[0] ?? ''
    const label = host.split('.')[0] ?? ''
    // A one- to three-letter label ("abc.hk") matches too many unrelated queries to be a safe signal.
    if (label.length >= 4) terms.add(squash(label))
  }
  return [...terms]
}

export function isBrandedQuery(query: string, terms: string[]): boolean {
  const q = squash(query)
  return terms.some(term => q.includes(term))
}

/** One line of a draft question in the query's own language. Always a draft for the operator to rewrite. */
export function draftQuestion(query: string): { question: string; language: 'en' | 'zh-HK' } {
  const q = collapse(query)
  if (CJK.test(q)) {
    if (ZH_QUESTION.test(q) || /[？?]$/.test(q)) return { question: q.replace(/[?？]?$/, '？'), language: 'zh-HK' }
    return { question: `可以推薦香港的${q}嗎？`, language: 'zh-HK' }
  }
  if (QUESTION_START.test(q) || q.endsWith('?')) {
    const text = q.replace(/\?*$/, '?')
    return { question: text.charAt(0).toUpperCase() + text.slice(1), language: 'en' }
  }
  return { question: `Can you recommend ${q} in Hong Kong?`, language: 'en' }
}

/**
 * Ranks by impressions (demand), then clicks; skips branded, too-short and
 * URL-like queries and any whose draft already exists in the bank; stops at
 * `DEMAND_DRAFT_MAX`. `activeSlots` drafts are proposed active, the rest
 * inactive, so applying them as drafted can never exceed the budget.
 */
export function draftDemandQuestions(input: {
  queries: DemandQuery[]
  brandName: string | null
  domain: string | null
  existingQuestions: string[]
  activeSlots: number
}): DemandDrafts {
  const terms = brandTerms(input.brandName, input.domain)
  const seen = new Set(input.existingQuestions.map(q => collapse(q).toLowerCase()))
  const ranked = [...input.queries]
    .filter(q => typeof q.query === 'string' && Number.isFinite(q.impressions) && q.impressions > 0)
    .sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks || a.query.localeCompare(b.query))
  const rows: PromptBatchRow[] = [], sources: DemandSource[] = []
  let excludedBranded = 0, slots = Math.max(0, input.activeSlots)
  for (const q of ranked) {
    if (rows.length >= DEMAND_DRAFT_MAX) break
    const text = collapse(q.query)
    if (text.length < 2 || /^https?:\/\/|^www\.|\.\w{2,}\//i.test(text) || /^\d+$/.test(text)) continue
    if (isBrandedQuery(text, terms)) { excludedBranded++; continue }
    const draft = draftQuestion(text)
    const key = draft.question.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({ question: draft.question, category: 'category_query', language: draft.language, market: 'HK', is_active: slots > 0 })
    if (slots > 0) slots--
    sources.push({ query: text, clicks: q.clicks, impressions: q.impressions, position: q.position, language: draft.language })
  }
  return { rows, sources, excludedBranded }
}

/** The drafts as the bulk panel's CSV, so the operator edits them in the same box as any import. */
export function demandDraftsCsv(rows: PromptBatchRow[]): string {
  const cell = (value: string) => /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
  return ['question,category,language,market,is_active', ...rows.map(r =>
    [cell(r.question), r.category, r.language, r.market ?? '', String(r.is_active)].join(','))].join('\n')
}
