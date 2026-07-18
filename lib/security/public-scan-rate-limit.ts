import { createHash } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'

export const PUBLIC_SCAN_LIMIT = 5
export const PUBLIC_SCAN_WINDOW_SECONDS = 10 * 60

export type RateLimitDecision = { allowed: boolean; remaining: number; resetAt: number }
export type DurableRateLimitCounter = (
  keyHash: string,
  windowSeconds: number,
  limit: number,
) => Promise<RateLimitDecision>

function clientAddress(req: NextRequest) {
  const forwarded = req.headers.get('x-vercel-forwarded-for')
    ?? req.headers.get('x-forwarded-for')
    ?? req.headers.get('x-real-ip')
    ?? 'unknown'
  return forwarded.split(',')[0]?.trim() || 'unknown'
}

const consumeFromNeon: DurableRateLimitCounter = async (keyHash, windowSeconds, limit) => {
  const sql = db()
  const rows = await sql`
    with current_window as (
      select to_timestamp(floor(extract(epoch from now()) / ${windowSeconds}) * ${windowSeconds}) as window_start
    ), cleanup as (
      delete from public_scan_rate_limits where window_start < now() - interval '1 day'
    ), consumed as (
      insert into public_scan_rate_limits (key_hash, window_start, request_count)
      select ${keyHash}, window_start, 1 from current_window
      on conflict (key_hash, window_start)
      do update set request_count = public_scan_rate_limits.request_count + 1
      returning request_count, window_start
    )
    select request_count <= ${limit} as allowed,
      greatest(0, ${limit} - request_count)::int as remaining,
      extract(epoch from window_start + make_interval(secs => ${windowSeconds}))::bigint as reset_at
    from consumed
  `
  const row = rows[0] as { allowed: boolean; remaining: number; reset_at: number | string } | undefined
  if (!row) throw new Error('Rate limit counter returned no result')
  return { allowed: row.allowed, remaining: Number(row.remaining), resetAt: Number(row.reset_at) }
}

export async function consumePublicScanRateLimit(
  req: NextRequest,
  consume: DurableRateLimitCounter = consumeFromNeon,
) {
  const keyHash = createHash('sha256').update(clientAddress(req)).digest('hex')
  return consume(keyHash, PUBLIC_SCAN_WINDOW_SECONDS, PUBLIC_SCAN_LIMIT)
}

export function rateLimitHeaders(decision: RateLimitDecision, nowSeconds = Math.floor(Date.now() / 1000)) {
  const headers = new Headers({
    'RateLimit-Limit': String(PUBLIC_SCAN_LIMIT),
    'RateLimit-Remaining': String(decision.remaining),
    'RateLimit-Reset': String(decision.resetAt),
  })
  if (!decision.allowed) headers.set('Retry-After', String(Math.max(1, decision.resetAt - nowSeconds)))
  return headers
}
