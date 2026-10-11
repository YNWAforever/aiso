import { consumeFromNeon, defaultRateLimitRuntime, deriveRateLimitKey, resolveRateLimitSecret } from '@/lib/security/durable-rate-limit'
export const ASSISTANT_LIMIT = 5
/** Shared across sessions and instances. Failed attempts also consume allowance. */
export function consumeAssistantLimit(accountId: string) {
  const key = deriveRateLimitKey('aiso:onboarding-assistant:v1', `account:${accountId}`, resolveRateLimitSecret(defaultRateLimitRuntime()))
  return consumeFromNeon(key, 3600, ASSISTANT_LIMIT)
}
