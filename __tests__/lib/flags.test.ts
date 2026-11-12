import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { conversationStudioNavEnabled, conversationStudioRolloutClients, isConversationStudioEnabled, isFeatureEnabled, isSmeCopilotUiEnabled } from '@/lib/flags'

describe('conversation_studio flag', () => {
  afterEach(() => vi.unstubAllEnvs())
  it.each([undefined, '', '0', 'true', '1 ', '1'])('enables only the exact value 1 (%s)', value => {
    vi.stubEnv('FEATURE_CONVERSATION_STUDIO', value)
    expect(isFeatureEnabled('conversation_studio')).toBe(value === '1')
  })
})

describe('isFeatureEnabled', () => {
  const envKey = 'FEATURE_DONOR_UI_SHELL'
  let original: string | undefined

  beforeEach(() => {
    original = process.env[envKey]
  })

  afterEach(() => {
    if (original === undefined) delete process.env[envKey]
    else process.env[envKey] = original
  })

  it('defaults to off when the env var is unset', () => {
    delete process.env[envKey]
    expect(isFeatureEnabled('donor_ui_shell')).toBe(false)
  })

  it('defaults to off for any value other than exactly "1"', () => {
    process.env[envKey] = 'true'
    expect(isFeatureEnabled('donor_ui_shell')).toBe(false)
  })

  it('turns on only when the env var is exactly "1"', () => {
    process.env[envKey] = '1'
    expect(isFeatureEnabled('donor_ui_shell')).toBe(true)
  })
})

describe('search_console flag', () => {
  afterEach(() => { delete process.env.FEATURE_SEARCH_CONSOLE })

  it('is off by default', () => {
    expect(isFeatureEnabled('search_console')).toBe(false)
  })

  it('turns on only for the exact value 1', () => {
    process.env.FEATURE_SEARCH_CONSOLE = 'true'
    expect(isFeatureEnabled('search_console')).toBe(false)
    process.env.FEATURE_SEARCH_CONSOLE = '1'
    expect(isFeatureEnabled('search_console')).toBe(true)
  })
})

describe('conversation studio per-brand rollout allowlist', () => {
  const brand = 'ad73afa0-15ad-4790-8a7b-000f7efbec25'
  const other = '00000000-0000-4000-8000-000000000101'
  afterEach(() => vi.unstubAllEnvs())

  it('is brand-agnostic while no allowlist is configured (previous behaviour)', () => {
    vi.stubEnv('FEATURE_CONVERSATION_STUDIO', '1')
    expect(conversationStudioRolloutClients()).toEqual([])
    expect(isConversationStudioEnabled(brand)).toBe(true)
    expect(isConversationStudioEnabled(other)).toBe(true)
    expect(isConversationStudioEnabled(null)).toBe(true)
    expect(conversationStudioNavEnabled()).toBe(true)
  })

  it('narrows the pilot to listed brands and hides the global nav entry', () => {
    vi.stubEnv('FEATURE_CONVERSATION_STUDIO', '1')
    vi.stubEnv('STUDIO_ROLLOUT_CLIENT_IDS', ` ${brand} , not-a-uuid, ${brand} `)
    expect(conversationStudioRolloutClients()).toEqual([brand])
    expect(isConversationStudioEnabled(brand)).toBe(true)
    expect(isConversationStudioEnabled(other)).toBe(false)
    expect(isConversationStudioEnabled(undefined)).toBe(false)
    expect(conversationStudioNavEnabled()).toBe(false)
  })

  it('stays off for every brand when the feature flag is off, whatever the allowlist says', () => {
    vi.stubEnv('FEATURE_CONVERSATION_STUDIO', '0')
    vi.stubEnv('STUDIO_ROLLOUT_CLIENT_IDS', brand)
    expect(isConversationStudioEnabled(brand)).toBe(false)
    expect(conversationStudioNavEnabled()).toBe(false)
  })
})

describe('sme_copilot_ui flag', () => {
  it('defaults off and turns on only for exactly "1"', () => {
    expect(isSmeCopilotUiEnabled()).toBe(false)
    for (const value of ['0', 'true', '1 ', '']) {
      vi.stubEnv('FEATURE_SME_COPILOT_UI', value)
      expect(isSmeCopilotUiEnabled(), value).toBe(false)
    }
    vi.stubEnv('FEATURE_SME_COPILOT_UI', '1')
    expect(isSmeCopilotUiEnabled()).toBe(true)
  })
})
