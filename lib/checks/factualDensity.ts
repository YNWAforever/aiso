import { UNTRUSTED_SYSTEM_RULE, fenceUntrusted } from '@/lib/agents/untrusted'
import type { CheckResult, IndustryCode, RegionCode, FactualDensityResult } from '@/lib/types'
import { callOpenRouter, type JsonSchemaFormat } from '@/lib/openrouter'

interface Context { industry: IndustryCode; region: RegionCode }

const UNIQUENESS_FORMAT: JsonSchemaFormat = {
  name: 'factual_uniqueness',
  schema: {
    type: 'object',
    properties: {
      score: { type: 'integer', minimum: 0, maximum: 100 },
      claims: { type: 'array', maxItems: 3, items: { type: 'string', minLength: 1, maxLength: 500 } },
    },
    required: ['score', 'claims'],
    additionalProperties: false,
  },
}

/** Provider output is untrusted. A missing observation is never a neutral score. */
export function parseFactualUniqueness(value: unknown): { score: number; claims: string[] } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const { score, claims } = value as Record<string, unknown>
  if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > 100) return null
  if (!Array.isArray(claims) || claims.length > 3 || claims.some(claim =>
    typeof claim !== 'string' || !claim.trim() || claim.length > 500)) return null
  return { score, claims: claims.map(claim => (claim as string).trim()) }
}

export async function checkFactualDensity(
  html: string,
  _context: Context
): Promise<CheckResult & { geoDetails?: FactualDensityResult }> {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
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
    const parsed = parseFactualUniqueness(JSON.parse(aiResponse))
    if (parsed) { uniquenessScore = parsed.score; uniqueClaims = parsed.claims }
  } catch { /* Deterministic page counts survive unavailable provider evidence. */ }

  const qualityScore = uniquenessScore === null ? null : Math.min(100,
    Math.min(30, numberDensity * 10) +
    Math.min(20, namedEntityDensity * 5) +
    Math.min(15, dates.length * 3) +
    (hasComparativeData ? 15 : 0) +
    (hasTimeSeriesData ? 10 : 0) +
    uniquenessScore * 0.1
  )

  const geoDetails: FactualDensityResult = {
    qualityScore, numberDensity: Math.round(numberDensity * 10) / 10,
    namedEntityDensity: Math.round(namedEntityDensity * 10) / 10,
    dateReferences: dates.length, hasComparativeData, hasTimeSeriesData,
    uniquenessScore, uniquenessStatus: uniquenessScore === null ? 'unavailable' : 'observed', uniqueClaims,
  }

  if (qualityScore === null) return {
    diagnostic: { collection: 'partial', reason: 'provider-fallback' },
    // Compatibility sentinel: headline weights receive no credit. Evidence
    // projections render this as unavailable, never a content failure.
    status: 'fail', message: 'factual_density_unavailable', details: 'Provider assessment unavailable', geoDetails,
  }
  const status = qualityScore >= 40 ? 'pass' : qualityScore >= 20 ? 'warn' : 'fail'
  return { diagnostic: { collection: 'complete' }, status, message: `factual_density_${status}`, details: `Quality score ${qualityScore}/100`, geoDetails }
}
