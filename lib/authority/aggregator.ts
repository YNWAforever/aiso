import type { IndustryCode, RegionCode, AuthorityBreakdown, AuthorityTier } from '@/lib/types'
import { scoreLayer1 } from './layer1-tld'
import { scoreLayer2 } from './layer2-signals'
import { scoreLayer3 } from './layer3-industry'
import { scoreLayer4 } from './layer4-regional'
import { cacheGet, cacheSet, CACHE_TTL } from './cache'

export async function computeAuthority(
  domain:       string,
  industry:     IndustryCode,
  region:       RegionCode,
  dynamicBoost: number | null = null
): Promise<AuthorityBreakdown> {
  const cacheKey = `authority:${domain}:${industry}:${region}`
  const cached = cacheGet<AuthorityBreakdown>(cacheKey)
  if (cached) return cached

  const [l2, l3, l4] = await Promise.all([
    scoreLayer2(domain),
    Promise.resolve(scoreLayer3(domain, industry)),
    Promise.resolve(scoreLayer4(domain, region)),
  ])
  const l1 = scoreLayer1(domain)

  const hasDynamic = dynamicBoost !== null && dynamicBoost !== undefined
  const w = hasDynamic
    ? { l1: 0.15, l2: 0.30, l3: 0.25, l4: 0.15, l5: 0.15 }
    : { l1: 0.20, l2: 0.35, l3: 0.30, l4: 0.15, l5: 0.00 }

  const raw =
    l1.baseScore * w.l1 +
    l2.signalScore * w.l2 +
    l3.adjustedScore * w.l3 +
    l4.score * w.l4 +
    (hasDynamic ? dynamicBoost! * w.l5 : 0)

  const finalScore = Math.min(10, raw)
  const tier: AuthorityTier =
    finalScore >= 8 ? 'tier1' :
    finalScore >= 6 ? 'tier2' :
    finalScore >= 3 ? 'tier3' : 'other'

  const result: AuthorityBreakdown = {
    layer1_tld:      { baseScore: l1.baseScore, category: l1.category },
    layer2_signals:  { signalScore: l2.signalScore, signals: l2.signals as Record<string, unknown> },
    layer3_industry: { score: l3.score, tier: l3.tier, multiplier: l3.multiplier },
    layer4_regional: { score: l4.score, tier: l4.tier },
    layer5_dynamic:  hasDynamic
      ? { zScore: 0, dynamicBoost: dynamicBoost!, citationFrequency90d: 0 }
      : null,
    finalScore,
    tier,
  }

  cacheSet(cacheKey, result, CACHE_TTL.AUTHORITY)
  return result
}

export async function getTier(
  domain:   string,
  industry: IndustryCode,
  region:   RegionCode
): Promise<AuthorityTier> {
  const r = await computeAuthority(domain, industry, region)
  return r.tier
}
