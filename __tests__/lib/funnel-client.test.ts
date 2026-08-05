import { describe, expect, it, vi } from 'vitest'
import { trackFunnelEvent } from '@/lib/funnel-client'

describe('trackFunnelEvent', () => {
  it('sends an allowlisted event with a reusable session attempt id', () => {
    const storage = new Map<string, string>()
    const fetchMock = vi.fn(() => Promise.resolve(new Response()))
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    })
    vi.stubGlobal('window', { sessionStorage: globalThis.sessionStorage })
    vi.stubGlobal('fetch', fetchMock)

    trackFunnelEvent({ name: 'signup_started', locale: 'en', provider: 'google' })
    trackFunnelEvent({ name: 'scan_claim_failed', locale: 'en', scanId: 'scan-1', errorCode: 'conflict' })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(storage.get('fimmick_funnel_attempt_id')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      name: 'scan_claim_failed', scanId: 'scan-1', errorCode: 'conflict',
    })
  })

  it('uses a UUID-compatible fallback when randomUUID is unavailable', () => {
    const storage = new Map<string, string>()
    const fetchMock = vi.fn(() => Promise.resolve(new Response()))
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    })
    vi.stubGlobal('window', { sessionStorage: globalThis.sessionStorage })
    vi.stubGlobal('crypto', { getRandomValues: (values: Uint8Array) => values.fill(7) })
    vi.stubGlobal('fetch', fetchMock)

    trackFunnelEvent({ name: 'scan_result_viewed', locale: 'en' })

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).attemptId)
      .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })
})
