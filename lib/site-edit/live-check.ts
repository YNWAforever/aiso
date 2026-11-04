import { createHash } from 'node:crypto'
import { parse } from 'parse5'
import { createPublicUrlFetcher, type PublicUrlFetch } from '@/lib/security/public-url'

/**
 * Site-edit S4: fetch the frozen target URL and look for the approved JSON-LD
 * payload. Pure apart from the injected fetcher. "Found" means only that a
 * JSON-LD block on the page, at fetch time, equals the approved payload once
 * both are canonicalised; it says nothing about impact.
 */

export const LIVE_CHECK_BODY_LIMIT = 2 * 1024 * 1024
export const LIVE_CHECK_TIMEOUT_MS = 10_000
/** Minimum spacing between checks of one job, so the button cannot hammer a brand's site. */
export const LIVE_CHECK_SPACING_MS = 60_000

export type LiveCheckOutcome = 'found' | 'missing' | 'fetch_failed'
export type LiveFetch = { outcome: LiveCheckOutcome; httpStatus: number | null; pageSha256: string | null; checkedAt: Date }

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

type Html = { nodeName: string; attrs?: { name: string; value: string }[]; childNodes?: Html[]; value?: string }

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

/** One GET of the target. Never throws: any transport failure, non-2xx, non-HTML or oversized page is `fetch_failed`. */
export async function fetchLivePage(url: string, payload: Record<string, unknown>, fetcher: PublicUrlFetch = liveCheckFetcher): Promise<LiveFetch> {
  let httpStatus: number | null = null
  try {
    const response = await fetcher(url, { method: 'GET', headers: { Accept: 'text/html' } })
    httpStatus = response.status
    const type = response.headers.get('content-type') ?? ''
    if (!response.ok || !/text\/html|application\/xhtml\+xml/i.test(type)) {
      await response.body?.cancel()
      return { outcome: 'fetch_failed', httpStatus, pageSha256: null, checkedAt: new Date() }
    }
    const html = await readCapped(response)
    if (html === null) return { outcome: 'fetch_failed', httpStatus, pageSha256: null, checkedAt: new Date() }
    const pageSha256 = createHash('sha256').update(html).digest('hex')
    return { outcome: pageHasPayload(html, payload) ? 'found' : 'missing', httpStatus, pageSha256, checkedAt: new Date() }
  } catch {
    return { outcome: 'fetch_failed', httpStatus: null, pageSha256: null, checkedAt: new Date() }
  }
}
