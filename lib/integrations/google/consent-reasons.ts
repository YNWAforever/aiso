/**
 * Why a Google consent round-trip was refused. The callback writes these into
 * the return URL and the settings panel translates them, so both import this
 * one list. Deliberately dependency-free: the panel is a client component.
 */
export const CONSENT_ERROR_REASONS = [
  'consent_invalid', 'session_mismatch', 'denied', 'no_refresh_token', 'scope_missing', 'unavailable',
] as const
export type ConsentErrorReason = (typeof CONSENT_ERROR_REASONS)[number]

export function isConsentErrorReason(value: unknown): value is ConsentErrorReason {
  return typeof value === 'string' && (CONSENT_ERROR_REASONS as readonly string[]).includes(value)
}
