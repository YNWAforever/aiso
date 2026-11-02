import { NextResponse } from 'next/server'
import { getProfile } from '@/lib/auth'
import { isFeatureEnabled } from '@/lib/flags'
import { resolveCommercialEntitlement } from '@/lib/tier'
import type { ProfileWithAccount } from '@/lib/types'

type Denied = { ok: false; response: NextResponse }

const deny = (status: number, error: string): Denied =>
  ({ ok: false, response: NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } }) })

/**
 * flag → auth → entitlement for the Drive act/edit path. No new flag (Willy,
 * 2026-11-02): it rides on Conversation Studio and the same commercial
 * `platform_access` gate as every Studio route. There is no brand in these
 * URLs: the connection belongs to the signed-in profile.
 */
export async function authorizeDriveAccount(): Promise<{ ok: true; profile: ProfileWithAccount } | Denied> {
  if (!isFeatureEnabled('conversation_studio')) return deny(404, 'Not found')
  // Deliberately not wrapped: a session-store outage must surface as a 500, not a 401.
  const profile = await getProfile()
  if (!profile) return deny(401, 'Unauthorized')
  if (!resolveCommercialEntitlement(profile.accounts).features.platform_access.length) {
    return deny(403, 'UPGRADE_REQUIRED')
  }
  return { ok: true, profile }
}

/** Vault AAD purpose: a Drive token opens only for this profile, never as a Search Console token. */
export function driveVaultPurpose(profileId: string): string {
  return `drive:${profileId}`
}
