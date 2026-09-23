import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isFeatureEnabled } from '@/lib/flags'

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
