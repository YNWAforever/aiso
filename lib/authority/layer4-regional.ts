import { REGIONAL_PACKS } from './packs'
import type { RegionCode, AuthorityTier } from '@/lib/types'

export interface Layer4Result { score: number; tier: AuthorityTier }

export function scoreLayer4(domain: string, region: RegionCode): Layer4Result {
  const pack = REGIONAL_PACKS[region]
  const d = domain.toLowerCase().replace(/^www\./, '')

  if (pack.tier1Local.some(ad => d === ad || d.endsWith('.' + ad))) return { score: 10, tier: 'tier1' }
  if (pack.tier2Local.some(ad => d === ad || d.endsWith('.' + ad))) return { score: 7,  tier: 'tier2' }
  if (pack.tier3Local.some(ad => d === ad || d.endsWith('.' + ad))) return { score: 5,  tier: 'tier3' }
  if (pack.community.some(ad => d === ad || d.endsWith('.' + ad))) return { score: 3,  tier: 'other' }
  return { score: 0, tier: 'other' }
}
