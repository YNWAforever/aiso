export const PUBLIC_REPORT_CSP = [
  "default-src 'none'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

export const PUBLIC_REPORT_SECURITY_HEADER_VALUES = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': PUBLIC_REPORT_CSP,
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
} as const

export function publicReportHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(PUBLIC_REPORT_SECURITY_HEADER_VALUES)
  if (extra) {
    new Headers(extra).forEach((value, key) => headers.set(key, value))
  }
  return headers
}
