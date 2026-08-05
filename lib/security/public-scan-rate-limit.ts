import type { NextRequest } from 'next/server'
import {
  buildRateLimitHeaders,
  consumeFromNeon,
  defaultRateLimitRuntime,
  deriveRateLimitKey,
  resolveClientIdentity,
  resolveRateLimitSecret,
  type DurableRateLimitCounter,
  type RateLimitDecision,
  type RateLimitRuntime,
} from './durable-rate-limit'

export type { DurableRateLimitCounter, RateLimitDecision }
export type PublicScanRateLimitRuntime = RateLimitRuntime

export const PUBLIC_SCAN_LIMIT = 5
export const PUBLIC_SCAN_WINDOW_SECONDS = 10 * 60

/**
 * Mixed into the HMAC that produces every stored key. It is effectively a
 * schema version for the live counter table: change this string and every
 * existing key rehashes, silently handing every rate-limited caller in
 * production a brand-new allowance. It is pinned by a test for that reason.
 */
export const PUBLIC_SCAN_KEY_DOMAIN = 'geoscanner:public-scan-rate-limit:key:v1'

export function derivePublicScanRateLimitKey(identity: string, secret: string) {
  return deriveRateLimitKey(PUBLIC_SCAN_KEY_DOMAIN, identity, secret)
}

export async function consumePublicScanRateLimit(
  req: NextRequest,
  consume: DurableRateLimitCounter = consumeFromNeon,
  runtime: PublicScanRateLimitRuntime = defaultRateLimitRuntime(),
) {
  const identity = resolveClientIdentity(req, runtime)
  const keyHash = derivePublicScanRateLimitKey(identity, resolveRateLimitSecret(runtime))
  return consume(keyHash, PUBLIC_SCAN_WINDOW_SECONDS, PUBLIC_SCAN_LIMIT)
}

export function rateLimitHeaders(decision: RateLimitDecision, nowSeconds = Math.floor(Date.now() / 1000)) {
  return buildRateLimitHeaders(PUBLIC_SCAN_LIMIT, decision, nowSeconds)
}
