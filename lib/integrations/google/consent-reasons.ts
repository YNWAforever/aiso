/**
 * Why a Google consent round-trip was refused. The callback writes these into
 * the return URL and the settings panel translates them, so both import this
 * one list. Deliberately dependency-free: the panel is a client component.
 */
export const CONSENT_ERROR_REASONS = [
  'consent_invalid', 'session_mismatch', 'denied', 'no_refresh_token', 'scope_missing', 'unavailable',
  'analytics_not_granted', 'search_console_not_granted',
] as const
export type ConsentErrorReason = (typeof CONSENT_ERROR_REASONS)[number]

export function isConsentErrorReason(value: unknown): value is ConsentErrorReason {
  return typeof value === 'string' && (CONSENT_ERROR_REASONS as readonly string[]).includes(value)
}

/**
 * The refusal the callback wrote into a page's return URL (`?google=error&reason=…`),
 * or null. Only a reason the callback itself generates is ever shown: anything
 * else, including a hand-edited query, is ignored. Settings and the brand's
 * assets page (where the analytics grant returns) both read it this way.
 */
export function consentErrorFrom(search: Record<string, string | string[] | undefined>): ConsentErrorReason | null {
  const reason = search.google === 'error' ? search.reason : undefined
  return isConsentErrorReason(reason) ? reason : null
}
