import { describe, expect, it } from 'vitest'
import { getDashboardScanErrorKey } from '@/components/dashboard/ScanStep'

describe('dashboard scan errors', () => {
  it('translates an unreachable site instead of showing the server code', () => {
    expect(getDashboardScanErrorKey(422, { error: 'SCAN_UNREACHABLE' })).toBe('scan_unreachable')
  })

  it('leaves every other response to the existing handling', () => {
    expect(getDashboardScanErrorKey(422, { error: 'something else' })).toBeNull()
    expect(getDashboardScanErrorKey(500, { error: 'SCAN_UNREACHABLE' })).toBeNull()
    expect(getDashboardScanErrorKey(422, null)).toBeNull()
  })
})

describe('dashboard scan plan limits', () => {
  it('turns the two plan-limit answers into an upgrade prompt, never a raw code', async () => {
    const { scanLimitFrom } = await import('@/components/dashboard/ScanStep')
    expect(scanLimitFrom(429, { error: 'AUTHENTICATED_SCAN_LIMIT_REACHED' })).toBe('scansOut')
    expect(scanLimitFrom(403, { error: 'AUTHENTICATED_SCAN_UPGRADE_REQUIRED' })).toBe('free')
    // A public rate limit is not a plan limit.
    expect(scanLimitFrom(429, { error: 'Too many scan requests. Please try again later.' })).toBeNull()
    expect(scanLimitFrom(500, null)).toBeNull()
  })
})
