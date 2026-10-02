import 'server-only'
import { NextResponse } from 'next/server'
import { getProfile } from '@/lib/auth'
import { isAttributionEnabled } from '@/lib/flags'
import { resolveCommercialEntitlement } from '@/lib/tier'
import type { ProfileWithAccount } from '@/lib/types'
import { loadOwnedVersion } from './store'

/**
 * flag → auth → entitlement → ownership, in one place, the shape of
 * lib/localTrust/guard.ts (spec §5.1). Its own ownership lookup, so
 * lib/attribution imports nothing from lib/localTrust
 * (__tests__/security/outcome-layer-separation.test.ts).
 *
 * The flag comes first so a switched-off feature is a plain 404 to everyone and
 * reveals nothing about plans or brands. Attribution compares Search Console
 * figures, so the plan feature is `search_console`; there is no feature of its own.
 */

type Denied = { ok: false; response: NextResponse }

const deny = (status: number, error: string): Denied =>
  ({ ok: false, response: NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'private, no-store' } }) })

// Every id is a `uuid` column. Without this a malformed id would reach the lookup,
// Postgres would raise 22P02, and a caller's typo would read as a 503 outage
// instead of an honest 404.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function authorizeAttribution(
  clientId: string,
  itemId: string,
  versionId: string,
): Promise<{ ok: true; profile: ProfileWithAccount; accountId: string } | Denied> {
  if (!isAttributionEnabled()) return deny(404, 'Not found')
  // Deliberately not wrapped: a session-store outage must surface as a 500, not a 401.
  const profile = await getProfile()
  if (!profile) return deny(401, 'Unauthorized')
  if (!resolveCommercialEntitlement(profile.accounts).features.search_console) return deny(403, 'UPGRADE_REQUIRED')
  if (![clientId, itemId, versionId].every(id => UUID_RE.test(id))) return deny(404, 'Not found')
  let owned: boolean
  try {
    // The account is the session's, never a caller-supplied id.
    owned = await loadOwnedVersion(profile.account_id, clientId, itemId, versionId)
  } catch (err) {
    // Never let a failed lookup read as "not yours". Log the name only: the Neon
    // driver puts the full connection string, password included, in its messages.
    console.error('attribution guard: ownership lookup failed', { name: err instanceof Error ? err.name : 'unknown' })
    return deny(503, 'Lookup failed')
  }
  if (!owned) return deny(404, 'Not found')
  return { ok: true, profile, accountId: profile.account_id }
}
