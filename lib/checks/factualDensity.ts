import type { CheckResult, IndustryCode, RegionCode, FactualDensityResult } from '@/lib/types'
import { callOpenRouter } from '@/lib/openrouter'

interface Context { industry: IndustryCode; region: RegionCode }

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

  let uniquenessScore = 50
  let uniqueClaims: string[] = []
  try {
    const aiResponse = await callOpenRouter({
      model: 'anthropic/claude-haiku-4-5',
      messages: [{ role: 'user', content: `Rate factual uniqueness 0-100 and list up to 3 unique claims.\nReturn JSON: {"score": number, "claims": string[]}\n\nCONTENT: ${text.slice(0, 800)}` }],
      maxTokens: 200,
    })
    const parsed = JSON.parse(aiResponse.match(/\{[\s\S]+\}/)?.[0] ?? '{}')
    uniquenessScore = parsed.score ?? 50
    uniqueClaims = parsed.claims ?? []
  } catch {}

  const qualityScore = Math.min(100,
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
    uniquenessScore, uniqueClaims,
  }

  const status = qualityScore >= 40 ? 'pass' : qualityScore >= 20 ? 'warn' : 'fail'
  return { status, message: `factual_density_${status}`, details: `Quality score ${qualityScore}/100`, geoDetails }
}
