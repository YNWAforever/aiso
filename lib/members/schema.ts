import { routing } from '@/i18n/routing'

/**
 * Validation and state derivation for account membership invitations.
 *
 * Pure — no database, no session — so both the invitation API and the
 * provisioning webhook share one spelling of "what is a valid invited address"
 * and "what state is this invitation in".
 */

/**
 * How long an invitation stays consumable. Short enough that a forwarded or
 * leaked mail stops working, long enough to survive a weekend.
 */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Hard ceiling on profiles per account.
 *
 * This is an abuse limit before it is a product limit: creating an invitation
 * sends mail to an address the caller chose, so an uncapped endpoint is a mail
 * relay with someone else's `from`. The durable rate limit bounds the rate; this
 * bounds the total.
 */
export const MAX_ACCOUNT_MEMBERS = 10

/** Invitation bodies carry one email and one locale. Nothing needs 4 KiB. */
export const INVITATION_BODY_LIMIT = 4 * 1024

export type InvitationLocale = (typeof routing.locales)[number]

export type InvitationInput = { email: string; locale: InvitationLocale }

function invalid(): never {
  throw new Error('INVALID_INVITATION_INPUT')
}

/**
 * One address, one spelling.
 *
 * Normalisation is not cosmetic here: the address is the join key between an
 * invitation and a `user.created` delivery, so `Approver@Example.com` and
 * `approver@example.com` resolving to different rows would let the same person
 * hold two invitations and land in whichever the sort happened to pick. The
 * CHECK in migration 047 requires the stored value to already equal
 * `lower(btrim(email))`, so a writer that skips this function fails loudly.
 *
 * The grammar is deliberately stricter than RFC 5322 — no quoted local parts, no
 * bare-hostname domains. Everything this product can actually deliver mail to
 * passes it, and a narrow grammar is one the SQL CHECK can restate exactly.
 */
export function normalizeInvitationEmail(value: unknown): string {
  if (typeof value !== 'string') invalid()
  const email = value.trim().normalize('NFC').toLowerCase()
  if (email.length < 3 || email.length > 254) invalid()
  // `\s` misses most C0 controls, and a lone surrogate survives normalize().
  if (/[\u0000-\u001f\u007f]|[\uD800-\uDFFF]/u.test(email)) invalid()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(email)) invalid()
  return email
}

export function normalizeInvitationInput(value: unknown): InvitationInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  const input = value as Record<string, unknown>
  const keys = Object.keys(input)
  if (keys.length !== 2 || !keys.every(key => key === 'email' || key === 'locale')) invalid()
  if (
    typeof input.locale !== 'string'
    || !(routing.locales as readonly string[]).includes(input.locale)
  ) invalid()
  return { email: normalizeInvitationEmail(input.email), locale: input.locale as InvitationLocale }
}

export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired' | 'unclaimable'

export type InvitationStatusInput = {
  acceptedAt: string | null
  revokedAt: string | null
  expiresAt: string
  /** Whether `neon_auth.user` already holds a row for this address. */
  registered: boolean
}

/**
 * State is derived, never stored, so a row cannot disagree with itself.
 *
 * `unclaimable` is the one that is not obvious. An invitation is consumed during
 * provisioning — `user.created` fires once, on a first sign-in — so an address
 * that already has an auth user can never consume one. Reporting that as
 * `pending` would tell the inviter to keep waiting for something that cannot
 * arrive, which is the failure this whole surface exists to remove.
 */
export function deriveInvitationStatus(row: InvitationStatusInput, nowMs: number): InvitationStatus {
  if (row.revokedAt !== null) return 'revoked'
  if (row.acceptedAt !== null) return 'accepted'
  if (Date.parse(row.expiresAt) <= nowMs) return 'expired'
  if (row.registered) return 'unclaimable'
  return 'pending'
}
