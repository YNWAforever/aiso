const MAX_RETRY_SECONDS = 86400

export function authRetryAfter(headers: Headers, now = Date.now()): number | null {
  const value = (headers.get('Retry-After') ?? headers.get('X-Retry-After'))?.trim()
  if (!value) return null
  let seconds: number
  if (/^\d+$/.test(value)) seconds = Number(value)
  else if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) {
    seconds = Math.ceil((Date.parse(value) - now) / 1000)
  } else return null
  return Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= MAX_RETRY_SECONDS
    ? Math.max(1, seconds) : null
}

export class AuthRateLimitError extends Error {
  readonly status = 429
  readonly code = 'AUTH_RATE_LIMITED'
  constructor(readonly retryAfterSeconds: number | null) {
    super('AUTH_RATE_LIMITED')
    this.name = 'AuthRateLimitError'
  }
}

export function authRateLimitResponse(error: unknown): Response | null {
  if (!(error instanceof AuthRateLimitError)) return null
  const headers = new Headers({ 'Cache-Control': 'no-store' })
  if (error.retryAfterSeconds !== null) headers.set('Retry-After', String(error.retryAfterSeconds))
  return Response.json({ error: error.code, retryAfterSeconds: error.retryAfterSeconds }, { status: 429, headers })
}
