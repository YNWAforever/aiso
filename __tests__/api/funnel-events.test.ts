import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const consumeMock = vi.hoisted(() => vi.fn(async () => ({
  allowed: true, remaining: 119, resetAt: 2_000_000_000,
})))

// Mocked explicitly rather than leaning on the route's fail-open path: without
// this the route would reach a real db() call, and every test would pass for the
// wrong reason — the limiter erroring rather than allowing.
vi.mock('@/lib/security/funnel-rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/funnel-rate-limit')>()
  return { ...actual, consumeFunnelEventRateLimit: consumeMock }
})

const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

const VALID = {
  name: 'scan_completed',
  attemptId: '550e8400-e29b-41d4-a716-446655440000',
  locale: 'en',
}

async function post(body: string, headers: HeadersInit = { 'Content-Type': 'application/json' }) {
  const { POST } = await import('@/app/api/funnel-events/route')
  return POST(new NextRequest('http://localhost/api/funnel-events', { method: 'POST', headers, body }))
}

beforeEach(() => {
  info.mockClear()
  error.mockClear()
  consumeMock.mockClear()
  consumeMock.mockResolvedValue({ allowed: true, remaining: 119, resetAt: 2_000_000_000 })
})

describe('POST /api/funnel-events', () => {
  it('accepts a redacted event without echoing its input', async () => {
    const response = await post(JSON.stringify({ ...VALID, scanId: 'scan-1' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(info).toHaveBeenCalledWith('[funnel]', expect.not.stringContaining('scan-1'))
  })

  it('rejects malformed, PII, and oversized payloads without echoing them', async () => {
    for (const body of [
      '{',
      JSON.stringify({ ...VALID, email: 'person@example.com' }),
      JSON.stringify({ ...VALID, metadata: { url: 'https://example.com' } }),
      JSON.stringify({ ...VALID, metadata: [{ results: ['raw report'] }] }),
      JSON.stringify({ ...VALID, attemptId: 'a'.repeat(2100) }),
    ]) {
      const response = await post(body)
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'Invalid funnel event' })
    }
  })

  it('rejects a malformed body before consuming the rate-limit allowance', async () => {
    // Validation is ahead of metering so junk cannot buy a database round-trip.
    await post('{')
    expect(consumeMock).not.toHaveBeenCalled()
  })

  it('returns 429 and writes no log line once the ceiling is reached', async () => {
    consumeMock.mockResolvedValue({ allowed: false, remaining: 0, resetAt: 2_000_000_000 })

    const response = await post(JSON.stringify(VALID))

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBeTruthy()
    expect(response.headers.get('ratelimit-limit')).toBe('120')
    expect(info).not.toHaveBeenCalled()
  })

  it('still logs and returns 200 when the limiter itself fails', async () => {
    // Fail open: losing telemetry to a limiter outage is worse than serving it,
    // and the client beacon cannot act on an error anyway.
    consumeMock.mockRejectedValue(new Error('neon unreachable'))

    const response = await post(JSON.stringify(VALID))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(info).toHaveBeenCalledWith('[funnel]', expect.any(String))
    expect(error).toHaveBeenCalledWith('[funnel] rate-limit-failed')
  })

  it('surfaces the remaining allowance on an accepted event', async () => {
    const response = await post(JSON.stringify(VALID))
    expect(response.headers.get('ratelimit-remaining')).toBe('119')
  })
})
