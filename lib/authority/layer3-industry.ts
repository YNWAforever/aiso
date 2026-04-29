import { INDUSTRY_PACKS } from './packs'
import type { IndustryCode, AuthorityTier } from '@/lib/types'

export interface Layer3Result {
  score:         number
  tier:          AuthorityTier
  multiplier:    number
  adjustedScore: number
}

export function scoreLayer3(domain: string, industry: IndustryCode): Layer3Result {
  const pack = INDUSTRY_PACKS[industry]
  const d = domain.toLowerCase().replace(/^www\./, '')
  let score = 0
  let tier: AuthorityTier = 'other'

  if (pack.authorityDomains.tier1.some(ad => d === ad || d.endsWith('.' + ad))) {
    score = 10; tier = 'tier1'
  } else if (pack.authorityDomains.tier2.some(ad => d === ad || d.endsWith('.' + ad))) {
    score = 7; tier = 'tier2'
  } else if (pack.authorityDomains.tier3.some(ad => d === ad || d.endsWith('.' + ad))) {
    score = 5; tier = 'tier3'
  }

  return {
    score,
    tier,
    multiplier: pack.multiplier,
    adjustedScore: Math.min(10, score * pack.multiplier),
  }
}
