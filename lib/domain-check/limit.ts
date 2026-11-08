import { consumeFromNeon, defaultRateLimitRuntime, deriveRateLimitKey, resolveRateLimitSecret } from '@/lib/security/durable-rate-limit'

/** A member checking a mistyped domain a few times must not hit a wall. */
export const DOMAIN_CHECK_LIMIT = 20

/** Shared across sessions and instances. Failed checks also consume allowance. */
export function consumeDomainCheckLimit(accountId: string) {
  // The key-domain string predates the move out of onboarding and is deliberately
  // unchanged: it is mixed into the HMAC, so renaming it would grant every caller
  // a fresh hourly allowance. Treat it as permanent (see durable-rate-limit.ts).
  const key = deriveRateLimitKey('aiso:onboarding-domain-check:v1', `account:${accountId}`, resolveRateLimitSecret(defaultRateLimitRuntime()))
  return consumeFromNeon(key, 3600, DOMAIN_CHECK_LIMIT)
}
