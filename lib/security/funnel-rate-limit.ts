import type { NextRequest } from 'next/server'
import {
  buildRateLimitHeaders,
  consumeDurableRateLimit,
  consumeFromNeon,
  defaultRateLimitRuntime,
  type DurableRateLimitCounter,
  type RateLimitDecision,
  type RateLimitRuntime,
} from './durable-rate-limit'

/**
 * Ceiling for /api/funnel-events, which is unauthenticated and appends a log
 * line per request.
 *
 * Deliberately far above the scan limiter's 5: lib/funnel-client.ts defines 8
 * event names, several of them one-time-guarded, so a real session emits well
 * under ~15 — but shared egress (corporate NAT, carrier CGNAT) puts many
 * sessions behind one address. 120 leaves ordinary traffic untouched while
 * still bounding a flood to 120 log lines per address per window.
 */
export const FUNNEL_EVENT_LIMIT = 120
export const FUNNEL_EVENT_WINDOW_SECONDS = 10 * 60

// Distinct from the scan domain, so funnel traffic can never consume a caller's
// scan allowance (or vice versa) despite sharing the counter table.
export const FUNNEL_EVENT_KEY_DOMAIN = 'geoscanner:funnel-events-rate-limit:key:v1'

export function consumeFunnelEventRateLimit(
  req: NextRequest,
  consume: DurableRateLimitCounter = consumeFromNeon,
  runtime: RateLimitRuntime = defaultRateLimitRuntime(),
) {
  return consumeDurableRateLimit(
    req,
    {
      keyDomain: FUNNEL_EVENT_KEY_DOMAIN,
      limit: FUNNEL_EVENT_LIMIT,
      windowSeconds: FUNNEL_EVENT_WINDOW_SECONDS,
    },
    consume,
    runtime,
  )
}

export function funnelEventRateLimitHeaders(decision: RateLimitDecision) {
  return buildRateLimitHeaders(FUNNEL_EVENT_LIMIT, decision)
}
