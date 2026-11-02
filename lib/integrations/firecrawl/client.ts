import 'server-only'
import {
  FirecrawlError,
  type FirecrawlConfig,
  type FirecrawlFailureKind,
  type FirecrawlPageResult,
} from './types'

/** Documented single-page scrape endpoint. Never crawl, map, batch or search. */
export const FIRECRAWL_SCRAPE_URL = 'https://api.firecrawl.dev/v2/scrape'
export const FIRECRAWL_TIMEOUT_MS = 15_000
export const FIRECRAWL_MAX_URL_LENGTH = 2048

type Environment = Record<string, string | undefined>

function text(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Reads the key name only; a missing or blank value is never usable. */
export function firecrawlConfig(env: Environment = process.env): FirecrawlConfig | null {
  const apiKey = text(env.FIRECRAWL_API_KEY)
  if (!apiKey) return null
  return { apiKey }
}

export type PublicUrlReason = 'empty' | 'too_long' | 'invalid' | 'not_public'
export type PublicUrlCheck = { ok: true; url: string } | { ok: false; reason: PublicUrlReason }

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a, b] = parts
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

function isPrivateIpv6(host: string): boolean {
  const value = host.toLowerCase()
  if (value === '::' || value === '::1' || value === '0:0:0:0:0:0:0:1') return true
  if (value.startsWith('fc') || value.startsWith('fd')) return true
  if (/^fe[89ab]/.test(value)) return true
  if (value.startsWith('ff')) return true
  if (value.startsWith('::ffff:')) {
    const mapped = value.slice('::ffff:'.length)
    return IPV4.test(mapped) ? isPrivateIpv4(mapped) : false
  }
  return false
}

/**
 * Public http(s) pages only. Refuses file/local schemes, credentials in the
 * URL, localhost, private/link-local addresses and obviously non-public hosts.
 */
export function normalizePublicScrapeUrl(raw: string): PublicUrlCheck {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) return { ok: false, reason: 'empty' }
  if (value.length > FIRECRAWL_MAX_URL_LENGTH) return { ok: false, reason: 'too_long' }

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false, reason: 'not_public' }
  if (parsed.username || parsed.password) return { ok: false, reason: 'not_public' }

  const host = parsed.hostname.toLowerCase().replace(/\.$/, '')
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  if (!bare) return { ok: false, reason: 'invalid' }
  if (bare === 'localhost' || bare.endsWith('.localhost') || bare.endsWith('.local')) {
    return { ok: false, reason: 'not_public' }
  }
  if (IPV4.test(bare)) return isPrivateIpv4(bare) ? { ok: false, reason: 'not_public' } : { ok: true, url: parsed.href }
  if (bare.includes(':')) return isPrivateIpv6(bare) ? { ok: false, reason: 'not_public' } : { ok: true, url: parsed.href }
  if (!bare.includes('.')) return { ok: false, reason: 'not_public' }
  return { ok: true, url: parsed.href }
}

/**
 * Exactly one URL is accepted. Arrays, empty values and crawl-shaped inputs are
 * rejected so no caller can turn this into a crawl/map/batch/search request.
 */
export function buildScrapeRequestBody(raw: unknown): {
  url: string
  formats: ['markdown']
  onlyMainContent: true
  timeout: number
  removeBase64Images: true
} {
  const check = normalizePublicScrapeUrl(typeof raw === 'string' ? raw : '')
  if (!check.ok) throw new FirecrawlError('invalid', 0, check.reason)
  return {
    url: check.url,
    formats: ['markdown'],
    onlyMainContent: true,
    timeout: FIRECRAWL_TIMEOUT_MS,
    removeBase64Images: true,
  }
}

export function classifyFirecrawlFailure(httpStatus: number, detail?: string): FirecrawlFailureKind {
  const value = typeof detail === 'string' ? detail.toLowerCase() : ''
  if (httpStatus === 402 || /credit|payment|billing/.test(value)) return 'payment'
  if (httpStatus === 429 || /rate.?limit|too many/.test(value)) return 'rate_limit'
  if (httpStatus === 401 || httpStatus === 403 || /auth|api.?key|unauthor/.test(value)) return 'auth'
  if (/invalid|no_cached|unsupported|not_found/.test(value)) return 'invalid'
  if (httpStatus === 408 || httpStatus === 504 || httpStatus >= 500) return 'unavailable'
  if (httpStatus >= 400) return 'invalid'
  return 'unavailable'
}

