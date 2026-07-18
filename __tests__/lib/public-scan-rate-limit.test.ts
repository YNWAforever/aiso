import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  PUBLIC_SCAN_LIMIT,
  PUBLIC_SCAN_WINDOW_SECONDS,
  consumePublicScanRateLimit,
  rateLimitHeaders,
} from '@/lib/security/public-scan-rate-limit'

describe('public scan rate limiter', () => {
  it('keeps the counter table private behind RLS and explicit privilege revocation', () => {
    const migration = readFileSync(resolve('supabase/migrations/023_public_scan_rate_limits.sql'), 'utf8')

    expect(migration).toMatch(/alter table public_scan_rate_limits enable row level security/i)
    expect(migration).toMatch(
      /revoke all on public_scan_rate_limits from public, anon, authenticated, service_role/i,
    )
  })

  it('uses a stable hash of the trusted forwarding address with the durable counter', async () => {
    const consume = vi.fn().mockResolvedValue({
      allowed: true,
      remaining: 4,
      resetAt: 2_000_000_000,
    })
    const req = new NextRequest('https://app.example/api/scan', {
      headers: { 'x-vercel-forwarded-for': '203.0.113.9' },
    })

    const result = await consumePublicScanRateLimit(req, consume)

    expect(result.allowed).toBe(true)
    expect(consume).toHaveBeenCalledWith(expect.stringMatching(/^[a-f0-9]{64}$/), PUBLIC_SCAN_WINDOW_SECONDS, PUBLIC_SCAN_LIMIT)
  })

  it('formats deterministic limit and retry headers for a denied request', () => {
    const headers = rateLimitHeaders({
      allowed: false,
      remaining: 0,
      resetAt: 2_000_000_000,
    }, 1_999_999_970)

    expect(Object.fromEntries(headers)).toEqual({
      'ratelimit-limit': String(PUBLIC_SCAN_LIMIT),
      'ratelimit-remaining': '0',
      'ratelimit-reset': '2000000000',
      'retry-after': '30',
    })
  })
})
