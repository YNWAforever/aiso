export const MAX_SITEMAP_URLS = 200
export const MAX_SITEMAP_URL_LENGTH = 2048

export type SitemapUrlRejection =
  | 'not_an_array'
  | 'not_a_string'
  | 'too_many'
  | 'too_long'
  | 'unparseable'
  | 'bad_protocol'

export type ParsedSitemapUrls =
  | { readonly ok: true; readonly urls: string[] }
  | { readonly ok: false; readonly reason: SitemapUrlRejection }

function validUrl(value: string): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  // Mirrors the credential check the scan route already applies to its own
  // target URL — a fetcher would strip these on redirect anyway, but they have
  // no business reaching the LLM prompt these URLs feed.
  if (url.username || url.password) return null
  return url.toString()
}

/**
 * Strict parse for the request boundary. Rejects rather than coerces, so a
 * malformed body is a 400 instead of silently-degraded scoring.
 *
 * Over-length is a rejection, not a truncation. The scan route truncates the
 * sitemap *it* fetches, because a real sitemap legitimately runs past 200
 * entries and taking the first 200 is the sane read. A caller handing us ten
 * thousand URLs is a different thing — that is a signal, and quietly slicing it
 * to 200 hides the signal on a route reachable before authentication.
 */
export function parseSitemapUrls(input: unknown): ParsedSitemapUrls {
  if (input === undefined || input === null) return { ok: true, urls: [] }
  if (!Array.isArray(input)) return { ok: false, reason: 'not_an_array' }
  if (input.length > MAX_SITEMAP_URLS) return { ok: false, reason: 'too_many' }

  const urls: string[] = []
  for (const entry of input) {
    if (typeof entry !== 'string') return { ok: false, reason: 'not_a_string' }
    if (entry.length > MAX_SITEMAP_URL_LENGTH) return { ok: false, reason: 'too_long' }
    const normalized = validUrl(entry.trim())
    if (normalized === null) {
      return {
        ok: false,
        reason: /^\s*[a-z][a-z0-9+.-]*:/i.test(entry) ? 'bad_protocol' : 'unparseable',
      }
    }
    urls.push(normalized)
  }
  return { ok: true, urls }
}

/**
 * Lenient, non-throwing counterpart for use inside a check.
 *
 * Checks are `lib/` modules with no contract that their caller validated
 * anything, and CLAUDE.md requires they degrade rather than throw. Anything
 * unusable becomes an empty list, which every caller already handles as
 * "no sitemap".
 */
export function normalizeSitemapUrls(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const urls: string[] = []
  for (const entry of input.slice(0, MAX_SITEMAP_URLS)) {
    if (typeof entry !== 'string' || entry.length > MAX_SITEMAP_URL_LENGTH) continue
    const normalized = validUrl(entry.trim())
    if (normalized !== null) urls.push(normalized)
  }
  return urls
}
