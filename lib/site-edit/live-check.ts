import { createHash } from 'node:crypto'
import { parse } from 'parse5'
import { checkStructuredData } from '@/lib/checks/structuredData'
import { createPublicUrlFetcher, type PublicUrlFetch } from '@/lib/security/public-url'
import { normalizeLlmsTxt, type EditSpecV1, type MetaEditSpec } from './edit-spec'

/**
 * Site-edit S4: fetch the frozen target URL and look for the approved JSON-LD
 * payload (S9: or the approved title/description). Pure apart from the
 * injected fetcher. "Found" means only that the page, at fetch time, carries
 * exactly what was approved once both are canonicalised; it says nothing
 * about impact.
 */

export const LIVE_CHECK_BODY_LIMIT = 2 * 1024 * 1024
export const LIVE_CHECK_TIMEOUT_MS = 10_000
/** Minimum spacing between checks of one job, so the button cannot hammer a brand's site. */
export const LIVE_CHECK_SPACING_MS = 60_000

export type LiveCheckOutcome = 'found' | 'missing' | 'fetch_failed'
/** S7: the scan's own structured-data check (c4) run on the fetched page. Null when the page did not load. */
export type StructuredDataVerdict = { status: 'pass' | 'warn' | 'fail'; message: string }
export type LiveFetch = { outcome: LiveCheckOutcome; httpStatus: number | null; pageSha256: string | null; checkedAt: Date
  structuredData?: StructuredDataVerdict | null }

/**
 * Runs c4 exactly as the scan does, but on the bytes this check already
 * fetched: the injected fetcher answers with that page, so there is no second
 * request and no drift between "found" and the AEO verdict.
 */
export async function structuredDataVerdict(url: string, html: string): Promise<StructuredDataVerdict | null> {
  const result = await checkStructuredData(url, async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }))
  if (result.status !== 'pass' && result.status !== 'warn' && result.status !== 'fail') return null
  return { status: result.status, message: result.message.slice(0, 100) }
}

/** Module scope is safe: building the fetcher opens nothing (no db(), no socket). https only, SSRF-pinned per hop. */
export const liveCheckFetcher: PublicUrlFetch = createPublicUrlFetcher({
  allowedProtocols: ['https:'], maxRedirects: 3, maxResponseBytes: LIVE_CHECK_BODY_LIMIT, timeoutMs: LIVE_CHECK_TIMEOUT_MS,
})

/** Sorted keys, NFC strings. Nested `@context`s are kept and compared literally. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, entry]) => [key.normalize('NFC'), canonical(entry)]))
  }
  return typeof value === 'string' ? value.normalize('NFC') : value
}

/** The approved payload is always plain schema.org; a page block must resolve to the same vocabulary. */
const SCHEMA_ORG = new Set(['https://schema.org', 'https://schema.org/', 'http://schema.org', 'http://schema.org/'])

/** A node compared without its own top-level `@context`, once that context (or the one it inherits) is checked. */
function withoutContext(node: Record<string, unknown>): string {
  const { '@context': _context, ...rest } = node
  return JSON.stringify(canonical(rest))
}

type Html = { nodeName: string; namespaceURI?: string; attrs?: { name: string; value: string }[]; childNodes?: Html[]; value?: string }
const HTML_NS = 'http://www.w3.org/1999/xhtml'

/**
 * The text of every real `<script type="application/ld+json">` element. Parsed
 * with parse5, not a regex: a commented-out block, a `data-type=` attribute,
 * `<template>` content and script text inside `<noscript>` are not elements
 * the page runs, so none of them can count as "on the page". There is no
 * block cap: the response is already bounded at 2 MiB, and a revert may only
 * be verified by absence after searching ALL of it.
 */
function jsonLdScripts(html: string): string[] {
  const out: string[] = []
  const walk = (node: Html) => {
    if (node.nodeName === 'script') {
      const type = node.attrs?.find(attr => attr.name === 'type')?.value.trim().toLowerCase()
      if (type === 'application/ld+json') out.push((node.childNodes ?? []).map(child => child.value ?? '').join(''))
    }
    for (const child of node.childNodes ?? []) walk(child)
  }
  walk(parse(html) as unknown as Html)
  return out
}

/**
 * Every top-level JSON-LD node on the page with the `@context` it is read
 * under: each block, each array member (its own context) and each `@graph`
 * member (its own context, else the wrapper's).
 */
export function jsonLdNodes(html: string): { node: Record<string, unknown>; context: unknown }[] {
  const nodes: { node: Record<string, unknown>; context: unknown }[] = []
  const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  for (const text of jsonLdScripts(html)) {
    let parsed: unknown
    try { parsed = JSON.parse(text.trim()) } catch { continue }
    for (const node of Array.isArray(parsed) ? parsed : [parsed]) {
      if (!isObject(node)) continue
      nodes.push({ node, context: node['@context'] })
      const graph = node['@graph']
      if (Array.isArray(graph)) for (const member of graph) if (isObject(member)) nodes.push({ node: member, context: member['@context'] ?? node['@context'] })
    }
  }
  return nodes
}

