export type FirecrawlFailureKind =
  | 'unavailable'
  | 'auth'
  | 'payment'
  | 'rate_limit'
  | 'invalid'
  | 'misconfigured'

export type FirecrawlConfig = {
  apiKey: string
}

export type ScrapePublicPageInput = {
  url: string
  signal?: AbortSignal
}

/** Markdown only. Raw HTML, screenshots and JSON extraction are never requested. */
export type ScrapedPage = {
  url?: string
  title?: string
  markdown?: string
  contentType?: string
  /** The target page's own HTTP status as Firecrawl reports it (a 404 page still costs a credit). */
  pageStatus?: number
}

export class FirecrawlError extends Error {
  readonly kind: FirecrawlFailureKind
  readonly httpStatus: number

  constructor(kind: FirecrawlFailureKind, httpStatus: number, message: string) {
    super(message)
    this.name = 'FirecrawlError'
    this.kind = kind
    this.httpStatus = httpStatus
  }
}
