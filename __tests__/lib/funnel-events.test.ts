import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { redactFunnelEvent, logFunnelEvent } from '@/lib/observability/funnel'

const ATTEMPT_ID = '550e8400-e29b-41d4-a716-446655440000'

describe('redactFunnelEvent', () => {
  it('keeps only allowlisted fields and hashes scan identifiers', () => {
    const event = redactFunnelEvent({
      name: 'signup_started', attemptId: ATTEMPT_ID, locale: 'en',
      scanId: 'scan-1', provider: 'google', ignored: 'discarded',
    })

    expect(event).toEqual({
      name: 'signup_started', attemptId: ATTEMPT_ID, locale: 'en', provider: 'google',
      scanHash: createHash('sha256').update('scan-1').digest('hex').slice(0, 16),
    })
  })

  it('rejects user content and unknown enum values', () => {
    expect(redactFunnelEvent({
      name: 'signup_started', attemptId: ATTEMPT_ID, locale: 'en',
      email: 'person@example.com', url: 'https://example.com',
    })).toBeNull()
    expect(redactFunnelEvent({ name: 'unknown', attemptId: ATTEMPT_ID, locale: 'en' })).toBeNull()
    expect(redactFunnelEvent({ name: 'signup_started', attemptId: ATTEMPT_ID, locale: 'en', provider: 'apple' })).toBeNull()
    expect(redactFunnelEvent({ name: 'scan_claim_failed', attemptId: ATTEMPT_ID, locale: 'en', errorCode: 'bad' })).toBeNull()
    expect(redactFunnelEvent({ name: 'scan_completed', attemptId: ATTEMPT_ID, locale: 'en', results: [] })).toBeNull()
    expect(redactFunnelEvent({ name: 'scan_completed', attemptId: ATTEMPT_ID, locale: 'en', competitors: [] })).toBeNull()
  })

  it('rejects sensitive keys nested in unknown objects and arrays', () => {
    expect(redactFunnelEvent({
      name: 'scan_completed', attemptId: ATTEMPT_ID, locale: 'en',
      metadata: { context: { email: 'person@example.com' } },
    })).toBeNull()
    expect(redactFunnelEvent({
      name: 'scan_completed', attemptId: ATTEMPT_ID, locale: 'en',
      metadata: [{ competitors: ['Acme'] }],
    })).toBeNull()
  })

  it('rejects sensitive keys stored in class instances', () => {
    class RequestMetadata {
      email = 'person@example.com'
    }

    expect(redactFunnelEvent({
      name: 'scan_completed', attemptId: ATTEMPT_ID, locale: 'en', metadata: new RequestMetadata(),
    })).toBeNull()
  })

  it('terminates safely and rejects cyclic payloads containing sensitive keys', () => {
    const metadata: Record<string, unknown> = { competitors: ['Acme'] }
    metadata.self = metadata

    expect(redactFunnelEvent({
      name: 'scan_completed', attemptId: ATTEMPT_ID, locale: 'en', metadata,
    })).toBeNull()
  })

  it('logs only the redacted payload', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const result = logFunnelEvent({ name: 'scan_completed', attemptId: ATTEMPT_ID, locale: 'zh-HK', scanId: 'scan-1' })
    expect(result).toBeUndefined()
    expect(info).toHaveBeenCalledWith('[funnel]', JSON.stringify({
      name: 'scan_completed', attemptId: ATTEMPT_ID, locale: 'zh-HK',
      scanHash: createHash('sha256').update('scan-1').digest('hex').slice(0, 16),
    }))
  })

  it.each(['attempt-1', 'person@example.com', 'https://example.com/result/scan-1'])
  ('rejects a non-UUID attempt ID before logging', (attemptId) => {
    expect(redactFunnelEvent({ name: 'scan_completed', attemptId, locale: 'en' })).toBeNull()
  })
})
