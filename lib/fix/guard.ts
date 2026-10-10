import { getProfile } from '@/lib/auth'
import { resolveCommercialEntitlement } from '@/lib/tier'
import {
  buildRateLimitHeaders,
  consumeFromNeon,
  defaultRateLimitRuntime,
  deriveRateLimitKey,
  resolveRateLimitSecret,
  type DurableRateLimitCounter,
  type RateLimitRuntime,
} from '@/lib/security/durable-rate-limit'

/**
 * The gate for the paid AI tools under /api/fix.
 *
 * Every call here is an OpenRouter request (Sonnet for the content brief and
 * cluster map) and the brief also writes a row, yet the routes checked only
 * that a session existed — a free or cancelled account could call them in a
 * loop. pulse/suggest-questions found and fixed the same hole. The shape copies
 * lib/localTrust/guard.ts: auth → entitlement here, ownership in the route,
 * then the allowance immediately before the model call, so a 404 never spends
 * one.
 */

/** Paid-tool generations per account per day, shared across all four tools. */
export const AI_TOOL_DAILY_LIMIT = 20
const AI_TOOL_WINDOW_SECONDS = 24 * 60 * 60
// Distinct from the scan and funnel domains, so these can never consume a
// caller's scan allowance despite sharing the counter table.
const AI_TOOL_KEY_DOMAIN = 'aiso:ai-tools-account:key:v1'

type Denied = { ok: false; response: Response }
export type AiToolAccess = { ok: true; accountId: string } | Denied

/**
 * Signed in, and — when `paidOnly` — on a paid plan as resolved by
 * resolveCommercialEntitlement, so cancelled, past-due and expired-trial
 * accounts are refused as free. The Fix Pack passes `paidOnly: false`: it is
 * what a newly signed-in visitor unlocks for the scan they just ran.
 */
export async function authorizeAiTool({ paidOnly }: { paidOnly: boolean }): Promise<AiToolAccess> {
  // Not wrapped: a session-store outage must surface as a 500, not a 401.
  const profile = await getProfile()
  if (!profile) return { ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) }

  if (paidOnly) {
    const { plan } = resolveCommercialEntitlement(profile.accounts)
    if (plan === 'free') {
      return {
        ok: false,
        response: Response.json({ error: 'UPGRADE_REQUIRED', feature: 'ai_content_tools', plan }, { status: 403 }),
      }
    }
  }
  return { ok: true, accountId: profile.account_id }
}

/**
 * Spends one generation from the account's daily allowance. Returns null when
 * the caller may proceed, otherwise the response to send. Fails closed: if the
 * counter cannot be read, paid spend does not happen.
 */
export async function consumeAiToolAllowance(
  accountId: string,
  consume: DurableRateLimitCounter = consumeFromNeon,
  runtime: RateLimitRuntime = defaultRateLimitRuntime(),
): Promise<Response | null> {
  let decision
  try {
    const key = deriveRateLimitKey(AI_TOOL_KEY_DOMAIN, accountId, resolveRateLimitSecret(runtime))
    decision = await consume(key, AI_TOOL_WINDOW_SECONDS, AI_TOOL_DAILY_LIMIT)
  } catch (error) {
    console.error('[ai-tools] allowance check failed:', (error as Error)?.name ?? 'Error')
    return Response.json({ error: 'AI tool allowance unavailable' }, { status: 503 })
  }
  if (decision.allowed) return null
  return Response.json(
    { error: 'AI_TOOL_LIMIT_REACHED' },
    { status: 429, headers: buildRateLimitHeaders(AI_TOOL_DAILY_LIMIT, decision) },
  )
}
