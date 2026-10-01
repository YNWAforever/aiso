/**
 * May this Search Console property be bound to this brand? (spec §4.2) Pure.
 *
 * A brand must never show another site's search data under its name, so the
 * property must cover the brand's own domain and the login must hold verified
 * access. A URL-prefix property scoped to a path, or pinned to an explicit
 * non-default port, reports on part of the site only, and presenting it as
 * the brand's performance would overstate it. `www` equivalence holds only
 * between two single hosts — a Domain property for `www.example.com` has
 * data for `www.example.com` and its subdomains only, never the apex or a
 * sibling like `shop.example.com`.
 */

export type BindingReason = 'no_domain' | 'other_domain' | 'unverified'
export type BindingVerdict = { eligible: true } | { eligible: false; reason: BindingReason }

const VERIFIED_LEVELS = new Set(['siteOwner', 'siteFullUser', 'siteRestrictedUser'])
const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/
const ALL_DIGITS = /^[0-9]+$/

/** Parses and validates a bare host, with no `www` normalization. Rejects IP literals. */
function normalizeHost(value: string | null | undefined): string | null {
  if (!value) return null
  let v = value.trim().toLowerCase()
  if (!v) return null
  if (!/^[a-z]+:\/\//.test(v)) v = `https://${v}`
  let host: string
  try {
    host = new URL(v).hostname
  } catch {
    return null
  }
  if (!HOST.test(host)) return null
  const lastLabel = host.slice(host.lastIndexOf('.') + 1)
  if (ALL_DIGITS.test(lastLabel)) return null
  return host
}

export function normalizeBrandDomain(domain: string | null | undefined): string | null {
  const host = normalizeHost(domain)
  return host ? host.replace(/^www\./, '') : null
}

function coverage(siteUrl: string): { host: string; subdomains: boolean } | null {
  if (siteUrl.startsWith('sc-domain:')) {
    // Domain property: exact host as verified, no `www` equivalence — see header comment.
    const host = normalizeHost(siteUrl.slice('sc-domain:'.length))
    return host ? { host, subdomains: true } : null
  }
  let url: URL
  try {
    url = new URL(siteUrl)
  } catch {
    return null
  }
  if (url.pathname !== '/' || url.search || url.hash || url.port !== '') return null
  // URL-prefix property: a single host, so `www` equivalence is correct here.
  const host = normalizeBrandDomain(url.hostname)
  return host ? { host, subdomains: false } : null
}

export function propertyEligibility(
  siteUrl: string,
  permissionLevel: string,
  brandDomain: string | null | undefined,
): BindingVerdict {
  const brand = normalizeBrandDomain(brandDomain)
  const rawBrand = normalizeHost(brandDomain)
  if (!brand || !rawBrand) return { eligible: false, reason: 'no_domain' }

  const covered = coverage(siteUrl)
  const covers = covered !== null
    && (covered.subdomains
      ? rawBrand === covered.host || rawBrand.endsWith(`.${covered.host}`)
      : brand === covered.host)
  if (!covers) return { eligible: false, reason: 'other_domain' }

  if (!VERIFIED_LEVELS.has(permissionLevel)) return { eligible: false, reason: 'unverified' }
  return { eligible: true }
}

/**
 * Does an existing binding still describe the brand's current domain? Used by
 * the sync (to skip as `domain_mismatch`) and by the owner's state (`rebind`).
 *
 * Two checks, both required. `bound_domain` equality is spec §4.2's rule: a
 * brand whose domain changed stops syncing even if the old property happens to
 * cover the new host. But `bound_domain` is www-stripped, so equality alone
 * calls `www.example.com` and `example.com` the same brand — while a Domain
 * property for `sc-domain:www.example.com` does not cover the apex. So the
 * property's eligibility is re-run against the current domain as well, exactly
 * as the bind route ran it.
 */
export function bindingMatchesDomain(
  binding: { siteUrl: string; permissionLevel: string; boundDomain: string },
  currentDomain: string | null | undefined,
): boolean {
  return normalizeBrandDomain(currentDomain) === normalizeBrandDomain(binding.boundDomain)
    && propertyEligibility(binding.siteUrl, binding.permissionLevel, currentDomain).eligible
}
