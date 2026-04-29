import type { CheckResult, IndustryCode, TopicalAuthorityResult } from '@/lib/types'
import { callOpenRouter } from '@/lib/openrouter'
import { INDUSTRY_PACKS } from '@/lib/authority/packs'

export async function checkTopicalAuthority(
  sitemapUrls: string[],
  _clientId: string,
  industry: IndustryCode
): Promise<CheckResult & { geoDetails?: TopicalAuthorityResult }> {
  if (!sitemapUrls.length) {
    return {
      status: 'warn', message: 'topical_authority_no_sitemap',
      geoDetails: { topicalCoverageScore: 0, detectedClusters: [], totalClusters: 0, hasOrphanPages: 0 },
    }
  }

  const slugGroups: Record<string, string[]> = {}
  for (const url of sitemapUrls) {
    try {
      const parts = new URL(url).pathname.split('/').filter(Boolean)
      if (parts.length >= 2) {
        const prefix = parts[0]
        slugGroups[prefix] = [...(slugGroups[prefix] ?? []), url]
      }
    } catch {}
  }

  const industryKeywords = INDUSTRY_PACKS[industry]?.topicalKeywords?.slice(0, 10) ?? []
  let detectedClusters: TopicalAuthorityResult['detectedClusters'] = []

  try {
    const prompt = `Given these URL groups and industry keywords, identify up to 5 topical clusters.
Industry: ${industry}, Keywords: ${industryKeywords.join(', ')}
URL groups: ${JSON.stringify(slugGroups).slice(0, 1500)}

Return JSON array: [{"topic":"string","pillarPageUrl":"string or null","pillarPageWordCount":800,"clusterArticles":[{"url":"string","title":"string","wordCount":800}],"interlinkCount":5,"completenessScore":70}]`

    const res = await callOpenRouter({
      model: 'anthropic/claude-haiku-4-5',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 600,
    })
    detectedClusters = JSON.parse(res.match(/\[[\s\S]+\]/)?.[0] ?? '[]')
  } catch {}

  const orphanPages = sitemapUrls.filter(u => { try { return new URL(u).pathname.split('/').filter(Boolean).length === 1 } catch { return false } }).length
  const topicalCoverageScore = Math.min(100, detectedClusters.length * 15 + Math.max(0, 20 - orphanPages * 2))
  const status = topicalCoverageScore >= 60 ? 'pass' : topicalCoverageScore >= 30 ? 'warn' : 'fail'

  return {
    status, message: `topical_authority_${status}`,
    details: `${detectedClusters.length} clusters detected`,
    geoDetails: { topicalCoverageScore, detectedClusters, totalClusters: detectedClusters.length, hasOrphanPages: orphanPages },
  }
}
