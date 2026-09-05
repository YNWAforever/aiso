import type { CheckResult, IndustryCode, RegionCode, CitationDensityResult, AuthorityTier } from '@/lib/types'
import { computeAuthority } from '@/lib/authority/aggregator'

interface Context { industry: IndustryCode; region: RegionCode; clientId?: string }

export async function checkCitationDensity(
  html: string,
  baseUrl: string,
  context: Context
): Promise<CheckResult & { geoDetails?: CitationDensityResult }> {
  const base = new URL(baseUrl)
  const linkPattern = /<a\s[^>]*href=["']([^"']+)["'][^>]*>/gi
  const externalLinks: string[] = []
  let m: RegExpExecArray | null

  while ((m = linkPattern.exec(html)) !== null) {
    try {
      const href = new URL(m[1], baseUrl)
      if (href.hostname !== base.hostname) externalLinks.push(href.href)
    } catch {}
  }

  const words = html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length
  const citationsPerK = words > 0 ? (externalLinks.length / words) * 1000 : 0

  const textContent = html.replace(/<[^>]+>/g, ' ')
  const statsMatches = textContent.match(/\d+(\.\d+)?%|\$[\d,]+|\d+\s?(million|billion|thousand)/gi) ?? []
  const sourcePattern = /source:|according to|cites?|reference:|study by/i
  const statsWithSource = statsMatches.filter(s => {
    const idx = textContent.indexOf(s)
    const nearby = textContent.slice(Math.max(0, idx - 200), idx + 200)
    return sourcePattern.test(nearby)
  }).length

  // Score up to 20 external domains by authority
  const domainsToScore = [...new Set(
    externalLinks.slice(0, 20).map(u => { try { return new URL(u).hostname } catch { return null } }).filter(Boolean) as string[]
  )]

  const authorityResults = await Promise.allSettled(
    domainsToScore.map(d => computeAuthority(d, context.industry, context.region))
  )

  const tierCounts: Record<string, number> = { tier1: 0, tier2: 0, tier3: 0, other: 0 }
  const linkDetails: CitationDensityResult['details'] = []

  authorityResults.forEach((res, i) => {
    if (res.status === 'fulfilled') {
      const { tier, finalScore } = res.value
      tierCounts[tier] = (tierCounts[tier] ?? 0) + 1
      linkDetails.push({ url: externalLinks[i] ?? '', domain: domainsToScore[i] ?? '', tier: tier as AuthorityTier, authorityScore: finalScore })
    }
  })

  const qualityScore = Math.min(100,
    (tierCounts.tier1 ?? 0) * 15 +
    (tierCounts.tier2 ?? 0) * 8 +
    (tierCounts.tier3 ?? 0) * 3 +
    Math.min(20, statsWithSource * 5) +
    Math.min(10, citationsPerK * 5)
  )

  const geoDetails: CitationDensityResult = {
    qualityScore,
    totalLinks: externalLinks.length,
    externalLinks: externalLinks.length,
    authorityBreakdown: { tier1: tierCounts.tier1 ?? 0, tier2: tierCounts.tier2 ?? 0, tier3: tierCounts.tier3 ?? 0, other: tierCounts.other ?? 0 },
    citationsPerThousandWords: Math.round(citationsPerK * 10) / 10,
    hasStatistics: statsMatches.length > 0,
    statisticsWithSource: statsWithSource,
    details: linkDetails,
  }

  const status = qualityScore >= 30 ? 'pass' : qualityScore >= 15 ? 'warn' : 'fail'

  return { diagnostic: { collection: domainsToScore.length ? 'partial' : 'complete', ...(domainsToScore.length ? { reason: authorityResults.some(r => r.status === 'rejected') ? 'provider-fallback' as const : 'inferred-only' as const } : {}) }, status, message: `citation_density_${status}`, details: `Quality score ${qualityScore}/100`, geoDetails }
}
