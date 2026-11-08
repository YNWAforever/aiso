/**
 * Caps for a brand's competitor list, shared by onboarding, the dashboard
 * editor and the classifier. Client-safe on purpose: the onboarding wizard
 * imports it to size its input, so this module must stay free of server
 * imports (no `@/lib/db`, no `server-only`).
 *
 * MAX_COMPETITORS is the classifier's own cap — lib/pulse/analysis-fallback.ts
 * slices to 10. A writer that accepts more than this stores names that are
 * never matched, so every writer refuses the extra one instead.
 */
export const MAX_COMPETITORS = 10
export const MAX_ALIASES = 5
export const MAX_DOMAINS = 5
export const MAX_NAME_LENGTH = 120
