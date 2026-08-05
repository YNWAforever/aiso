import { createHash } from 'node:crypto'

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

const SENSITIVE_KEYS = new Set(['email', 'url', 'results', 'competitors'])
const PROVIDERS = new Set<FunnelEventInput['provider']>(['google', 'magic_link'])
const ERROR_CODES = new Set<NonNullable<FunnelEventInput['errorCode']>>([
  'not_found', 'conflict', 'unauthorized', 'rate_limited', 'temporary',
])

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function containsSensitiveKey(value: unknown, visited = new WeakSet<object>()): boolean {
  if (!value || typeof value !== 'object') return false
  if (visited.has(value)) return false
  visited.add(value)

  if (Array.isArray(value)) return value.some(item => containsSensitiveKey(item, visited))

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false

  return Object.entries(value).some(([key, nestedValue]) => (
    SENSITIVE_KEYS.has(key) || containsSensitiveKey(nestedValue, visited)
  ))
}

export function redactFunnelEvent(input: unknown): Record<string, string> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const candidate = input as Record<string, unknown>
  if (containsSensitiveKey(candidate)) return null
  if (
    !FUNNEL_EVENTS.includes(candidate.name as FunnelEventName)
    || !isNonEmptyString(candidate.attemptId)
    || (candidate.locale !== 'en' && candidate.locale !== 'zh-HK')
  ) return null
  if (candidate.provider !== undefined && (!isNonEmptyString(candidate.provider) || !PROVIDERS.has(candidate.provider as FunnelEventInput['provider']))) return null
  if (candidate.errorCode !== undefined && (!isNonEmptyString(candidate.errorCode) || !ERROR_CODES.has(candidate.errorCode as NonNullable<FunnelEventInput['errorCode']>))) return null
  if (candidate.scanId !== undefined && !isNonEmptyString(candidate.scanId)) return null

  const redacted: Record<string, string> = {
    name: candidate.name as string,
    attemptId: candidate.attemptId,
    locale: candidate.locale,
  }
  if (candidate.scanId) redacted.scanHash = createHash('sha256').update(candidate.scanId).digest('hex').slice(0, 16)
  if (candidate.provider) redacted.provider = candidate.provider
  if (candidate.errorCode) redacted.errorCode = candidate.errorCode
  return redacted
}

export function logFunnelEvent(input: unknown): Record<string, string> | null {
  const redacted = redactFunnelEvent(input)
  if (redacted) console.info('[funnel]', JSON.stringify(redacted))
  return redacted
}
