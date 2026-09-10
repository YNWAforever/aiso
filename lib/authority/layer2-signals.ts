// The three probes against `clean` — a hostname derived from a caller-supplied
// domain — must cross the SSRF boundary: a bare fetch has no DNS pinning, and
// the last one asked for redirect:'follow', so a 302 to 169.254.169.254 landed
// unvalidated. The Wikipedia and Tranco calls target constant API hosts and
// carry the domain only in the path, so they stay on the global fetch.
import { createPublicUrlFetcher, fetchPublicUrl } from '@/lib/security/public-url'

// Rejects a redirect that downgrades to http, so reaching a response is itself
// the httpsEnforced signal. See the call site for why res.url cannot serve.
const httpsOnlyFetch = createPublicUrlFetcher({ allowedProtocols: ['https:'] })

const WIKIPEDIA_API = 'https://en.wikipedia.org/api/rest_v1'
const TRANCO_API = 'https://tranco-list.eu/api/ranks/domain'
// `?.trim() ||`, not `??`: nullish coalescing keeps '', which a deploy
// environment supplies for a declared-but-valueless variable. Wikipedia's API
// policy requires an identifying User-Agent and rate-limits or blocks requests
// without one, so an empty string would degrade this check silently rather than
// falling back as intended. Same reasoning as lib/app-origin.ts.
const UA = process.env.WIKIPEDIA_USER_AGENT?.trim() || 'FimmickAISO/1.0 (https://fimmick.com)'

export interface SignalResult {
  signalScore: number
  signals: {
    wikipediaPresence:     boolean
    wikipediaPageViews30d: number | null
    wikidataQid:           string | null
    trancoRank:            number | null
    domainAgeYears:        number | null
    httpsEnforced:         boolean
    hasAboutPage:          boolean
    hasEditorialPolicy:    boolean
    hasAuthorBylines:      boolean
    fetchedAt:             string
  }
}

export async function scoreLayer2(domain: string): Promise<SignalResult> {
  let score = 0
  const signals: SignalResult['signals'] = {
    wikipediaPresence: false, wikipediaPageViews30d: null,
    wikidataQid: null, trancoRank: null, domainAgeYears: null,
    httpsEnforced: false, hasAboutPage: false,
    hasEditorialPolicy: false, hasAuthorBylines: false,
    fetchedAt: new Date().toISOString(),
  }

  const clean = domain.replace(/^www\./, '')

  // Wikipedia presence (2.0 pts)
  try {
    const res = await fetch(
      `${WIKIPEDIA_API}/page/summary/${encodeURIComponent(clean)}`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(5000) }
    )
    if (res.ok) { signals.wikipediaPresence = true; score += 2.0 }
  } catch {}

  // Tranco rank: <1K=2.5, <10K=2.0, <100K=1.0, <1M=0.5
  try {
    const res = await fetch(`${TRANCO_API}/${clean}`, { signal: AbortSignal.timeout(5000) })
    if (res.ok) {
      const data = await res.json() as { ranks?: Array<{ rank: number }> }
      const rank = data.ranks?.[0]?.rank ?? null
      signals.trancoRank = rank
      if (rank !== null) {
        if (rank < 1_000)         score += 2.5
        else if (rank < 10_000)   score += 2.0
        else if (rank < 100_000)  score += 1.0
        else if (rank < 1_000_000) score += 0.5
      }
    }
  } catch {}

  // About page (0.25 pts)
  try {
    const res = await fetchPublicUrl(`https://${clean}/about`, { signal: AbortSignal.timeout(4000) })
    if (res.ok) { signals.hasAboutPage = true; score += 0.25 }
  } catch {}

  // Editorial policy (1.0 pt)
  try {
    const res = await fetchPublicUrl(`https://${clean}/editorial-policy`, { signal: AbortSignal.timeout(4000) })
    if (res.ok) { signals.hasEditorialPolicy = true; score += 1.0 }
  } catch {}

  // HTTPS + author bylines (0.5 + 0.5 pts)
  try {
    // This used to read res.url to see whether the redirect chain ended on
    // https. The guarded fetcher resolves redirects itself and deliberately does
    // not expose a final URL — its evidence contract is origin-only redaction —
    // so res.url is '' and that test would silently be false forever. Restricting
    // the allowed protocol proves the same thing more directly: a downgrade to
    // http is rejected as an unsafe URL, so a response at all means the whole
    // chain stayed on https.
    const res = await httpsOnlyFetch(`https://${clean}`, { signal: AbortSignal.timeout(6000) })
    signals.httpsEnforced = true
    score += 0.5
    const html = await res.text()
    if (/itemprop="author"|rel="author"|class="byline"|data-author/.test(html)) {
      signals.hasAuthorBylines = true; score += 0.5
    }
  } catch {}

  return { signalScore: Math.min(10, score), signals }
}
