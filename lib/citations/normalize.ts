/**
 * Canonical forms for citation URLs and their sites (GEO parity Step 4).
 *
 * The registrable domain uses a curated list of multi-part public suffixes
 * rather than the full Public Suffix List: no PSL library is installed, and the
 * list covers the markets this product serves (Hong Kong first). An unlisted
 * multi-part suffix falls back to the last two labels, which over-groups
 * (every `*.foo.xx` site under `foo.xx`) rather than splitting one site.
 */

const MULTI_PART_SUFFIXES = new Set([
  'com.hk', 'org.hk', 'net.hk', 'gov.hk', 'edu.hk', 'idv.hk',
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'ltd.uk', 'plc.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'com.sg', 'edu.sg', 'gov.sg', 'org.sg',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn',
  'com.tw', 'org.tw', 'edu.tw', 'gov.tw',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp',
  'co.kr', 'or.kr', 'co.nz', 'com.my', 'com.ph', 'co.in', 'com.br', 'com.mo',
])

/** Query parameters that only identify a click, never a page. */
const TRACKING_PARAMS = /^(utm_[a-z]+|gclid|fbclid|msclkid|mc_[a-z]+|ref|ref_src|igshid|spm)$/i

const stripWww = (host: string) => host.replace(/^www\d?\./, '')

/** HTTP(S) only, lower-case host without `www.`, no fragment, no tracking parameters, no trailing slash. */
export function normalizeCitationUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  let url: URL
  try { url = new URL(value.trim()) } catch { return null }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  url.hash = ''
  url.hostname = stripWww(url.hostname.toLowerCase())
  for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key)
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) url.pathname = url.pathname.replace(/\/+$/, '')
  return url.toString()
}

/** The site a host belongs to: `personal.hsbc.com.hk` → `hsbc.com.hk`. */
export function registrableDomain(host: string): string {
  const clean = stripWww(host.toLowerCase().replace(/\.$/, ''))
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(clean) || !clean.includes('.')) return clean
  const labels = clean.split('.')
  const lastTwo = labels.slice(-2).join('.')
  return labels.slice(MULTI_PART_SUFFIXES.has(lastTwo) && labels.length >= 3 ? -3 : -2).join('.')
}

/** True when `host` is `domain` or one of its subdomains — never a lookalike (`notfimmick.com`). */
export function isWithin(host: string, domain: string): boolean {
  const h = stripWww(host.toLowerCase())
  const d = stripWww(domain.toLowerCase())
  return h === d || h.endsWith(`.${d}`)
}
