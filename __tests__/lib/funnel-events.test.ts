import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { redactFunnelEvent, logFunnelEvent } from '@/lib/observability/funnel'

describe('redactFunnelEvent', () => {
  it('keeps only allowlisted fields and hashes scan identifiers', () => {
    const event = redactFunnelEvent({
      name: 'signup_started', attemptId: 'attempt-1', locale: 'en',
      scanId: 'scan-1', provider: 'google', ignored: 'discarded',
    })

    expect(event).toEqual({
      name: 'signup_started', attemptId: 'attempt-1', locale: 'en', provider: 'google',
      scanHash: createHash('sha256').update('scan-1').digest('hex').slice(0, 16),
    })
  })

  it('rejects user content and unknown enum values', () => {
    expect(redactFunnelEvent({
      name: 'signup_started', attemptId: 'attempt-1', locale: 'en',
      email: 'person@example.com', url: 'https://example.com',
    })).toBeNull()
    expect(redactFunnelEvent({ name: 'unknown', attemptId: 'attempt-1', locale: 'en' })).toBeNull()
    expect(redactFunnelEvent({ name: 'signup_started', attemptId: 'attempt-1', locale: 'en', provider: 'apple' })).toBeNull()
    expect(redactFunnelEvent({ name: 'scan_claim_failed', attemptId: 'attempt-1', locale: 'en', errorCode: 'bad' })).toBeNull()
    expect(redactFunnelEvent({ name: 'scan_completed', attemptId: 'attempt-1', locale: 'en', results: [] })).toBeNull()
    expect(redactFunnelEvent({ name: 'scan_completed', attemptId: 'attempt-1', locale: 'en', competitors: [] })).toBeNull()
  })

  it('logs only the redacted payload', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    logFunnelEvent({ name: 'scan_completed', attemptId: 'attempt-1', locale: 'zh-HK', scanId: 'scan-1' })
    expect(info).toHaveBeenCalledWith('[funnel]', JSON.stringify({
      name: 'scan_completed', attemptId: 'attempt-1', locale: 'zh-HK',
      scanHash: createHash('sha256').update('scan-1').digest('hex').slice(0, 16),
    }))
  })
})
