import 'server-only'
import {
  FirecrawlError,
  type FirecrawlConfig,
  type FirecrawlFailureKind,
  type ScrapePublicPageInput,
  type ScrapedPage,
} from './types'

/**
 * Single-page scrape only. The path matches `@mendable/firecrawl-js` 4.x's v2
 * client (`POST /v2/scrape`). Crawl, map, batch, search and extract are
 * deliberately absent from this module.
 */
export const FIRECRAWL_SCRAPE_URL = 'https://api.firecrawl.dev/v2/scrape'
/** Our deadline for the whole HTTP exchange. */
export const FIRECRAWL_TIMEOUT_MS = 15_000
/** Firecrawl's own server-side page timeout, kept under ours so the vendor gives up first. */
export const FIRECRAWL_VENDOR_TIMEOUT_MS = 12_000

type Environment = Record<string, string | undefined>

/** Reads FIRECRAWL_API_KEY only. Missing or blank is not usable and nothing is fetched. */
export function firecrawlConfig(env: Environment = process.env): FirecrawlConfig | null {
  const apiKey = typeof env.FIRECRAWL_API_KEY === 'string' ? env.FIRECRAWL_API_KEY.trim() : ''
  return apiKey ? { apiKey } : null
}

/**
 * 403 is the vendor refusing this target (unsupported or blocked site), not a
 * bad key; Firecrawl signals a bad key with 401.
 */
export function classifyFirecrawlFailure(httpStatus: number): FirecrawlFailureKind {
  if (httpStatus === 401) return 'auth'
  if (httpStatus === 402) return 'payment'
  if (httpStatus === 429) return 'rate_limit'
  if (httpStatus === 408 || httpStatus >= 500) return 'unavailable'
  if (httpStatus >= 400) return 'invalid'
  return 'unavailable'
}

type ScrapeBody = {
  url: string
  formats: ['markdown']
  onlyMainContent: true
  proxy: 'basic'
  timeout: number
}

/**
 * Exactly one URL per HTTP request. Markdown only (JSON format costs extra
 * credits) and the basic proxy only (stealth/auto can bill more per page).
 */
export function buildScrapeRequestBody(urls: readonly string[]): ScrapeBody {
  if (urls.length !== 1 || typeof urls[0] !== 'string') throw new FirecrawlError('invalid', 0, 'single_url_required')
  return {
    url: urls[0],
    formats: ['markdown'],
    onlyMainContent: true,
    proxy: 'basic',
    timeout: FIRECRAWL_VENDOR_TIMEOUT_MS,
  }
}

type ScrapeResponse = {
  success?: boolean
  data?: {
    markdown?: unknown
    metadata?: Record<string, unknown>
  }
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function httpUrl(value: unknown): string | undefined {
  const candidate = text(value)
  if (!candidate) return undefined
  try {
    const parsed = new URL(candidate)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : undefined
  } catch { return undefined }
}

/**
 * One billed Firecrawl scrape. There are no retries and no auto-resume of a
 * 408 "processing continues" answer, because each attempt can cost a credit.
 */
export async function scrapePublicPage(
  input: ScrapePublicPageInput,
  deps: { fetch?: typeof fetch; env?: Environment } = {},
): Promise<ScrapedPage> {
  const config = firecrawlConfig(deps.env ?? process.env)
  if (!config) throw new FirecrawlError('misconfigured', 0, 'api_key_missing')
  const fetchImpl = deps.fetch ?? fetch

  const body = buildScrapeRequestBody([input.url])
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

  if (!response.ok) {
    throw new FirecrawlError(classifyFirecrawlFailure(response.status), response.status, 'vendor_http_failure')
  }

  let payload: ScrapeResponse | null = null
  try {
    payload = await response.json() as ScrapeResponse
  } catch {
    payload = null
  }
  if (!payload || typeof payload !== 'object' || payload.success !== true || !payload.data || typeof payload.data !== 'object') {
    throw new FirecrawlError('unavailable', response.status, 'invalid_response')
  }

  const metadata = payload.data.metadata && typeof payload.data.metadata === 'object' ? payload.data.metadata : {}
  const url = httpUrl(metadata.url) ?? httpUrl(metadata.sourceURL)
  const title = text(metadata.title)
  const markdown = text(payload.data.markdown)
  const contentType = text(metadata.contentType)
  const pageStatus = typeof metadata.statusCode === 'number' && Number.isInteger(metadata.statusCode)
    ? metadata.statusCode
    : undefined
  return {
    ...(url ? { url } : {}),
    ...(title ? { title } : {}),
    ...(markdown ? { markdown } : {}),
    ...(contentType ? { contentType } : {}),
    ...(pageStatus !== undefined ? { pageStatus } : {}),
  }
}
