import { normalizeScanUrl } from '@/lib/scan-input'
import { normalizeVerificationDomain } from '@/lib/domain-verification/schema'
import { createPublicUrlFetcher, type PublicUrlFetch } from '@/lib/security/public-url'

export type DomainCheckInput = { url: string }
export type DomainCheckResult = {
  /** `unreachable` is a normal answer, not a failed request. */
  status: 'live' | 'unreachable'
  /** Registrable host, lower-case, `www.` stripped. */
  domain: string
  /** Page <title>, so the member can confirm the site is their brand. Null when absent. */
  pageTitle: string | null
}

/**
 * Only the public homepage is checked: no query strings, credentials, ports or
 * private page paths. Same normaliser as the brand assistant, so a host this
 * rejects cannot be reached through the check either.
 */
export function parseDomainCheckInput(raw: unknown): DomainCheckInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid request')
  const value = raw as Record<string, unknown>
  if (typeof value.url !== 'string' || !value.url.trim() || value.url.length > 2048) throw new Error('Invalid request')
  const url = new URL(normalizeScanUrl(value.url))
  if (url.port || !normalizeVerificationDomain(url.href)) throw new Error('Invalid website')
  return { url: url.origin + '/' }
}

const fetchHomepage = createPublicUrlFetcher({ maxRedirects: 3, maxResponseBytes: 131072, timeoutMs: 6000 })

const TITLE_LIMIT = 120

function pageTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]{0,400}?)<\/title>/i)
  if (!match) return null
  const title = match[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return title ? title.slice(0, TITLE_LIMIT) : null
}

/**
 * Fetches the normalised homepage and reports whether it answered. The fetch is
 * the injected PublicUrlFetch — the caller never supplies its own fetcher, and
 * the default one pins DNS and revalidates every redirect hop (see
 * lib/security/public-url.ts).
 */
export async function checkPublicHomepage(
  input: DomainCheckInput,
  ports: { fetchPage: PublicUrlFetch } = { fetchPage: fetchHomepage },
): Promise<DomainCheckResult> {
  const domain = new URL(input.url).hostname.replace(/^www\./, '')
  const response = await ports.fetchPage(input.url, {
    headers: { Accept: 'text/html', 'User-Agent': 'AISO-DomainCheck/1.0' },
  })
  if (!response.ok) return { status: 'unreachable', domain, pageTitle: null }
  if (!/^text\/html(?:;|$)/i.test(response.headers.get('content-type') ?? '')) {
    return { status: 'live', domain, pageTitle: null }
  }
  return { status: 'live', domain, pageTitle: pageTitle(await response.text()) }
}
