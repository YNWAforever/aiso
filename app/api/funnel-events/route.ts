import { NextRequest, NextResponse } from 'next/server'
import { logFunnelEvent, redactFunnelEvent, type FunnelEventInput } from '@/lib/observability/funnel'

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

  if (!redactFunnelEvent(body)) return NextResponse.json(INVALID_EVENT, { status: 400 })
  logFunnelEvent(body as FunnelEventInput)
  return NextResponse.json({ ok: true })
}
