import { UNTRUSTED_SYSTEM_RULE, fenceUntrusted } from '@/lib/agents/untrusted'
import type { CheckResult, IndustryCode, RegionCode, FactualDensityResult } from '@/lib/types'
import { callOpenRouter, type JsonSchemaFormat } from '@/lib/openrouter'
import { visibleText } from '@/lib/checks/visibleText'

interface Context { industry: IndustryCode; region: RegionCode }

const MAX_CLAIMS = 3
const MAX_CLAIM_LENGTH = 200

const UNIQUENESS_FORMAT: JsonSchemaFormat = {
  name: 'factual_uniqueness',
  schema: {
    type: 'object',
    properties: {
      score: { type: 'integer', description: '0-100' },
      claims: { type: 'array', items: { type: 'string' }, description: 'At most 3.' },
    },
    required: ['score', 'claims'],
    additionalProperties: false,
  },
}

export async function checkFactualDensity(
  html: string,
  _context: Context
): Promise<CheckResult & { geoDetails?: FactualDensityResult }> {
  const text = visibleText(html)
  const wordCount = text.split(/\s+/).filter(Boolean).length || 1

  const numbers = text.match(/\d+(\.\d+)?%|\$[\d,.]+|\b\d{4}\b|\b\d+\s?(million|billion|thousand|K|M|B)\b/gi) ?? []
  const numberDensity = (numbers.length / wordCount) * 100

  const namedEntities = text.match(/\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)+\b/g) ?? []
  const namedEntityDensity = (namedEntities.length / wordCount) * 100

  const dates = text.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}|\b(Q[1-4]\s+\d{4})|\b\d{4}\b/gi
  ) ?? []

  const hasComparativeData = /compared to|versus|vs\.|year-over-year|YoY|grew from|up from|down from/i.test(text)
  const hasTimeSeriesData = /\d{4}\s*[-–]\s*\d{4}|over the (past|last)\s+\d+\s*(years?|months?|quarters?)/i.test(text)

  // null when the model gave no usable score. The fallback used to be an
  // invented 50, stored and rendered as a real "Content uniqueness" bar.
  let uniquenessScore: number | null = null
  let uniqueClaims: string[] = []
  try {
    const aiResponse = await callOpenRouter({
      label: 'check.factual_density',
      model: 'anthropic/claude-haiku-4-5',
      messages: [
        { role: 'system', content: UNTRUSTED_SYSTEM_RULE },
        // The page decides what this text says, so it is fenced rather than
        // concatenated. A page asking to be rated 100 now reads as a request the
        // page made, not as an instruction from us.
        { role: 'user', content: `Rate factual uniqueness 0-100 and list up to 3 unique claims.

${fenceUntrusted('PAGE CONTENT', text.slice(0, 800))}` },
      ],
      maxTokens: 200,
      responseFormat: UNIQUENESS_FORMAT,
    })
    const parsed = JSON.parse(aiResponse.match(/\{[\s\S]+\}/)?.[0] ?? '{}')
    // The schema asks for an integer 0-100, but the reply is still model
    // output: anything else is treated as no score, never as NaN or 500.
    if (typeof parsed.score === 'number' && Number.isFinite(parsed.score)) {
      uniquenessScore = Math.round(Math.min(100, Math.max(0, parsed.score)))
      uniqueClaims = Array.isArray(parsed.claims)
        ? parsed.claims
            .filter((claim: unknown): claim is string => typeof claim === 'string')
            .map((claim: string) => claim.trim())
            .filter((claim: string) => claim.length > 0 && claim.length <= MAX_CLAIM_LENGTH)
            .slice(0, MAX_CLAIMS)
        : []
    }
  } catch { /* uniqueness stays unavailable */ }
  const providerFallback = uniquenessScore === null

  // The five deterministic signals can reach 90; uniqueness supplies the last
  // 10. Without it, the deterministic part is rescaled to 100 rather than
  // capped at 90, so a provider outage neither costs nor earns the site points.
  const deterministic =
    Math.min(30, numberDensity * 10) +
    Math.min(20, namedEntityDensity * 5) +
    Math.min(15, dates.length * 3) +
    (hasComparativeData ? 15 : 0) +
    (hasTimeSeriesData ? 10 : 0)
  const qualityScore = Math.min(100, uniquenessScore === null
    ? deterministic * 100 / 90
    : deterministic + uniquenessScore * 0.1)

  const geoDetails: FactualDensityResult = {
    qualityScore, numberDensity: Math.round(numberDensity * 10) / 10,
    namedEntityDensity: Math.round(namedEntityDensity * 10) / 10,
    dateReferences: dates.length, hasComparativeData, hasTimeSeriesData,
    uniquenessScore, uniqueClaims,
  }

  const status = qualityScore >= 40 ? 'pass' : qualityScore >= 20 ? 'warn' : 'fail'
  return { diagnostic: { collection: providerFallback ? 'partial' : 'complete', ...(providerFallback ? { reason: 'provider-fallback' as const } : {}) }, status, message: `factual_density_${status}`, details: `Quality score ${qualityScore}/100`, geoDetails }
}
