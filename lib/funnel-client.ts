'use client'

export const FUNNEL_EVENTS = [
  'scan_completed', 'scan_result_viewed', 'signup_cta_viewed',
  'signup_started', 'signup_succeeded', 'scan_claim_succeeded',
  'scan_claim_failed', 'scan_retry_clicked',
] as const

export type FunnelEventName = typeof FUNNEL_EVENTS[number]
export type FunnelEventInput = {
  name: FunnelEventName
  attemptId: string
  locale: 'en' | 'zh-HK'
  scanId?: string
  provider?: 'google' | 'magic_link'
  errorCode?: 'not_found' | 'conflict' | 'unauthorized' | 'rate_limited' | 'temporary'
}

const ATTEMPT_ID_KEY = 'fimmick_funnel_attempt_id'

function fallbackAttemptId() {
  const bytes = new Uint8Array(16)
  globalThis.crypto?.getRandomValues?.(bytes)
  if (!globalThis.crypto?.getRandomValues) {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function getAttemptId() {
  const existing = window.sessionStorage.getItem(ATTEMPT_ID_KEY)
  if (existing) return existing
  const attemptId = globalThis.crypto?.randomUUID?.() ?? fallbackAttemptId()
  window.sessionStorage.setItem(ATTEMPT_ID_KEY, attemptId)
  return attemptId
}

export function trackFunnelEvent(input: Omit<FunnelEventInput, 'attemptId'>): void {
  if (typeof window === 'undefined') return
  try {
    void fetch('/api/funnel-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, attemptId: getAttemptId() }),
      keepalive: true,
    }).catch(() => undefined)
  } catch {
    // Analytics must never interrupt the user journey.
  }
}
