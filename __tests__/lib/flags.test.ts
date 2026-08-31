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
