import { afterEach, describe, expect, it } from 'vitest'
import { multiSourceEnabled } from '@/lib/work-items/multi-source-flag'

const ENV_KEY = 'WORK_ITEM_MULTI_SOURCE_V1'

describe('multiSourceEnabled', () => {
  afterEach(() => { delete process.env[ENV_KEY] })

  it('is off when unset', () => {
    delete process.env[ENV_KEY]
    expect(multiSourceEnabled()).toBe(false)
  })

  it('is off for any value other than the exact string "1"', () => {
    // A truthy-looking value like "true" or "yes" must not accidentally turn
    // this on -- the one deployment convention this repo actually checks
    // against ("1") is the only value that counts.
    for (const value of ['true', 'yes', 'TRUE', '0', ' 1', '']) {
      process.env[ENV_KEY] = value
      expect(multiSourceEnabled(), `value ${JSON.stringify(value)} should not enable it`).toBe(false)
    }
  })

  it('is on for exactly "1"', () => {
    process.env[ENV_KEY] = '1'
    expect(multiSourceEnabled()).toBe(true)
  })
})