type ScrapeResponse = {
  success?: boolean
  code?: string
  error?: string
  data?: {
    markdown?: unknown
    text?: unknown
    metadata?: {
      title?: unknown
      url?: unknown
      sourceURL?: unknown
      statusCode?: unknown
      contentType?: unknown
      error?: unknown
    }
  }
}

function metadataTitle(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (Array.isArray(value)) {
    const first = value.find(item => typeof item === 'string' && item.trim())
    return typeof first === 'string' ? first.trim() : undefined
  }
  return undefined
}

export type ScrapePublicPageInput = { url: string; signal?: AbortSignal }

/**
 * One billed scrape of one public URL. There is deliberately no retry, queue
 * polling, crawl, map, batch or search path here.
 */
export async function scrapePublicPage(
  input: ScrapePublicPageInput,
  env: Environment = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<FirecrawlPageResult> {
  const config = firecrawlConfig(env)
  if (!config) throw new FirecrawlError('misconfigured', 0, 'credentials_missing')

  const body = buildScrapeRequestBody(input.url)
  const timeout = AbortSignal.timeout(FIRECRAWL_TIMEOUT_MS)
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout

  let response: Response
  try {
    response = await fetchImpl(FIRECRAWL_SCRAPE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch {
    throw new FirecrawlError('unavailable', 0, 'transport_failure')
  }

  let payload: ScrapeResponse | null = null
  try {
    payload = await response.json() as ScrapeResponse
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw new FirecrawlError(
      classifyFirecrawlFailure(response.status, payload?.code ?? payload?.error),
      response.status,
      'vendor_http_failure',
      payload?.code,
    )
  }
  if (!payload || typeof payload !== 'object') {
    throw new FirecrawlError('unavailable', response.status, 'invalid_response')
  }
  if (payload.success === false) {
    throw new FirecrawlError(
      classifyFirecrawlFailure(response.status, payload.code ?? payload.error),
      response.status,
      'vendor_failure',
      payload.code,
    )
  }

  const data = payload.data && typeof payload.data === 'object' ? payload.data : null
  if (!data) throw new FirecrawlError('unavailable', response.status, 'invalid_response')
  const metadata = data.metadata && typeof data.metadata === 'object' ? data.metadata : {}

  if (typeof metadata.error === 'string' && metadata.error.trim()) {
    throw new FirecrawlError('invalid', response.status, 'page_error')
  }
  const pageStatusCode = typeof metadata.statusCode === 'number' && Number.isFinite(metadata.statusCode)
    ? metadata.statusCode
    : undefined
  if (pageStatusCode !== undefined && pageStatusCode >= 400) {
    throw new FirecrawlError('invalid', response.status, `page_status_${pageStatusCode}`)
  }

  const finalUrl = typeof metadata.url === 'string' ? metadata.url
    : typeof metadata.sourceURL === 'string' ? metadata.sourceURL
      : undefined
  const checkedFinal = finalUrl ? normalizePublicScrapeUrl(finalUrl) : null
  const url = checkedFinal?.ok ? checkedFinal.url : body.url

  const markdown = typeof data.markdown === 'string' && data.markdown.trim() ? data.markdown : undefined
  const plainText = typeof data.text === 'string' && data.text.trim() ? data.text : undefined
  const title = metadataTitle(metadata.title)
  const contentType = typeof metadata.contentType === 'string' && metadata.contentType.trim()
    ? metadata.contentType.trim()
    : undefined

  return {
    url,
    ...(title ? { title } : {}),
    ...(markdown ? { markdown } : {}),
    ...(plainText ? { text: plainText } : {}),
    ...(contentType ? { contentType } : {}),
    ...(pageStatusCode !== undefined ? { pageStatusCode } : {}),
  }
}
