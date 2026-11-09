import 'server-only'

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

import { shareSigningSecret } from '@/lib/security/share-secret'

/**
 * Review-link signature for a monthly report version (Phase 3, advisory).
 *
 * The payload namespace is deliberately different from the public share link's
 * (`fimmick-report:v1:…` in lib/reports/share.ts): a share signature must not be
 * usable as a review signature, and withdrawing a share link must not silently
 * withdraw a review. Both sign with the same configured secret so there is no new
 * environment variable to forget, and the namespace is what keeps them apart.
 *
 * A review link carries its expiry in the token. Expiry is bounded: a token that
 * claims to live years must fail closed, and the TTL is fixed rather than chosen
 * by the caller so a link cannot be made permanent.
 *
 * Only the SHA-256 of a signature is stored (migration 101), so a database read
 * cannot reconstruct a working review link.
 */

const NAMESPACE = 'fimmick-report-review:v1'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TOKEN_PATTERN = /^(\d{10})\.([A-Za-z0-9_-]{43})$/

/** How long a review link stays valid. Fixed here, not chosen by a caller. */
export const REVIEW_LINK_TTL_DAYS = 30
const MAX_TTL_SECONDS = 31 * 86_400

export type ReviewPayload = {
  readonly reportId: string
  readonly versionId: string
}

function canonical(input: ReviewPayload & { readonly expiresAt: number }): string {
  return `${NAMESPACE}:${input.reportId}:${input.versionId}:${input.expiresAt}`
}

function signature(input: ReviewPayload & { readonly expiresAt: number }): string {
  return createHmac('sha256', shareSigningSecret()).update(canonical(input)).digest('base64url')
}

function validPayload(input: ReviewPayload & { readonly expiresAt: number }): boolean {
  return UUID_PATTERN.test(input.reportId)
    && UUID_PATTERN.test(input.versionId)
    && Number.isInteger(input.expiresAt)
    && input.expiresAt > 0
}

/** The expiry, in whole seconds, for a review link created at `now`. */
export function reviewLinkExpiry(now: Date = new Date()): number {
  return Math.floor(now.getTime() / 1000) + REVIEW_LINK_TTL_DAYS * 86_400
}

/** `{expiry}.{signature}` — the whole token travels in the `review` query param. */
export function signReviewToken(input: ReviewPayload & { readonly expiresAt: number }): string {
  if (!validPayload(input)) throw new Error('Review payload must be two UUIDs and an expiry')
  return `${input.expiresAt}.${signature(input)}`
}

/**
 * Verifies a review token against the report/version it claims to be for. Returns
 * false for anything malformed, expired, or minted for a different version — so a
 * valid token from version 2 cannot decide version 3.
 */
export function verifyReviewToken(input: ReviewPayload & { readonly token: string; readonly now?: Date }): boolean {
  const match = TOKEN_PATTERN.exec(input.token)
  if (!match) return false
  const expiresAt = Number(match[1])
  const received = Buffer.from(match[2]!, 'base64url')
  if (received.length !== 32 || received.toString('base64url') !== match[2]) return false
  const now = (input.now ?? new Date()).getTime() / 1000
  if (expiresAt <= now) return false
  if (expiresAt > now + MAX_TTL_SECONDS) return false
  const expected = signature({ reportId: input.reportId, versionId: input.versionId, expiresAt })
  const expectedBytes = Buffer.from(expected, 'base64url')
  return expectedBytes.length === received.length && timingSafeEqual(expectedBytes, received)
}

/** What migration 101 stores: a hash, never the token itself. */
export function reviewTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * A review link is its own URL: `/{locale}/r/{slug}?review={token}`. It
 * deliberately does NOT reuse the public share link, because a review must be
 * possible before the report is published and a share link only resolves a
 * published version. The token is what authorises the page to show the latest
 * version, so the URL carries no share signature at all.
 */
export function buildReviewUrl(origin: string, input: ReviewPayload & {
  readonly locale: 'en' | 'zh-HK'
  readonly publicSlug: string
  readonly expiresAt?: number
}): string {
  const url = new URL(origin)
  if (url.protocol !== 'https:') throw new Error('A review link must use HTTPS')
  if (!/^[A-Za-z0-9_-]{32}$/.test(input.publicSlug)) throw new Error('Report slug must be 32 base64url characters')
  url.pathname = `/${input.locale}/r/${encodeURIComponent(input.publicSlug)}`
  url.search = ''
  url.hash = ''
  url.searchParams.set('review', signReviewToken({ reportId: input.reportId, versionId: input.versionId, expiresAt: input.expiresAt ?? reviewLinkExpiry() }))
  return url.toString()
}

