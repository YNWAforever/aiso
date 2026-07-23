import 'server-only'

import { callOpenRouter } from '@/lib/openrouter'
import type { ComparisonState, ReportLocale } from './types'

export interface ReportAiFacts {
  readonly locale: ReportLocale
  readonly deterministicSummary: string
  readonly currentScore: number
  readonly previousScore?: number
  readonly signedDelta?: string
  readonly comparisonState: ComparisonState
  readonly changeCounts: Readonly<{
    improved: number
    regressed: number
    unchanged: number
    addedCoverage: number
    lostCoverage: number
    dataGap: number
  }>
}

export type ReportAiResult = Readonly<{
  summary: string
  polished: boolean
  code: 'ai_polished' | 'ai_unavailable' | 'ai_invalid_output'
}>

const MODEL = 'anthropic/claude-haiku-4-5'
const NUMERIC_TOKEN = /[+-]?\d+(?:[.,]\d+)*/g
const NON_ASCII_NUMBER = /[^\x00-\x7f]*\p{N}[^\x00-\x7f]*/u
const UNSUPPORTED_SYMBOL = /[\p{Sc}%\u066a\u2030\u2031\u2212\uff05\uff0b\uff0d\ufe62\ufe6a\u207a\u207b\u208a\u208b]/u
const UNSUPPORTED_CLAIM = /\b(?:USD|HKD|CNY|RMB|EUR|GBP|JPY|percent(?:age)?|traffic|revenue|ranking?|ranked|competitors?)\b|收入|營收|收益|流量|排名|競爭對手|競爭者|百分比|百分率|港元|美元|人民幣|英鎊|日圓|歐元/i
const MARKUP = /<[^>]+>|https?:\/\/|www\.|\[[^\]]+\]\([^)]+\)|^\s*(?:>|#{1,6}(?:\s|$)|[-*+]\s|\d+[.)]\s)|\*\*|__|\*[^*\n]+\*|_[^_\n]+_|`/m
const BLOCK_MARKUP = /^(?: {4}|\t)|^ {0,3}(?:=+|-+)[ \t]*$/m

function containsNonAsciiNumber(value: string): boolean {
  return [...value].some(character => NON_ASCII_NUMBER.test(character) && !/[0-9]/.test(character))
}

function normalizePlainText(value: unknown): string | null {
  if (typeof value !== 'string'
    || MARKUP.test(value)
    || BLOCK_MARKUP.test(value)
    || UNSUPPORTED_SYMBOL.test(value)
    || UNSUPPORTED_CLAIM.test(value)
    || containsNonAsciiNumber(value)) return null
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (normalized.length < 40 || normalized.length > 1200) return null
  return normalized
}

function numericTokens(value: string): ReadonlyArray<string> {
  return value.match(NUMERIC_TOKEN) ?? []
}

function allowedNumericTokens(facts: ReportAiFacts): Set<string> {
  const factsForPrompt = {
    currentScore: facts.currentScore,
    previousScore: facts.previousScore,
    signedDelta: facts.signedDelta,
    changeCounts: facts.changeCounts,
    deterministicSummary: facts.deterministicSummary,
  }
  const tokens = numericTokens(JSON.stringify(factsForPrompt))
  return new Set(tokens)
}

function validateAiOutput(value: unknown, facts: ReportAiFacts): string | null {
  const normalized = normalizePlainText(value)
  if (!normalized) return null
  const allowed = allowedNumericTokens(facts)
  if (numericTokens(normalized).some(token => !allowed.has(token))) return null
  return normalized
}

function promptFacts(facts: ReportAiFacts) {
  return {
    locale: facts.locale,
    currentScore: facts.currentScore,
    previousScore: facts.previousScore,
    signedDelta: facts.signedDelta,
    comparisonState: facts.comparisonState,
    changeCounts: facts.changeCounts,
    deterministicSummary: facts.deterministicSummary,
  }
}

export async function polishReportSummary(facts: ReportAiFacts): Promise<ReportAiResult> {
  const fallback = { summary: facts.deterministicSummary, polished: false } as const

  try {
    const response = await callOpenRouter({
      model: MODEL,
      maxTokens: 450,
      signal: AbortSignal.timeout(15_000),
      messages: [
        {
          role: 'system',
          content: 'Polish a client report summary using only the supplied facts. Return plain text only: no Markdown, HTML, links, currency, percentages, traffic, revenue, rank, or competitor claims. Do not introduce any number not present in the facts.',
        },
        {
          role: 'user',
          content: JSON.stringify(promptFacts(facts)),
        },
      ],
    })
    const summary = validateAiOutput(response, facts)
    return summary
      ? { summary, polished: true, code: 'ai_polished' }
      : { ...fallback, code: 'ai_invalid_output' }
  } catch {
    return { ...fallback, code: 'ai_unavailable' }
  }
}