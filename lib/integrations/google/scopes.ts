/**
 * OAuth scopes shared by the Google connectors. One Google connection per account
 * carries every grant, so both products name their scopes here instead of each
 * hard-coding a string. This module imports nothing, so `oauth.ts` can re-export
 * from it without a cycle.
 */

export const SEARCH_CONSOLE_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'
export const ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly'

export type GoogleProduct = 'search_console' | 'analytics'

/**
 * What a consent for `product` asks for. Analytics keeps Search Console in the
 * request so that connecting it never narrows the existing grant.
 */
export function scopesFor(product: GoogleProduct): string[] {
  return product === 'analytics' ? [SEARCH_CONSOLE_SCOPE, ANALYTICS_SCOPE] : [SEARCH_CONSOLE_SCOPE]
}

/** Exact match: a scope that is merely a prefix of another is a different scope. */
export function hasScope(scopes: readonly string[], scope: string): boolean {
  return scopes.includes(scope)
}
