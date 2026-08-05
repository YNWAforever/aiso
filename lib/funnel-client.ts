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

function getAttemptId() {
  const existing = window.sessionStorage.getItem(ATTEMPT_ID_KEY)
  if (existing) return existing
  const attemptId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
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
