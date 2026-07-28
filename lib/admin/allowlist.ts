/**
 * Admin is DERIVED from configuration, not persisted by this path — so removing
 * an address from ADMIN_EMAILS revokes immediately. Nothing in the codebase
 * writes is_admin = false, so a durable grant would be effectively permanent.
 *
 * The list is server-only. It must never be exposed as NEXT_PUBLIC_.
 *
 * `verified` is required because the email comes from the session; an
 * unverified claimed address must never confer admin.
 *
 * The raw list is a parameter rather than a process.env read so this stays pure
 * and testable.
 */
export function isAllowlistedAdminEmail(
  email: string | null | undefined,
  verified: boolean,
  rawList: string | undefined,
): boolean {
  if (!email || !verified || !rawList) return false
  const needle = email.trim().toLowerCase()
  if (!needle) return false
  return rawList
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .includes(needle)
}
