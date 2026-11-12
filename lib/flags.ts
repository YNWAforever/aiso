/**
 * Server-side feature flags. Every flag defaults off; a flag turns on only
 * when its FEATURE_<NAME> environment variable is exactly '1'. Never read
 * from client components ??flags gate server-rendered behavior only, per
 * ADR-011's dark-launch requirement.
 */
export type FeatureFlag = 'donor_ui_shell' | 'search_console' | 'pulse_attempts' | 'pulse_grounding' | 'outcome_integrations' | 'closed_loop_visibility' | 'enterprise_os' | 'conversation_studio' | 'conversation_studio_live' | 'conversation_studio_mcp' | 'sme_copilot_ui'

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  if (flag === 'conversation_studio_live' && !isFeatureEnabled('conversation_studio')) return false
  return process.env[`FEATURE_${flag.toUpperCase()}`] === '1'
}

const STUDIO_ROLLOUT_CLIENT = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i

/**
 * Optional per-brand allowlist for the Conversation Studio preview
 * (`STUDIO_ROLLOUT_CLIENT_IDS`, comma separated client UUIDs). Empty means the
 * feature flag alone decides, which is the previous behaviour. When set, only
 * the listed brands get Studio as their default home and may call the Studio
 * pages/APIs; every other brand keeps WorkspaceHome exactly as before. The
 * allowlist exists because the Phase A design required a pilot brand rather than
 * a global default-home switch.
 */
export function conversationStudioRolloutClients(): string[] {
  const raw = process.env.STUDIO_ROLLOUT_CLIENT_IDS
  if (!raw) return []
  return [...new Set(raw.split(',').map(value => value.trim().toLowerCase()).filter(value => STUDIO_ROLLOUT_CLIENT.test(value)))].slice(0, 50)
}

/** Feature flag AND, when an allowlist is configured, this brand being on it. */
export function isConversationStudioEnabled(clientId: string | null | undefined): boolean {
  if (!isFeatureEnabled('conversation_studio')) return false
  const rollout = conversationStudioRolloutClients()
  if (rollout.length === 0) return true
  return typeof clientId === 'string' && rollout.includes(clientId.toLowerCase())
}

/**
 * Phase M2's internal-only MCP surface: its own flag *and* the same Studio
 * rollout, so it can never be served for a brand the Studio itself is not on.
 */
export function isStudioMcpEnabled(clientId: string | null | undefined): boolean {
  return isFeatureEnabled('conversation_studio_mcp') && isConversationStudioEnabled(clientId)
}

/**
 * Whether the sidebar should advertise Studio to everyone. While an allowlist is
 * active it does not: the pilot brand reaches Studio through its own default-home
 * redirect, and other brands must not be shown a door that redirects back.
 */
export function conversationStudioNavEnabled(): boolean {
  return isFeatureEnabled('conversation_studio') && conversationStudioRolloutClients().length === 0
}

/**
 * The approved SME copilot IA (2026-11-12): five sidebar destinations, a brand
 * Today home and the account menu. Server-only like every flag; pages pass the
 * result down, client components never read FEATURE_* env vars themselves.
 */
export function isSmeCopilotUiEnabled(): boolean {
  return isFeatureEnabled('sme_copilot_ui')
}
