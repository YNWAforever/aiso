import { createServerSupabaseClient } from '@/lib/supabase'
import { cacheGet, cacheSet, CACHE_TTL } from './cache'
import type { IndustryCode } from '@/lib/types'

export interface Layer5Result {
  zScore:               number
  dynamicBoost:         number
  citationFrequency90d: number
  recencyTrend:         'rising' | 'stable' | 'declining'
}

export async function scoreLayer5(
  domain:   string,
  industry: IndustryCode
): Promise<Layer5Result> {
  const cacheKey = `authority:dynamic:${domain}:${industry}`
  const cached = cacheGet<Layer5Result>(cacheKey)
  if (cached) return cached

  const zero: Layer5Result = { zScore: 0, dynamicBoost: 0, citationFrequency90d: 0, recencyTrend: 'stable' }

  try {
    const supabase = createServerSupabaseClient()
    const since = new Date(Date.now() - 90 * 86_400_000).toISOString()

    const { data: allCitations } = await supabase
      .from('ai_citation_log')
      .select('cited_domain, cited_at')
      .eq('prompt_industry', industry)
      .gte('cited_at', since)

    if (!allCitations?.length) return zero

    const domainCounts: Record<string, number> = {}
    for (const c of allCitations as { cited_domain: string; cited_at: string }[]) domainCounts[c.cited_domain] = (domainCounts[c.cited_domain] ?? 0) + 1

    const counts = Object.values(domainCounts)
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length
    const variance = counts.reduce((s, x) => s + (x - mean) ** 2, 0) / counts.length
    const std = Math.sqrt(variance)

    const domainCount = domainCounts[domain] ?? 0
    const zScore = std > 0 ? (domainCount - mean) / std : 0

    let dynamicBoost = 0
    if (zScore > 2.0)      dynamicBoost = 5.0
    else if (zScore > 1.5) dynamicBoost = 3.0
    else if (zScore > 1.0) dynamicBoost = 1.5
    else if (zScore > 0.5) dynamicBoost = 0.5

    const midpoint = new Date(Date.now() - 45 * 86_400_000).toISOString()
    type CitationRow = { cited_domain: string; cited_at: string }
    const domainAll = allCitations.filter((c: CitationRow) => c.cited_domain === domain)
    const early  = domainAll.filter((c: CitationRow) => c.cited_at <  midpoint).length
    const recent = domainAll.filter((c: CitationRow) => c.cited_at >= midpoint).length
    const recencyTrend: Layer5Result['recencyTrend'] =
      recent > early * 1.2 ? 'rising' :
      recent < early * 0.8 ? 'declining' : 'stable'

    const result: Layer5Result = { zScore, dynamicBoost, citationFrequency90d: domainCount, recencyTrend }
    cacheSet(cacheKey, result, CACHE_TTL.DYNAMIC)
    return result
  } catch {
    return zero
  }
}
