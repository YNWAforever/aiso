/**
 * May this GA4 web stream be bound to this brand? Pure.
 *
 * A property can hold several streams, so the choice is per stream, and a brand
 * must never show another site's conversions under its name. A stream is
 * eligible only when its default URI is a plain http(s) origin (no explicit
 * port, no IP literal) whose host is the brand's own: the brand domain or its
 * `www.` form. Unlike Search Console's Domain property there is no
 * subdomain coverage — a stream for `shop.example.com` reports on the shop, and
 * presenting it as the brand's performance would overstate it.
 *
 * The raw host (`www` kept) is what gets stored, so `streamStillMatches` can
 * re-run the same comparison when the brand domain later changes.
 */

import { normalizeBrandDomain, normalizeHost } from '@/lib/integrations/search-console/binding'

export type WebStream = { streamId: string; displayName: string; defaultUri: string }
export type StreamReason = 'no_domain' | 'other_domain' | 'invalid_uri'
export type StreamVerdict = { eligible: true; host: string } | { eligible: false; reason: StreamReason }

function matchesBrand(host: string, brand: string): boolean {
  return host === brand || host === `www.${brand}`
}

export function streamEligibility(
  defaultUri: string,
  brandDomain: string | null | undefined,
): StreamVerdict {
  const brand = normalizeBrandDomain(brandDomain)
  if (!brand) return { eligible: false, reason: 'no_domain' }

  let url: URL
  try {
    url = new URL(defaultUri)
  } catch {
    return { eligible: false, reason: 'invalid_uri' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { eligible: false, reason: 'invalid_uri' }
  if (url.port !== '') return { eligible: false, reason: 'invalid_uri' }
  // normalizeHost rejects IP literals (v4 and v6) and anything that is not a dotted host.
  const host = normalizeHost(url.hostname)
  if (!host) return { eligible: false, reason: 'invalid_uri' }

  return matchesBrand(host, brand) ? { eligible: true, host } : { eligible: false, reason: 'other_domain' }
}

/**
 * Does a stored stream host still describe the brand's current domain? The
 * stored value must be a bare host: anything `normalizeHost` would rewrite
 * (a scheme, port or path) was never something `streamEligibility` stored.
 */
export function streamStillMatches(storedHost: string, brandDomain: string | null | undefined): boolean {
  const brand = normalizeBrandDomain(brandDomain)
  if (!brand) return false
  const raw = storedHost.trim().toLowerCase()
  const host = normalizeHost(raw)
  if (!host || host !== raw) return false
  return matchesBrand(host, brand)
}
