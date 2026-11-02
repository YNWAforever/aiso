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

/** One scraped public page. Absent fields stay absent; no body is invented. */
export type FirecrawlPageResult = {
  url: string
  title?: string
  markdown?: string
  text?: string
  contentType?: string
  pageStatusCode?: number
}

export class FirecrawlError extends Error {
  readonly kind: FirecrawlFailureKind
  readonly httpStatus: number
  readonly code?: string

  constructor(kind: FirecrawlFailureKind, httpStatus: number, message: string, code?: string) {
    super(message)
    this.name = 'FirecrawlError'
    this.kind = kind
    this.httpStatus = httpStatus
    this.code = code
  }
}
