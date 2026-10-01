import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isAnalyticsEnabled, isAttributionEnabled, isFeatureEnabled } from '@/lib/flags'

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

describe('analytics flag', () => {
  afterEach(() => { delete process.env.FEATURE_ANALYTICS })

  it('is off by default', () => {
    expect(isFeatureEnabled('analytics')).toBe(false)
  })

  it('turns on only for the exact value 1', () => {
    process.env.FEATURE_ANALYTICS = 'true'
    expect(isFeatureEnabled('analytics')).toBe(false)
    process.env.FEATURE_ANALYTICS = ' 1'
    expect(isFeatureEnabled('analytics')).toBe(false)
    process.env.FEATURE_ANALYTICS = '1'
    expect(isFeatureEnabled('analytics')).toBe(true)
  })
})

// Analytics rides the Google connection Search Console owns: its consent, callback
// and connection routes are gated on FEATURE_SEARCH_CONSOLE, and Settings hides the
// Google panel without it. So analytics counts as on only when both flags are.
describe('isAnalyticsEnabled', () => {
  afterEach(() => {
    delete process.env.FEATURE_ANALYTICS
    delete process.env.FEATURE_SEARCH_CONSOLE
  })

  it('is off by default', () => {
    expect(isAnalyticsEnabled()).toBe(false)
  })

  it('is off with only FEATURE_ANALYTICS on', () => {
    process.env.FEATURE_ANALYTICS = '1'
    expect(isAnalyticsEnabled()).toBe(false)
  })

  it('is off with only FEATURE_SEARCH_CONSOLE on', () => {
    process.env.FEATURE_SEARCH_CONSOLE = '1'
    expect(isAnalyticsEnabled()).toBe(false)
  })

  it('is on only when both are exactly 1', () => {
    process.env.FEATURE_ANALYTICS = '1'
    process.env.FEATURE_SEARCH_CONSOLE = 'true'
    expect(isAnalyticsEnabled()).toBe(false)
    process.env.FEATURE_SEARCH_CONSOLE = '1'
    expect(isAnalyticsEnabled()).toBe(true)
  })
})

// Attribution reads Search Console figures, so it counts as on only when both its
// own flag and FEATURE_SEARCH_CONSOLE are exactly '1'.
describe('attribution flag', () => {
  afterEach(() => { delete process.env.FEATURE_ATTRIBUTION })

  it('is off by default', () => {
    expect(isFeatureEnabled('attribution')).toBe(false)
  })

  it('turns on only for the exact value 1', () => {
    process.env.FEATURE_ATTRIBUTION = 'true'
    expect(isFeatureEnabled('attribution')).toBe(false)
    process.env.FEATURE_ATTRIBUTION = '1'
    expect(isFeatureEnabled('attribution')).toBe(true)
  })
})

describe('isAttributionEnabled', () => {
  afterEach(() => {
    delete process.env.FEATURE_ATTRIBUTION
    delete process.env.FEATURE_SEARCH_CONSOLE
  })

  it('is off when neither flag is set', () => {
    expect(isAttributionEnabled()).toBe(false)
  })

  it('is off with only FEATURE_ATTRIBUTION on', () => {
    process.env.FEATURE_ATTRIBUTION = '1'
    expect(isAttributionEnabled()).toBe(false)
  })

  it('is off with only FEATURE_SEARCH_CONSOLE on', () => {
    process.env.FEATURE_SEARCH_CONSOLE = '1'
    expect(isAttributionEnabled()).toBe(false)
  })

  it('is off when either value is not exactly 1', () => {
    process.env.FEATURE_ATTRIBUTION = 'true'
    process.env.FEATURE_SEARCH_CONSOLE = '1'
    expect(isAttributionEnabled()).toBe(false)
    process.env.FEATURE_ATTRIBUTION = '1'
    process.env.FEATURE_SEARCH_CONSOLE = 'true'
    expect(isAttributionEnabled()).toBe(false)
  })

  it('is on only when both are exactly 1', () => {
    process.env.FEATURE_ATTRIBUTION = '1'
    process.env.FEATURE_SEARCH_CONSOLE = '1'
    expect(isAttributionEnabled()).toBe(true)
  })
})
