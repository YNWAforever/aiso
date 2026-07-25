import { createHmac } from 'node:crypto'
import { isIP } from 'node:net'
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'

export const PUBLIC_SCAN_LIMIT = 5
export const PUBLIC_SCAN_WINDOW_SECONDS = 10 * 60

const KEY_VERSION = 'v1'
const KEY_DOMAIN = 'geoscanner:public-scan-rate-limit:key:v1'
const LOCAL_IDENTITY = 'local-development'
const LOCAL_SECRET = 'geoscanner-local-development-only-rate-limit-secret-v1'

export type RateLimitDecision = { allowed: boolean; remaining: number; resetAt: number }
export type DurableRateLimitCounter = (
  keyHash: string,
  windowSeconds: number,
  limit: number,
) => Promise<RateLimitDecision>
export type PublicScanRateLimitRuntime = {
  nodeEnv?: string
  vercel?: string
  secret?: string
}

function defaultRuntime(): PublicScanRateLimitRuntime {
  return {
    nodeEnv: process.env.NODE_ENV,
    vercel: process.env.VERCEL,
    secret: process.env.PUBLIC_SCAN_RATE_LIMIT_SECRET,
  }
}

function productionIdentity(req: NextRequest, runtime: PublicScanRateLimitRuntime) {
  if (runtime.vercel !== '1') {
    throw new Error('Production public scan rate limiting requires Vercel (VERCEL=1)')
  }
  const forwarded = req.headers.get('x-vercel-forwarded-for')
  const address = forwarded?.split(',')[0]?.trim()
  if (!address || isIP(address) === 0) {
    throw new Error('Missing trusted Vercel forwarding address')
  }
  return 'ip:' + address
}

function clientIdentity(req: NextRequest, runtime: PublicScanRateLimitRuntime) {
  if (runtime.nodeEnv === 'production') return productionIdentity(req, runtime)
  // Local/test requests share a deliberately isolated identity. Forwarded headers
  // are ignored because they are caller-controlled outside the Vercel invariant.
  return LOCAL_IDENTITY
}

function rateLimitSecret(runtime: PublicScanRateLimitRuntime) {
  const secret = runtime.secret ?? (runtime.nodeEnv === 'production' ? undefined : LOCAL_SECRET)
  if (!secret || secret.length < 32) {
    throw new Error('PUBLIC_SCAN_RATE_LIMIT_SECRET must contain at least 32 characters')
  }
  return secret
}

export function derivePublicScanRateLimitKey(identity: string, secret: string) {
  if (secret.length < 32) throw new Error('Rate limit HMAC secret must contain at least 32 characters')
  const digest = createHmac('sha256', secret)
    .update(KEY_DOMAIN)
    .update('\0')
    .update(identity)
    .digest('hex')
  return KEY_VERSION + ':' + digest
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
  runtime: PublicScanRateLimitRuntime = defaultRuntime(),
) {
  const identity = clientIdentity(req, runtime)
  const keyHash = derivePublicScanRateLimitKey(identity, rateLimitSecret(runtime))
  return consume(keyHash, PUBLIC_SCAN_WINDOW_SECONDS, PUBLIC_SCAN_LIMIT)
}

export function rateLimitHeaders(decision: RateLimitDecision, nowSeconds = Math.floor(Date.now() / 1000)) {
  const resetDelay = Math.max(0, decision.resetAt - nowSeconds)
  const headers = new Headers({
    'RateLimit-Limit': String(PUBLIC_SCAN_LIMIT),
    'RateLimit-Remaining': String(decision.remaining),
    'RateLimit-Reset': String(resetDelay),
  })
  if (!decision.allowed) headers.set('Retry-After', String(Math.max(1, resetDelay)))
  return headers
}
