import { createHmac } from 'node:crypto'
import { isIP } from 'node:net'
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'

/**
 * Generic machinery behind the durable fixed-window rate limiters.
 *
 * Extracted from public-scan-rate-limit.ts so a second caller can reuse it. The
 * storage table (`public_scan_rate_limits`, migration 023) is keyed on an opaque
 * `key_hash`, so it is already domain-agnostic — only its name is scan-specific,
 * and renaming it would cost a migration for no behavioural gain.
 *
 * The key domain string is the isolation boundary between limiters: it is mixed
 * into the HMAC, so two limiters with different domains cannot collide even for
 * the same client. Treat a domain string as permanent — changing one rehashes
 * every key and silently grants every caller a fresh allowance.
 */

const KEY_VERSION = 'v1'
const LOCAL_IDENTITY = 'local-development'
const LOCAL_SECRET = 'geoscanner-local-development-only-rate-limit-secret-v1'

export type RateLimitDecision = { allowed: boolean; remaining: number; resetAt: number }
export type DurableRateLimitCounter = (
  keyHash: string,
  windowSeconds: number,
  limit: number,
) => Promise<RateLimitDecision>
export type RateLimitRuntime = {
  nodeEnv?: string
  vercel?: string
  secret?: string
}

export function defaultRateLimitRuntime(): RateLimitRuntime {
  return {
    nodeEnv: process.env.NODE_ENV,
    vercel: process.env.VERCEL,
    secret: process.env.PUBLIC_SCAN_RATE_LIMIT_SECRET,
  }
}

function productionIdentity(req: NextRequest, runtime: RateLimitRuntime) {
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

export function resolveClientIdentity(req: NextRequest, runtime: RateLimitRuntime) {
  if (runtime.nodeEnv === 'production') return productionIdentity(req, runtime)
  // Local/test requests share a deliberately isolated identity. Forwarded headers
  // are ignored because they are caller-controlled outside the Vercel invariant.
  return LOCAL_IDENTITY
}

export function resolveRateLimitSecret(runtime: RateLimitRuntime) {
  // The local fallback is deliberately withheld in production: a missing secret
  // must fail closed rather than quietly share one well-known key.
  const secret = runtime.secret ?? (runtime.nodeEnv === 'production' ? undefined : LOCAL_SECRET)
  if (!secret || secret.length < 32) {
    throw new Error('PUBLIC_SCAN_RATE_LIMIT_SECRET must contain at least 32 characters')
  }
  return secret
}

export function deriveRateLimitKey(keyDomain: string, identity: string, secret: string) {
  if (secret.length < 32) throw new Error('Rate limit HMAC secret must contain at least 32 characters')
  const digest = createHmac('sha256', secret)
    .update(keyDomain)
    .update('\0')
    .update(identity)
    .digest('hex')
  return KEY_VERSION + ':' + digest
}

export const consumeFromNeon: DurableRateLimitCounter = async (keyHash, windowSeconds, limit) => {
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

export async function consumeDurableRateLimit(
  req: NextRequest,
  policy: { keyDomain: string; limit: number; windowSeconds: number },
  consume: DurableRateLimitCounter = consumeFromNeon,
  runtime: RateLimitRuntime = defaultRateLimitRuntime(),
) {
  const identity = resolveClientIdentity(req, runtime)
  const keyHash = deriveRateLimitKey(policy.keyDomain, identity, resolveRateLimitSecret(runtime))
  return consume(keyHash, policy.windowSeconds, policy.limit)
}

export function buildRateLimitHeaders(
  limit: number,
  decision: RateLimitDecision,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  const resetDelay = Math.max(0, decision.resetAt - nowSeconds)
  const headers = new Headers({
    'RateLimit-Limit': String(limit),
    'RateLimit-Remaining': String(decision.remaining),
    'RateLimit-Reset': String(resetDelay),
  })
  if (!decision.allowed) headers.set('Retry-After', String(Math.max(1, resetDelay)))
  return headers
}
