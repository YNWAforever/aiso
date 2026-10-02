/**
 * Server-side feature flags. Every flag defaults off; a flag turns on only
 * when its FEATURE_<NAME> environment variable is exactly '1'. Never read
 * from client components — flags gate server-rendered behavior only, per
 * ADR-011's dark-launch requirement.
 */
export type FeatureFlag = 'donor_ui_shell' | 'search_console' | 'analytics' | 'attribution'

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return process.env[`FEATURE_${flag.toUpperCase()}`] === '1'
}

/**
 * GA4 conversions is on only when BOTH FEATURE_ANALYTICS and
 * FEATURE_SEARCH_CONSOLE are '1'. It rides the Google connection Search Console
 * owns: the consent start and callback and the connection routes gate on the
 * Search Console guard, and Settings shows the Google panel only with that flag,
 * so analytics alone would be a panel nobody can connect. Every analytics gate
 * reads this, never isFeatureEnabled('analytics') on its own.
 */
export function isAnalyticsEnabled(): boolean {
  return isFeatureEnabled('analytics') && isFeatureEnabled('search_console')
}

/**
 * Attribution is on only when BOTH FEATURE_ATTRIBUTION and FEATURE_SEARCH_CONSOLE
 * are '1'. It compares the Search Console figures the connector syncs, so with
 * the connector dark there is nothing to attribute. Every attribution gate reads
 * this, never isFeatureEnabled('attribution') on its own.
 */
export function isAttributionEnabled(): boolean {
  return isFeatureEnabled('attribution') && isFeatureEnabled('search_console')
}
