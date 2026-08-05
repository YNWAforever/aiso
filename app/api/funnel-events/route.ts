import { NextRequest, NextResponse } from 'next/server'
import { logRedactedFunnelEvent, redactFunnelEvent } from '@/lib/observability/funnel'
import {
  consumeFunnelEventRateLimit,
  funnelEventRateLimitHeaders,
} from '@/lib/security/funnel-rate-limit'

const MAX_BODY_BYTES = 2 * 1024
const INVALID_EVENT = { error: 'Invalid funnel event' }

export async function POST(request: NextRequest) {
  const contentLength = request.headers.get('content-length')
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
    return NextResponse.json(INVALID_EVENT, { status: 400 })
  }

  let body: unknown
  try {
    const text = await request.text()
    if (new TextEncoder().encode(text).byteLength >= MAX_BODY_BYTES) {
      return NextResponse.json(INVALID_EVENT, { status: 400 })
    }
    body = JSON.parse(text)
  } catch {
    return NextResponse.json(INVALID_EVENT, { status: 400 })
  }

  // Redact before metering: a malformed body should get its 400 without buying
  // a database round-trip. The limiter guards the thing that actually costs
  // something downstream — the log write.
  const redacted = redactFunnelEvent(body)
  if (!redacted) return NextResponse.json(INVALID_EVENT, { status: 400 })

  // This endpoint is unauthenticated and appends a log line per request, which
  // on Vercel is billed, quota'd storage. The 2 KiB cap above bounds each
  // line's size; this bounds how many there can be.
  let headers: Headers | undefined
  try {
    const decision = await consumeFunnelEventRateLimit(request)
    headers = funnelEventRateLimitHeaders(decision)
    if (!decision.allowed) {
      return NextResponse.json({ error: 'Too many funnel events' }, { status: 429, headers })
    }
  } catch {
    // Fail open. This is a cost control, not a security boundary, and
    // trackFunnelEvent is a fire-and-forget beacon the client cannot retry
    // usefully — losing telemetry to a limiter outage is worse than serving it.
    console.error('[funnel] rate-limit-failed')
  }

  logRedactedFunnelEvent(redacted)
  return NextResponse.json({ ok: true }, { headers })
}
