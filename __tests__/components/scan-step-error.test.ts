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
