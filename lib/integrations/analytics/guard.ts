import { NextResponse } from 'next/server'
import { getProfile } from '@/lib/auth'
import { isAnalyticsEnabled } from '@/lib/flags'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { loadOwnedClient } from './store'
import type { ProfileWithAccount } from '@/lib/types'

/**
 * flag → auth → entitlement → ownership, in one place, the sibling of
 * lib/integrations/search-console/guard.ts. It is a copy on purpose: the two
 * connectors are gated by different flags and plan features and must be able to
 * diverge without one guard's change reaching the other. The flag comes first so
 * a switched-off feature is a plain 404 to everyone and reveals nothing about
 * plans or brands.
 */

type Denied = { ok: false; response: NextResponse }

const deny = (status: number, error: string): Denied =>
  ({ ok: false, response: NextResponse.json({ error }, { status }) })

// clients.id is a `uuid` column. Without this check a malformed id would reach
// the lookup, Postgres would raise 22P02, and a caller's typo would read as a 503
// outage instead of an honest 404.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function authorizeAnalytics(
  clientId: string,
): Promise<{ ok: true; profile: ProfileWithAccount; client: { id: string; domain: string | null } } | Denied> {
  // Both flags: analytics rides the Search Console connection (lib/flags.ts).
  if (!isAnalyticsEnabled()) return deny(404, 'Not found')
  // Deliberately not wrapped: a session-store outage must surface as a 500, not a 401.
  const profile = await getProfile()
  if (!profile) return deny(401, 'Unauthorized')
  if (!resolveCommercialEntitlement(profile.accounts).features.analytics) return deny(403, 'UPGRADE_REQUIRED')
  if (!UUID_RE.test(clientId)) return deny(404, 'Not found')
  let client: { id: string; domain: string | null } | null
  try {
    client = await loadOwnedClient(profile.account_id, clientId)
  } catch (err) {
    // Never let a failed lookup read as "not yours". Log the name only: the Neon
    // driver puts the full connection string, password included, in its messages.
    console.error('analytics guard: ownership lookup failed', { name: err instanceof Error ? err.name : 'unknown' })
    return deny(503, 'Lookup failed')
  }
  if (!client) return deny(404, 'Not found')
  // Narrow to the two fields callers need rather than handing on the whole row.
  return { ok: true, profile, client: { id: client.id, domain: client.domain } }
}
