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

/**
 * The single authority on whether a caller may claim a scan.
 *
 * An ABSENT cookie is a denial, never a bypass. The intent is the only thing
 * tying the caller to a scan they actually ran and saw: it is minted by
 * /api/scans/[id]/claim-intent, which is rate limited and refuses a scan that
 * already belongs to an account. Treating "no cookie" as "unconstrained" let any
 * authenticated session POST any unowned scan id and take a stranger's public
 * scan, so both claim paths route through this one predicate rather than each
 * re-deriving the rule.
 *
 * A verified email still does not prove website ownership: this authorises
 * attaching a public scan to a workspace, not privileged control of the domain.
 */
export function isAuthorizedScanClaim(token: string | undefined, scanId: string, nowMs = Date.now()): boolean {
  return authorizedScanClaimIntent(token, scanId, nowMs) !== null
}

/**
 * The same decision as isAuthorizedScanClaim, but it hands back the intent.
 *
 * That difference is the whole of AC-03's replay gap. The boolean discarded
 * the verified payload, and the payload is where `attemptId` lives — the one
 * value needed to record that this token has been spent. A caller could prove
 * the cookie was ours and had no way to ask whether it had already been used.
 *
 * Authorising and consuming stay separate functions on purpose: this one is
 * pure and synchronous, so it can keep being tested without a database, and
 * consumption (lib/security/scan-claim-attempt.ts) is the caller's next step
 * rather than a hidden side effect of a predicate.
 */
export function authorizedScanClaimIntent(
  token: string | undefined,
  scanId: string,
  nowMs = Date.now(),
): ScanClaimIntent | null {
  if (!token) return null
  // verifyScanClaimIntent swallows its own failures — including a missing or
  // too-short REPORT_SHARE_SECRET — and returns null, so a misconfigured deploy
  // denies the claim rather than crashing.
  const intent = verifyScanClaimIntent(token, nowMs)
  if (!intent || intent.scanId !== scanId) return null
  return intent.returnPath === `/${intent.lang}/result/${encodeURIComponent(scanId)}?claim=1`
    ? intent
    : null
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
