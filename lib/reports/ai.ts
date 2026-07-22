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
const UNSUPPORTED_CLAIM = /[$£€¥₹%]|\b(?:USD|HKD|CNY|RMB|EUR|GBP|JPY|percent(?:age)?|traffic|revenue|ranking?|ranked|competitors?)\b/i
const MARKUP = /<[^>]+>|https?:\/\/|www\.|\[[^\]]+\]\([^)]+\)|(^|\n)\s{0,3}#{1,6}\s|(^|\n)\s*[-*+]\s|\*\*|__|\*[^*\n]+\*|_[^_\n]+_|\x60/

function normalizePlainText(value: unknown): string | null {
  if (typeof value !== 'string' || MARKUP.test(value) || UNSUPPORTED_CLAIM.test(value)) return null
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
  const allowed = new Set(tokens)
  for (const token of tokens) {
    allowed.add(token.replace(/^\+/, ''))
  }
  return allowed
}

function validateAiOutput(value: unknown, facts: ReportAiFacts): string | null {
  const normalized = normalizePlainText(value)
  if (!normalized) return null
  const allowed = allowedNumericTokens(facts)
  if (numericTokens(normalized).some(token => !allowed.has(token) && !allowed.has(token.replace(/^\+/, '')))) return null
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