export function pageHasPayload(html: string, payload: Record<string, unknown>): boolean {
  const want = withoutContext(payload)
  return jsonLdNodes(html).some(({ node, context }) => typeof context === 'string' && SCHEMA_ORG.has(context) && withoutContext(node) === want)
}

/** Whitespace runs collapse to one space and the ends are trimmed, as a browser shows the text. */
const collapse = (text: string) => text.replace(/[\t\n\f\r ]+/g, ' ').trim().normalize('NFC')
const textOf = (node: Html): string => node.nodeName === '#text' ? node.value ?? '' : (node.childNodes ?? []).map(textOf).join('')

/**
 * S9: the page's document title (the FIRST HTML-namespace `<title>`, as the
 * HTML spec defines it, so an inline SVG's `<title>` never counts) and the
 * content of every `<meta name="description">`. Template content is not in
 * parse5's childNodes, so a `<template>` copy cannot count either.
 */
export function pageMeta(html: string): { title: string | null; descriptions: string[] } {
  let title: string | null = null
  const descriptions: string[] = []
  const walk = (node: Html) => {
    const html = node.namespaceURI === HTML_NS
    if (html && node.nodeName === 'title' && title === null) title = collapse(textOf(node))
    if (html && node.nodeName === 'meta' && node.attrs?.find(a => a.name === 'name')?.value.trim().toLowerCase() === 'description') {
      descriptions.push(collapse(node.attrs?.find(a => a.name === 'content')?.value ?? ''))
    }
    for (const child of node.childNodes ?? []) walk(child)
  }
  walk(parse(html) as unknown as Html)
  return { title, descriptions }
}

/**
 * Every field the spec sets is on the page: the title equals it, and the page
 * has at least one meta description and EVERY one equals it (a stale duplicate
 * left beside the new one is not a clean delivery). Fields set to null are
 * not looked at.
 */
export function pageHasMeta(html: string, spec: Pick<MetaEditSpec, 'title' | 'description'>): boolean {
  const page = pageMeta(html)
  if (spec.title !== null && page.title !== collapse(spec.title)) return false
  if (spec.description !== null) {
    const want = collapse(spec.description)
    if (page.descriptions.length === 0 || page.descriptions.some(d => d !== want)) return false
  }
  return true
}

/**
 * S10: the served llms.txt equals the approved content. Both sides get LF line
 * endings and NFC, the served file loses a leading BOM, and both lose trailing
 * whitespace at the very end (an editor's final newline is not a difference).
 * Everything else, including Markdown's trailing double spaces, must match.
 */
export function fileHasLlmsTxt(body: string, content: string): boolean {
  const norm = (text: string) => normalizeLlmsTxt(text.replace(/^\uFEFF/, '')).trimEnd()
  return norm(body) === norm(content)
}

/** Whether the target carries what the spec puts there (for a revert: whether the block is still there). */
export function specOnPage(body: string, spec: EditSpecV1): boolean {
  if (spec.kind === 'llms_txt') return fileHasLlmsTxt(body, spec.content)
  return spec.kind === 'meta' ? pageHasMeta(body, spec) : pageHasPayload(body, spec.payload)
}

/** An HTML page for page edits; a plain-text (or Markdown) file for llms.txt, never an HTML page in its place. */
const ACCEPT = { page: 'text/html', file: 'text/plain, text/markdown' } as const
const TYPE_OK = { page: /text\/html|application\/xhtml\+xml/i, file: /^\s*text\/(plain|markdown|x-markdown)\s*(;|$)/i } as const

async function readCapped(response: Response): Promise<string | null> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > LIVE_CHECK_BODY_LIMIT) { await reader.cancel(); return null }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

/** One GET of the target. Never throws: any transport failure, non-2xx, wrong content type or oversized body is `fetch_failed`. */
export async function fetchLivePage(url: string, spec: EditSpecV1, fetcher: PublicUrlFetch = liveCheckFetcher): Promise<LiveFetch> {
  let httpStatus: number | null = null
  try {
    const target = spec.kind === 'llms_txt' ? 'file' : 'page'
    const response = await fetcher(url, { method: 'GET', headers: { Accept: ACCEPT[target] } })
    httpStatus = response.status
    const type = response.headers.get('content-type') ?? ''
    if (!response.ok || !TYPE_OK[target].test(type)) {
      await response.body?.cancel()
      return { outcome: 'fetch_failed', httpStatus, pageSha256: null, checkedAt: new Date() }
    }
    const html = await readCapped(response)
    if (html === null) return { outcome: 'fetch_failed', httpStatus, pageSha256: null, checkedAt: new Date() }
    const pageSha256 = createHash('sha256').update(html).digest('hex')
    const checkedAt = new Date()
    // S7's c4 verdict is about structured data, so it is recorded for JSON-LD edits only (not `meta` or `llms_txt`).
    const structuredData = spec.kind === 'meta' || spec.kind === 'llms_txt' ? null : await structuredDataVerdict(url, html).catch(() => null)
    return { outcome: specOnPage(html, spec) ? 'found' : 'missing', httpStatus, pageSha256, checkedAt, structuredData }
  } catch {
    return { outcome: 'fetch_failed', httpStatus: null, pageSha256: null, checkedAt: new Date() }
  }
}
