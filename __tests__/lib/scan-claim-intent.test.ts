import { afterEach, describe, expect, it, vi } from 'vitest'
import { signScanClaimIntent, verifyScanClaimIntent } from '@/lib/security/scan-claim-intent'

describe('scan claim intent', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('round-trips a valid intent and uses a 15-minute expiry', () => {
    vi.stubEnv('REPORT_SHARE_SECRET', 'x'.repeat(32))
    const now = 1_700_000_000_000
    const token = signScanClaimIntent(
      { scanId: 'scan-1', lang: 'en', returnPath: '/en/result/scan-1?claim=1', attemptId: 'attempt-1' },
      now,
    )

    expect(verifyScanClaimIntent(token, now)).toMatchObject({
      scanId: 'scan-1', lang: 'en', returnPath: '/en/result/scan-1?claim=1', attemptId: 'attempt-1',
      exp: now + 15 * 60 * 1000,
    })
  })

  it('rejects a tampered signature', () => {
    vi.stubEnv('REPORT_SHARE_SECRET', 'x'.repeat(32))
    const now = 1_700_000_000_000
    const token = signScanClaimIntent(
      { scanId: 'scan-1', lang: 'zh-HK', returnPath: '/zh-HK/result/scan-1?claim=1', attemptId: 'attempt-1' },
      now,
    )

    expect(verifyScanClaimIntent(token.slice(0, -1) + 'A', now)).toBeNull()
  })

  it('rejects an expired token', () => {
    vi.stubEnv('REPORT_SHARE_SECRET', 'x'.repeat(32))
    const now = 1_700_000_000_000
    const token = signScanClaimIntent(
      { scanId: 'scan-1', lang: 'zh-HK', returnPath: '/zh-HK/result/scan-1?claim=1', attemptId: 'attempt-1' },
      now,
    )

    expect(verifyScanClaimIntent(token, now + 15 * 60 * 1000 + 1)).toBeNull()
  })

  it('fails closed when REPORT_SHARE_SECRET is absent or too short', () => {
    vi.stubEnv('REPORT_SHARE_SECRET', '')

    expect(() => signScanClaimIntent({
      scanId: 'scan-1', lang: 'en', returnPath: '/en/result/scan-1?claim=1', attemptId: 'attempt-1',
    })).toThrow('REPORT_SHARE_SECRET')
  })
})
