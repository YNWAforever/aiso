import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  PUBLIC_SCAN_LIMIT,
  PUBLIC_SCAN_WINDOW_SECONDS,
  consumePublicScanRateLimit,
  derivePublicScanRateLimitKey,
  rateLimitHeaders,
} from '@/lib/security/public-scan-rate-limit'

const secretA = 'a'.repeat(32)
const secretB = 'b'.repeat(32)

describe('public scan rate limiter', () => {
  it('keeps the counter table private behind RLS and explicit privilege revocation', () => {
    const migration = readFileSync(resolve('supabase/migrations/023_public_scan_rate_limits.sql'), 'utf8')

    expect(migration).toMatch(/alter table public_scan_rate_limits enable row level security/i)
    expect(migration).toMatch(
      /revoke all on public_scan_rate_limits from public, anon, authenticated, service_role/i,
    )
  })

  it('derives a deterministic versioned HMAC without exposing the raw address', () => {
    const identity = 'ip:203.0.113.9'
    const first = derivePublicScanRateLimitKey(identity, secretA)
    const second = derivePublicScanRateLimitKey(identity, secretA)
    const rotated = derivePublicScanRateLimitKey(identity, secretB)

    expect(first).toBe(second)
    expect(first).toMatch(/^v1:[a-f0-9]{64}$/)
    expect(first).not.toContain('203.0.113.9')
    expect(rotated).not.toBe(first)
  })

  it('uses only the Vercel-overwritten address in production', async () => {
    const consume = vi.fn().mockResolvedValue({ allowed: true, remaining: 4, resetAt: 2_000_000_000 })
    const req = new NextRequest('https://app.example/api/scan', {
      headers: {
        'x-vercel-forwarded-for': '203.0.113.9',
        'x-forwarded-for': '10.0.0.1',
        'x-real-ip': '127.0.0.1',
      },
    })

    await consumePublicScanRateLimit(req, consume, {
      nodeEnv: 'production',
      vercel: '1',
      secret: secretA,
    })

    expect(consume).toHaveBeenCalledWith(
      derivePublicScanRateLimitKey('ip:203.0.113.9', secretA),
      PUBLIC_SCAN_WINDOW_SECONDS,
      PUBLIC_SCAN_LIMIT,
    )
  })

  it('fails closed in production when only spoofable forwarding headers are present', async () => {
    const consume = vi.fn()
    const req = new NextRequest('https://app.example/api/scan', {
      headers: { 'x-forwarded-for': '203.0.113.9', 'x-real-ip': '203.0.113.9' },
    })

    await expect(consumePublicScanRateLimit(req, consume, {
      nodeEnv: 'production',
      vercel: '1',
      secret: secretA,
    })).rejects.toThrow(/trusted Vercel forwarding address/i)
    expect(consume).not.toHaveBeenCalled()
  })

  it('fails closed when production is not running under the Vercel invariant', async () => {
    const consume = vi.fn()
    const req = new NextRequest('https://app.example/api/scan', {
      headers: { 'x-vercel-forwarded-for': '203.0.113.9' },
    })

    await expect(consumePublicScanRateLimit(req, consume, {
      nodeEnv: 'production',
      vercel: undefined,
      secret: secretA,
    })).rejects.toThrow(/requires Vercel/i)
    expect(consume).not.toHaveBeenCalled()
  })

  it('uses an isolated constant identity for local/test scans and ignores spoofed headers', async () => {
    const consume = vi.fn().mockResolvedValue({ allowed: true, remaining: 4, resetAt: 2_000_000_000 })
    const first = new NextRequest('http://localhost/api/scan', {
      headers: { 'x-forwarded-for': '198.51.100.1' },
    })
    const second = new NextRequest('http://localhost/api/scan', {
      headers: { 'x-real-ip': '203.0.113.1' },
    })

    await consumePublicScanRateLimit(first, consume, { nodeEnv: 'test' })
    await consumePublicScanRateLimit(second, consume, { nodeEnv: 'test' })

    expect(consume.mock.calls[0]?.[0]).toMatch(/^v1:[a-f0-9]{64}$/)
    expect(consume.mock.calls[1]?.[0]).toBe(consume.mock.calls[0]?.[0])
  })

  it('formats RateLimit-Reset and Retry-After as delay seconds', () => {
    const headers = rateLimitHeaders({
      allowed: false,
      remaining: 0,
      resetAt: 2_000_000_000,
    }, 1_999_999_970)

    expect(Object.fromEntries(headers)).toEqual({
      'ratelimit-limit': String(PUBLIC_SCAN_LIMIT),
      'ratelimit-remaining': '0',
      'ratelimit-reset': '30',
      'retry-after': '30',
    })
  })
})
