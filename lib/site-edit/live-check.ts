import { createHash } from 'node:crypto'
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
const MAX_BLOCKS = 50

export type LiveCheckOutcome = 'found' | 'missing' | 'fetch_failed'
export type LiveFetch = { outcome: LiveCheckOutcome; httpStatus: number | null; pageSha256: string | null; checkedAt: Date }

/** Module scope is safe: building the fetcher opens nothing (no db(), no socket). https only, SSRF-pinned per hop. */
export const liveCheckFetcher: PublicUrlFetch = createPublicUrlFetcher({
  allowedProtocols: ['https:'], maxRedirects: 3, maxResponseBytes: LIVE_CHECK_BODY_LIMIT, timeoutMs: LIVE_CHECK_TIMEOUT_MS,
})

/** Sorted keys, NFC strings; `@context` dropped everywhere, since a block inside `@graph` inherits it from the wrapper. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== '@context')
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, entry]) => [key.normalize('NFC'), canonical(entry)]))
  }
  return typeof value === 'string' ? value.normalize('NFC') : value
}

const SCRIPT = /<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi

/** Every top-level JSON-LD node on the page: each block, each array member, each `@graph` member. */
export function jsonLdNodes(html: string): unknown[] {
  const nodes: unknown[] = []
  let blocks = 0
  for (const match of html.matchAll(SCRIPT)) {
    if (++blocks > MAX_BLOCKS) break
    let parsed: unknown
    try { parsed = JSON.parse(match[1].trim()) } catch { continue }
    for (const node of Array.isArray(parsed) ? parsed : [parsed]) {
      nodes.push(node)
      const graph = node && typeof node === 'object' ? (node as Record<string, unknown>)['@graph'] : undefined
      if (Array.isArray(graph)) nodes.push(...graph)
    }
  }
  return nodes
}

export function pageHasPayload(html: string, payload: Record<string, unknown>): boolean {
  const want = JSON.stringify(canonical(payload))
  return jsonLdNodes(html).some(node => JSON.stringify(canonical(node)) === want)
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
