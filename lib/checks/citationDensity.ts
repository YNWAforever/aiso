import type { CheckResult, IndustryCode, RegionCode, CitationDensityResult, AuthorityTier } from '@/lib/types'
import { computeAuthority } from '@/lib/authority/aggregator'

interface Context { industry: IndustryCode; region: RegionCode; clientId?: string }

function normalizeExternalUrl(rawUrl: string, baseUrl: string) {
  const url = new URL(rawUrl, baseUrl)
  url.hash = ''
  return url.href
}

export async function checkCitationDensity(
  html: string,
  baseUrl: string,
  context: Context
): Promise<CheckResult & { geoDetails?: CitationDensityResult }> {
  const base = new URL(baseUrl)
  const linkPattern = /<a\s[^>]*href=["']([^"']+)["'][^>]*>/gi
  const externalLinks = new Set<string>()
  let m: RegExpExecArray | null

  while ((m = linkPattern.exec(html)) !== null) {
    try {
      const href = new URL(m[1], baseUrl)
      if (href.hostname !== base.hostname) externalLinks.add(normalizeExternalUrl(m[1], baseUrl))
    } catch {}
  }

  const words = html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length
  const canonicalExternalLinks = [...externalLinks]
  const citationsPerK = words > 0 ? (canonicalExternalLinks.length / words) * 1000 : 0

  const textContent = html.replace(/<[^>]+>/g, ' ')
  const statsMatches = textContent.match(/\d+(\.\d+)?%|\$[\d,]+|\d+\s?(million|billion|thousand)/gi) ?? []
  const sourcePattern = /source:|according to|cites?|reference:|study by/i
  const statsWithSource = statsMatches.filter(s => {
    const idx = textContent.indexOf(s)
    const nearby = textContent.slice(Math.max(0, idx - 200), idx + 200)
    return sourcePattern.test(nearby)
  }).length

  // Score up to 20 external domains by authority
  const canonicalLinksToScore = canonicalExternalLinks.slice(0, 20)
  const domainsToScore = [...new Set(
    canonicalLinksToScore.map(u => { try { return new URL(u).hostname } catch { return null } }).filter(Boolean) as string[]
  )]

  const authorityResults = await Promise.allSettled(
    domainsToScore.map(d => computeAuthority(d, context.industry, context.region))
  )

  const tierCounts: Record<string, number> = { tier1: 0, tier2: 0, tier3: 0, other: 0 }
  const linkDetails: CitationDensityResult['details'] = []

  authorityResults.forEach((res, i) => {
    if (res.status === 'fulfilled') {
      const tier = res.value.tier === 'tier1' || res.value.tier === 'tier2' || res.value.tier === 'tier3'
        ? res.value.tier
        : 'other'
      const finalScore = Number.isFinite(res.value.finalScore) ? res.value.finalScore : 0
      tierCounts[tier] = (tierCounts[tier] ?? 0) + 1
      linkDetails.push({ url: canonicalLinksToScore[i] ?? '', domain: domainsToScore[i] ?? '', tier: tier as AuthorityTier, authorityScore: finalScore })
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
    totalLinks: canonicalExternalLinks.length,
    externalLinks: canonicalExternalLinks.length,
    authorityBreakdown: { tier1: tierCounts.tier1 ?? 0, tier2: tierCounts.tier2 ?? 0, tier3: tierCounts.tier3 ?? 0, other: tierCounts.other ?? 0 },
    citationsPerThousandWords: Math.round(citationsPerK * 10) / 10,
    hasStatistics: statsMatches.length > 0,
    statisticsWithSource: statsWithSource,
    details: linkDetails,
  }

  const status = qualityScore >= 30 ? 'pass' : qualityScore >= 15 ? 'warn' : 'fail'

  return { status, message: `citation_density_${status}`, details: `Quality score ${qualityScore}/100`, geoDetails }
}
