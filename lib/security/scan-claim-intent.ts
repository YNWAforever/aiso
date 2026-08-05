import { createHmac, timingSafeEqual } from 'node:crypto'
import { normalizeAuthNext } from '@/lib/auth-navigation'
import { shareSigningSecret } from '@/lib/security/share-secret'

export type ScanClaimIntent = {
  scanId: string
  lang: 'en' | 'zh-HK'
  returnPath: string
  attemptId: string
  exp: number
}

export const CLAIM_INTENT_COOKIE = 'fimmick_scan_claim_intent'

const TTL_MS = 15 * 60 * 1000
const DOMAIN = 'fimmick-scan-claim-intent:v1'
const SIGNATURE_LENGTH = 43

const claimIntentSecret = shareSigningSecret

function canonical(payload: ScanClaimIntent) {
  return `${DOMAIN}:${payload.scanId}:${payload.lang}:${payload.returnPath}:${payload.attemptId}:${payload.exp}`
}

function isValidIntent(payload: unknown): payload is ScanClaimIntent {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false
  const intent = payload as Record<string, unknown>
  if (typeof intent.scanId !== 'string' || intent.scanId.length === 0) return false
  if (intent.lang !== 'en' && intent.lang !== 'zh-HK') return false
  if (
    typeof intent.returnPath !== 'string'
    || normalizeAuthNext(intent.lang, intent.returnPath) !== intent.returnPath
  ) return false
  if (typeof intent.attemptId !== 'string' || intent.attemptId.length === 0) return false
  return typeof intent.exp === 'number' && Number.isSafeInteger(intent.exp)
}

function signature(payload: ScanClaimIntent, secret: string) {
  return createHmac('sha256', secret).update(canonical(payload)).digest('base64url')
}

export function signScanClaimIntent(input: Omit<ScanClaimIntent, 'exp'>, nowMs = Date.now()): string {
  const payload = { ...input, exp: nowMs + TTL_MS }
  if (!isValidIntent(payload)) throw new Error('Invalid scan claim intent')
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${encodedPayload}.${signature(payload, claimIntentSecret())}`
}

export function verifyScanClaimIntent(token: string, nowMs = Date.now()): ScanClaimIntent | null {
  const [encodedPayload, encodedSignature, ...rest] = token.split('.')
  if (
    !encodedPayload
    || !encodedSignature
    || rest.length !== 0
    || !new RegExp(`^[A-Za-z0-9_-]{${SIGNATURE_LENGTH}}$`).test(encodedSignature)
  ) return null

  let payload: unknown
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!isValidIntent(payload) || payload.exp <= nowMs) return null

  let expected: Buffer
  let received: Buffer
  try {
    expected = Buffer.from(signature(payload, claimIntentSecret()), 'base64url')
    received = Buffer.from(encodedSignature, 'base64url')
  } catch {
    return null
  }
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null
  return payload
}
