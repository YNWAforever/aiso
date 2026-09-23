/**
 * May this Search Console property be bound to this brand? (spec §4.2) Pure.
 *
 * A brand must never show another site's search data under its name, so the
 * property must cover the brand's own domain and the login must hold verified
 * access. A URL-prefix property scoped to a path reports on part of the site
 * only, and presenting it as the brand's performance would overstate it.
 */

export type BindingReason = 'no_domain' | 'other_domain' | 'unverified'
export type BindingVerdict = { eligible: true } | { eligible: false; reason: BindingReason }

const VERIFIED_LEVELS = new Set(['siteOwner', 'siteFullUser', 'siteRestrictedUser'])
const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/

export function normalizeBrandDomain(domain: string | null | undefined): string | null {
  if (!domain) return null
  let value = domain.trim().toLowerCase()
  if (!value) return null
  if (!/^[a-z]+:\/\//.test(value)) value = `https://${value}`
  let host: string
  try {
    host = new URL(value).hostname
  } catch {
    return null
  }
  host = host.replace(/^www\./, '')
  return HOST.test(host) ? host : null
}

function coverage(siteUrl: string): { host: string; subdomains: boolean } | null {
  if (siteUrl.startsWith('sc-domain:')) {
    const host = normalizeBrandDomain(siteUrl.slice('sc-domain:'.length))
    return host ? { host, subdomains: true } : null
  }
  let url: URL
  try {
    url = new URL(siteUrl)
  } catch {
    return null
  }
  if (url.pathname !== '/' || url.search || url.hash) return null
  const host = normalizeBrandDomain(url.hostname)
  return host ? { host, subdomains: false } : null
}

export function propertyEligibility(
  siteUrl: string,
  permissionLevel: string,
  brandDomain: string | null | undefined,
): BindingVerdict {
  const brand = normalizeBrandDomain(brandDomain)
  if (!brand) return { eligible: false, reason: 'no_domain' }

  const covered = coverage(siteUrl)
  const covers = covered !== null
    && (covered.host === brand || (covered.subdomains && brand.endsWith(`.${covered.host}`)))
  if (!covers) return { eligible: false, reason: 'other_domain' }

  if (!VERIFIED_LEVELS.has(permissionLevel)) return { eligible: false, reason: 'unverified' }
  return { eligible: true }
}
