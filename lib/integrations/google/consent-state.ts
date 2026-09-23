import { createHmac, timingSafeEqual } from 'node:crypto'
import { shareSigningSecret } from '@/lib/security/share-secret'

/**
 * Ties a Google consent round-trip to the person who started it (spec §4.1).
 * It carries the PKCE verifier and OAuth state plus the profile and account
 * that began the flow; the callback refuses unless all of them match, so one
 * signed-in person cannot finish another's consent.
 */

export const GOOGLE_CONSENT_COOKIE = 'aiso_google_consent'
export const CONSENT_TTL_MS = 10 * 60 * 1000
export const RETURN_PATH = /^\/(en|zh-HK)\/dashboard(\/[A-Za-z0-9_-]+)*$/

export type ConsentState = {
  state: string
  verifier: string
  profileId: string
  accountId: string
  returnPath: string
  exp: number
}

const DOMAIN = 'aiso-google-consent:v1'
const SIGNATURE_LENGTH = 43

function canonical(p: ConsentState): string {
  return [DOMAIN, p.state, p.verifier, p.profileId, p.accountId, p.returnPath, p.exp].join(':')
}

function sign(p: ConsentState): string {
  return createHmac('sha256', shareSigningSecret()).update(canonical(p)).digest('base64url')
}

function isValid(value: unknown): value is ConsentState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return typeof v.state === 'string' && v.state.length >= 32
    && typeof v.verifier === 'string' && v.verifier.length >= 43
    && typeof v.profileId === 'string' && v.profileId.length > 0
    && typeof v.accountId === 'string' && v.accountId.length > 0
    && typeof v.returnPath === 'string' && RETURN_PATH.test(v.returnPath)
    && typeof v.exp === 'number' && Number.isSafeInteger(v.exp)
}

export function signConsentState(input: Omit<ConsentState, 'exp'>, nowMs = Date.now()): string {
  const payload: ConsentState = { ...input, exp: nowMs + CONSENT_TTL_MS }
  if (!isValid(payload)) throw new Error('Invalid consent state')
  return `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${sign(payload)}`
}

export function verifyConsentState(token: string | undefined, nowMs = Date.now()): ConsentState | null {
  if (!token) return null
  const [encoded, signature, ...rest] = token.split('.')
  if (!encoded || !signature || rest.length || signature.length !== SIGNATURE_LENGTH) return null
  let payload: unknown
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!isValid(payload) || payload.exp <= nowMs) return null
  try {
    const expected = Buffer.from(sign(payload), 'base64url')
    const received = Buffer.from(signature, 'base64url')
    return expected.length === received.length && timingSafeEqual(expected, received) ? payload : null
  } catch {
    // Includes a missing REPORT_SHARE_SECRET: deny rather than crash.
    return null
  }
}
