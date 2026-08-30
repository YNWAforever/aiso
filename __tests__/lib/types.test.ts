import { describe, expect, it } from 'vitest'
import { SCANNER_VERSION, type ScanVersionInfo } from '@/lib/types'

describe('versioning contract', () => {
  it('exposes a dated scanner version', () => {
    expect(SCANNER_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.v\d+$/)
  })

  it('shapes ScanVersionInfo with both identifiers', () => {
    const info: ScanVersionInfo = {
      scannerVersion: SCANNER_VERSION,
      methodologyVersion: '2026-08-26.v1',
    }
    expect(info.scannerVersion).toBe(SCANNER_VERSION)
  })
})
