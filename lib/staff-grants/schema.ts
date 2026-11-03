/**
 * Studio R3 A2a: delegated staff access. Browser-safe vocabulary and input
 * rules shared by the panel and the service.
 */

/** A grant lasts this long from its grant or last renewal (087's CHECK enforces the bound). */
export const STAFF_GRANT_DAYS = 90
export const STAFF_GRANT_BODY_LIMIT = 1024

export type StaffGrantStatus = 'active' | 'expired' | 'revoked'
export type StaffGrantDto = {
  id: string
  grantee: { name: string | null; email: string | null }
  grantedBy: string | null
  grantedAt: string
  expiresAt: string
  revokedAt: string | null
  status: StaffGrantStatus
}
export type StaffAuditAction = 'grant' | 'renew' | 'revoke' | 'open' | 'thread'
export type StaffAuditDto = { id: string; action: StaffAuditAction; actor: string | null; brand: string | null; at: string }

export function staffGrantStatus(row: { revokedAt: string | null; expiresAt: string }, now: Date): StaffGrantStatus {
  if (row.revokedAt) return 'revoked'
  return Date.parse(row.expiresAt) > now.getTime() ? 'active' : 'expired'
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,63}$/

/** The body names the staff member by sign-in email only; nothing else is accepted. */
export function parseStaffGrantInput(value: unknown): { email: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_STAFF_GRANT')
  const keys = Object.keys(value)
  const email = (value as { email?: unknown }).email
  if (keys.length !== 1 || keys[0] !== 'email' || typeof email !== 'string') throw new Error('INVALID_STAFF_GRANT')
  const normalized = email.trim().toLowerCase()
  if (normalized.length > 320 || !EMAIL.test(normalized)) throw new Error('INVALID_STAFF_GRANT')
  return { email: normalized }
}
