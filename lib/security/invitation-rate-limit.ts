import {
  buildRateLimitHeaders,
  consumeFromNeon,
  defaultRateLimitRuntime,
  deriveRateLimitKey,
  resolveRateLimitSecret,
  type DurableRateLimitCounter,
  type RateLimitDecision,
  type RateLimitRuntime,
} from './durable-rate-limit'

/**
 * Ceiling on invitations an ACCOUNT may create.
 *
 * Keyed by account rather than by client address, which is the difference from
 * the other two limiters in this directory. Both of those guard endpoints
 * anyone can reach, so the caller's IP is the only identity available; this one
 * sits behind a session, and the thing worth bounding is not "who is
 * connecting" but "whose allowance is being spent". An account-keyed limit also
 * survives the member moving between networks, and cannot be exhausted by an
 * unrelated account behind the same corporate NAT.
 *
 * It bypasses `consumeDurableRateLimit`, which resolves a client identity from
 * the request and requires `VERCEL=1` in production to trust the forwarded
 * address. None of that applies to an id read from a verified session.
 *
 * Why a limiter at all, when MAX_ACCOUNT_MEMBERS already caps how many
 * invitations can be live: creating one sends mail to an address the caller
 * chose, so the cap bounds concurrency while this bounds throughput. Without
 * it, revoke-and-reinvite is an unbounded relay with somebody else's `from`.
 */
export const INVITATION_LIMIT = 10
export const INVITATION_WINDOW_SECONDS = 60 * 60

// Distinct from the scan and funnel domains, so invitation traffic can never
// consume a caller's scan allowance or vice versa despite sharing the counter
// table. Treat this string as permanent: changing it rehashes every key and
// silently grants every account a fresh allowance.
export const INVITATION_KEY_DOMAIN = 'geoscanner:account-invitations-rate-limit:key:v1'

export function consumeInvitationRateLimit(
  accountId: string,
  consume: DurableRateLimitCounter = consumeFromNeon,
  runtime: RateLimitRuntime = defaultRateLimitRuntime(),
): Promise<RateLimitDecision> {
  const keyHash = deriveRateLimitKey(
    INVITATION_KEY_DOMAIN,
    `account:${accountId}`,
    resolveRateLimitSecret(runtime),
  )
  return consume(keyHash, INVITATION_WINDOW_SECONDS, INVITATION_LIMIT)
}

export function invitationRateLimitHeaders(decision: RateLimitDecision) {
  return buildRateLimitHeaders(INVITATION_LIMIT, decision)
}
