import { stripNonVisible } from '@/lib/checks/visibleText'

/**
 * E-E-A-T and trust signals on the scanned page (GEO parity Step 8).
 *
 * A diagnostic, deliberately outside the 100-point score: adding scored checks
 * would silently change every grade, so these are reported for guidance and
 * weighted only once real data says how much they matter. That is also why
 * this lives outside lib/checks (the 20 scored checks) and is stored as
 * `results.trust_signals` with its own version, not in the evidence envelope.
 *
 * Pure and synchronous over the HTML the scan already fetched: no extra
 * request, so nothing new on the scan's critical path and no new SSRF surface.
 * Markup is read with scripts, styles and comments removed, so a link inside
 * an inline script or an HTML comment is not a signal; JSON-LD is read from
 * its own script blocks.
 */

export const TRUST_SIGNALS_VERSION = '2026-10-10.v1'
export const TRUST_SIGNAL_KEYS = [
  'author', 'organization', 'contact', 'address', 'about',
  'policies', 'reviews', 'dates', 'credentials', 'https',
] as const
export type TrustSignalKey = (typeof TRUST_SIGNAL_KEYS)[number]
export type TrustSignalStatus = 'pass' | 'warn' | 'fail'
export type TrustSignalsResult = { version: string; signals: { key: TrustSignalKey; status: TrustSignalStatus }[] }

type Node = Record<string, unknown>

const JSON_LD = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi

/** Every object in every parseable JSON-LD block, including @graph members and nested values. */
function jsonLdNodes(html: string): Node[] {
  const nodes: Node[] = []
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(visit); return }
    if (!value || typeof value !== 'object') return
    nodes.push(value as Node)
    Object.values(value).forEach(visit)
  }
  for (const [, block] of html.matchAll(JSON_LD)) {
    try { visit(JSON.parse(block)) } catch { /* malformed block: not evidence of anything */ }
  }
  return nodes
}

const typesOf = (node: Node) => ([] as unknown[]).concat(node['@type'] ?? []).filter((t): t is string => typeof t === 'string')
const isOrganization = (node: Node) =>
  typesOf(node).some(t => /(^|:)(Organization|Corporation|NGO|LocalBusiness|Store|Restaurant)$|Business$/.test(t))
const has = (node: Node, key: string) => {
  const value = node[key]
  return value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0)
}
const numeric = (value: unknown) => value !== null && value !== '' && Number.isFinite(Number(value))

const attr = (attrs: string, name: string) =>
  attrs.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))?.slice(1).find(v => v !== undefined) ?? ''

type Link = { href: string; rel: string; text: string }
function linksIn(markup: string): Link[] {
  return [...markup.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)].map(([, attrs, inner]) => ({
    href: attr(attrs, 'href'),
    rel: attr(attrs, 'rel'),
    text: inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  }))
}
const linkMatches = (links: Link[], pattern: RegExp) => links.some(l => pattern.test(l.href) || pattern.test(l.text))
const meta = (markup: string, pattern: RegExp) =>
  [...markup.matchAll(/<meta\b([^>]*)>/gi)].some(([, attrs]) =>
    pattern.test(attr(attrs, 'name') || attr(attrs, 'property')) && !!attr(attrs, 'content').trim())

const ABOUT = /about|our-story|關於|关于|公司簡介|公司简介/i
const CONTACT = /contact|聯絡|联络|聯繫|联系/i
const PRIVACY = /privacy|私隱|隱私|隐私|私隐|個人資料/i
const TERMS = /terms|conditions|條款|条款|使用條件/i

/**
 * Valid rating markup passes. Missing and malformed both warn: neither earns
 * rich results, and a site without reviews is not untrustworthy for lacking
 * the markup.
 */
function reviewStatus(nodes: Node[]): TrustSignalStatus {
  const validRating = nodes.some(n => typesOf(n).includes('AggregateRating')
    && numeric(n.ratingValue) && (Number(n.reviewCount) >= 1 || Number(n.ratingCount) >= 1))
  const validReview = nodes.some(n => {
    const rating = n.reviewRating as Node | undefined
    return typesOf(n).includes('Review') && !!rating && typeof rating === 'object' && numeric(rating.ratingValue)
  })
  return validRating || validReview ? 'pass' : 'warn'
}

export function assessTrustSignals(html: string, baseUrl: string): TrustSignalsResult {
  const nodes = jsonLdNodes(html)
  const markup = stripNonVisible(html)
  const links = linksIn(markup)
  const organizations = nodes.filter(isOrganization)

  const author = meta(markup, /^author$/i)
    || links.some(l => /\bauthor\b/i.test(l.rel))
    || /<link\b[^>]*\brel\s*=\s*["'][^"']*\bauthor\b/i.test(markup)
    || nodes.some(n => has(n, 'author'))
    || /\b(?:class|itemprop)\s*=\s*["'][^"']*\b(?:author|byline)\b/i.test(markup)

  const sameAs = organizations.some(o => ([] as unknown[]).concat(o.sameAs ?? []).some(v => typeof v === 'string' && /^https?:\/\//i.test(v)))
  const contact = links.some(l => /^(tel|mailto):/i.test(l.href))
    || nodes.some(n => has(n, 'telephone') || has(n, 'email') || has(n, 'contactPoint'))
    || linkMatches(links, CONTACT)
  const address = nodes.some(n => has(n, 'address') || typesOf(n).includes('PostalAddress')) || /<address\b/i.test(markup)
  const privacy = linkMatches(links, PRIVACY)
  const terms = linkMatches(links, TERMS)
  const dates = nodes.some(n => has(n, 'datePublished') || has(n, 'dateModified'))
    || /<time\b[^>]*\bdatetime\s*=/i.test(markup)
    || meta(markup, /^article:(published|modified)_time$/i)
  const credentials = nodes.some(n => ['hasCredential', 'award', 'awards', 'memberOf', 'accreditation'].some(k => has(n, k)))
  let https = false
  try { https = new URL(baseUrl).protocol === 'https:' } catch { /* unparseable: not HTTPS */ }

  const status: Record<TrustSignalKey, TrustSignalStatus> = {
    author: author ? 'pass' : 'fail',
    organization: sameAs ? 'pass' : organizations.length ? 'warn' : 'fail',
    contact: contact ? 'pass' : 'fail',
    address: address ? 'pass' : 'fail',
    about: linkMatches(links, ABOUT) ? 'pass' : 'fail',
    policies: privacy && terms ? 'pass' : privacy || terms ? 'warn' : 'fail',
    reviews: reviewStatus(nodes),
    dates: dates ? 'pass' : 'fail',
    // Optional for most sites, so its absence is advice, not a failure.
    credentials: credentials ? 'pass' : 'warn',
    https: https ? 'pass' : 'fail',
  }
  return { version: TRUST_SIGNALS_VERSION, signals: TRUST_SIGNAL_KEYS.map(key => ({ key, status: status[key] })) }
}
