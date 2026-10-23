'use client'

export const ONBOARDING_EVENTS = ['onboarding_started','brand_draft_requested','brand_draft_reviewed','onboarding_manual_selected','onboarding_completed'] as const

export const FUNNEL_EVENTS = [
  ...ONBOARDING_EVENTS,
  'scan_completed', 'scan_result_viewed', 'signup_cta_viewed',
  'signup_started', 'signup_succeeded', 'scan_claim_succeeded',
  'scan_claim_failed', 'scan_retry_clicked',
  // Phase 7: what happens after the result. Same redacted fields, no new ones.
  'fix_opened', 'report_published', 'report_link_copied', 'report_pdf_downloaded',
  'upgrade_prompt_viewed', 'upgrade_prompt_clicked',
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

export function consumeOneTimeFunnelEvent(guard: { current: boolean }): boolean {
  if (guard.current) return false
  guard.current = true
  return true
}

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
  if (typeof window === 'undefined' || !FUNNEL_EVENTS.includes(input.name) || !['en','zh-HK'].includes(input.locale)) return
  try {
    void fetch('/api/funnel-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ONBOARDING_EVENTS.includes(input.name as typeof ONBOARDING_EVENTS[number])?{name:input.name,locale:input.locale,attemptId:getAttemptId()}:{name:input.name,locale:input.locale,attemptId:getAttemptId(),...(input.scanId?{scanId:input.scanId}:{}),...(input.provider?{provider:input.provider}:{}),...(input.errorCode?{errorCode:input.errorCode}:{})}),
      keepalive: true,
    }).catch(() => undefined)
  } catch {
    // Analytics must never interrupt the user journey.
  }
}
