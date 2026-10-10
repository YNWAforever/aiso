import { isWithin, registrableDomain } from '@/lib/citations/normalize'

/**
 * What kind of source a cited site is (GEO parity Step 4). Own implementation:
 * the categories match Ansvisor's published set, but no code or list was copied
 * (owner gate G1 defaulted to "own implementation").
 *
 * Order matters: the brand's own and its competitors' domains win over the
 * generic lists, so a brand that is itself a news site is still "owned".
 */
export type CitationKind = 'owned' | 'competitor' | 'forum' | 'social' | 'review' | 'institutional' | 'editorial' | 'other'
export type ClassifyContext = { ownedDomains: string[]; competitors: { name: string; domains: string[] }[] }

// Matched on the registrable domain's first label, so country variants
// (tripadvisor.com.hk, yelp.co.uk) fall in without listing each one. Short or
// ambiguous names are matched on the full domain instead, below.
const BY_LABEL: Record<'forum' | 'social' | 'review' | 'editorial', Set<string>> = {
  forum: new Set(['reddit', 'quora', 'stackoverflow', 'stackexchange', 'lihkg', 'baby-kingdom', 'uwants', 'hkgolden', 'dcard', 'zhihu', 'v2ex', 'ptt']),
  social: new Set(['facebook', 'instagram', 'twitter', 'linkedin', 'youtube', 'tiktok', 'threads', 'pinterest', 'xiaohongshu', 'weibo', 'douyin', 'bilibili']),
  review: new Set(['tripadvisor', 'yelp', 'trustpilot', 'openrice', 'g2', 'capterra', 'glassdoor', 'productreview']),
  editorial: new Set(['wikipedia', 'scmp', 'hk01', 'mingpao', 'rthk', 'thestandard', 'hket', 'hongkongfp', 'bbc', 'reuters', 'bloomberg',
    'nytimes', 'wsj', 'cnn', 'theguardian', 'forbes', 'techcrunch', 'economist', 'cnbc', 'apnews', 'ft', 'nikkei', 'channelnewsasia']),
}
const BY_DOMAIN: Record<string, CitationKind> = {
  'x.com': 'social', 'youtu.be': 'social', 'discuss.com.hk': 'forum', 'on.cc': 'editorial', 'news.google.com': 'editorial',
}
const INSTITUTIONAL_SUFFIX = /\.(gov|edu|mil|int)(\.[a-z]{2})?$|\.(gov|edu|ac|go)\.[a-z]{2}$/
const INSTITUTIONAL_DOMAINS = new Set(['un.org', 'who.int', 'worldbank.org', 'oecd.org', 'imf.org'])
const FORUM_HOST = /^(forum|forums|community|discuss|bbs)\./

export function classifyDomain(host: string, context: ClassifyContext): { kind: CitationKind; competitor?: string } {
  const h = host.toLowerCase()
  if (context.ownedDomains.some(d => d && isWithin(h, d))) return { kind: 'owned' }
  const competitor = context.competitors.find(c => c.domains.some(d => d && isWithin(h, d)))
  if (competitor) return { kind: 'competitor', competitor: competitor.name }

  const domain = registrableDomain(h)
  const byDomain = Object.entries(BY_DOMAIN).find(([d]) => isWithin(h, d))
  if (byDomain) return { kind: byDomain[1] }
  if (INSTITUTIONAL_SUFFIX.test(domain) || INSTITUTIONAL_DOMAINS.has(domain)) return { kind: 'institutional' }
  const label = domain.split('.')[0]
  for (const [kind, labels] of Object.entries(BY_LABEL) as [CitationKind, Set<string>][]) {
    if (labels.has(label)) return { kind }
  }
  if (FORUM_HOST.test(h.replace(/^www\./, ''))) return { kind: 'forum' }
  return { kind: 'other' }
}
