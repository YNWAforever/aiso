import { NextResponse } from 'next/server'
import { getProfile } from '@/lib/auth'
import { isFeatureEnabled } from '@/lib/flags'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { verifyClientOwnership } from '@/lib/localTrust/store'
import type { Client, ProfileWithAccount } from '@/lib/types'

/**
 * flag → auth → entitlement → ownership, in one place (spec §6), copying
 * lib/localTrust/guard.ts. The flag comes first so a switched-off feature is a
 * plain 404 to everyone and reveals nothing about plans or brands.
 */

type Denied = { ok: false; response: NextResponse }

const deny = (status: number, error: string): Denied =>
  ({ ok: false, response: NextResponse.json({ error }, { status }) })

/** The session-only half, for routes with no brand in the URL. */
export async function authorizeSearchConsoleAccount(): Promise<{ ok: true; profile: ProfileWithAccount } | Denied> {
  if (!isFeatureEnabled('search_console')) return deny(404, 'Not found')
  // Deliberately not wrapped: a session-store outage must surface as a 500, not a 401.
  const profile = await getProfile()
  if (!profile) return deny(401, 'Unauthorized')
  if (!resolveCommercialEntitlement(profile.accounts).features.search_console) return deny(403, 'UPGRADE_REQUIRED')
  return { ok: true, profile }
}

export async function authorizeSearchConsole(
  clientId: string,
): Promise<{ ok: true; profile: ProfileWithAccount; client: Client } | Denied> {
  const account = await authorizeSearchConsoleAccount()
  if (!account.ok) return account
  let client: Client | null
  try {
    client = await verifyClientOwnership(clientId, account.profile.account_id)
  } catch {
    // Never let a failed lookup read as "not yours".
    return deny(503, 'Lookup failed')
  }
  if (!client) return deny(404, 'Not found')
  return { ok: true, profile: account.profile, client }
}
