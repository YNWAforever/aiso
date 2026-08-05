import { describe, expect, it } from 'vitest'
import {
  buildScanClaimNext,
  classifyClaimResponse,
  getClaimReturnFunnelEvents,
} from '@/components/result/ClaimScanOnReturn'

describe('scan claim return', () => {
  it.each([
    ['en', 'scan-123', '/en/result/scan-123?claim=1'],
    ['zh-HK', 'scan-123', '/zh-HK/result/scan-123?claim=1'],
    ['en', 'scan / 123', '/en/result/scan%20%2F%20123?claim=1'],
  ])('builds the result return target for %s', (lang, scanId, expected) => {
    expect(buildScanClaimNext(lang, scanId)).toBe(expected)
  })

  it.each([
    [200, { ok: true, alreadyOwned: false }, 'claimed'],
    [200, { ok: true, alreadyOwned: true }, 'already-owned'],
    [404, { error: 'Scan not found' }, 'not-found'],
    [409, { error: 'Scan belongs to another account' }, 'conflict'],
    [500, { error: 'Failed to claim scan' }, 'error'],
    [200, { ok: false }, 'error'],
    [401, { error: 'Unauthorized' }, 'unauthorized'],
    [403, { error: 'Forbidden' }, 'unauthorized'],
  ] as const)('classifies claim response %s', (status, body, expected) => {
    expect(classifyClaimResponse(status, body)).toBe(expected)
  })
  it.each([
    [200, { ok: true, alreadyOwned: false }, ['signup_succeeded', 'scan_claim_succeeded']],
    [409, { error: 'Scan belongs to another account' }, ['signup_succeeded', 'scan_claim_failed']],
    [500, { error: 'Failed to claim scan' }, ['signup_succeeded', 'scan_claim_failed']],
    [401, { error: 'Unauthorized' }, ['scan_claim_failed']],
    [403, { error: 'Claim unavailable' }, ['scan_claim_failed']],
  ] as const)('keeps authenticated signup completion separate from claim outcome for %s', (status, body, expected) => {
    expect(getClaimReturnFunnelEvents(status, body)).toEqual(expected)
  })
})
