export type TldCategory =
  | 'government' | 'military' | 'academic'
  | 'intergovernmental' | 'organization'
  | 'commercial' | 'country_code' | 'other'

interface TldRule { score: number; category: TldCategory }

const TLD_RULES: Record<string, TldRule> = {
  // High-trust
  gov:  { score: 10, category: 'government' },
  mil:  { score: 10, category: 'military' },
  edu:  { score: 9,  category: 'academic' },
  ac:   { score: 9,  category: 'academic' },
  int:  { score: 9,  category: 'intergovernmental' },
  org:  { score: 6,  category: 'organization' },
  // Country TLDs
  uk:   { score: 5,  category: 'country_code' },
  de:   { score: 5,  category: 'country_code' },
  fr:   { score: 5,  category: 'country_code' },
  jp:   { score: 5,  category: 'country_code' },
  au:   { score: 5,  category: 'country_code' },
  ca:   { score: 5,  category: 'country_code' },
  sg:   { score: 5,  category: 'country_code' },
  hk:   { score: 5,  category: 'country_code' },
  tw:   { score: 5,  category: 'country_code' },
  kr:   { score: 5,  category: 'country_code' },
  eu:   { score: 5,  category: 'country_code' },
  // Commercial
  com:  { score: 3,  category: 'commercial' },
  net:  { score: 3,  category: 'commercial' },
  io:   { score: 3,  category: 'commercial' },
  co:   { score: 3,  category: 'commercial' },
  biz:  { score: 2,  category: 'commercial' },
  info: { score: 2,  category: 'commercial' },
}

export function scoreLayer1(domain: string): { baseScore: number; category: TldCategory; tld: string } {
  const parts = domain.replace(/^www\./, '').split('.')
  const twoLevel = parts.slice(-2).join('.')
  const tld = parts[parts.length - 1] ?? ''

  // Second-level patterns like gov.hk, edu.sg, ac.uk
  if (/^(gov|edu|ac)\..+/.test(twoLevel)) {
    return { baseScore: 9, category: 'government', tld }
  }

  const rule = TLD_RULES[tld] ?? { score: 2, category: 'other' as TldCategory }
  return { baseScore: rule.score, category: rule.category, tld }
}
