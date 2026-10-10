/**
 * Server-side feature flags. Every flag defaults off; a flag turns on only
 * when its FEATURE_<NAME> environment variable is exactly '1'. Never read
 * from client components — flags gate server-rendered behavior only, per
 * ADR-011's dark-launch requirement.
 */
export type FeatureFlag = 'donor_ui_shell' | 'search_console' | 'pulse_attempts' | 'pulse_grounding'

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return process.env[`FEATURE_${flag.toUpperCase()}`] === '1'
}
