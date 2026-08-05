import { getProfile } from '@/lib/auth'
import { resolveCommercialEntitlement } from '@/lib/tier'
import type { PlanFeatures, ProfileWithAccount } from '@/lib/types'
import { verifyClientOwnership } from './store'
import type { Client } from '@/lib/types'

/**
 * The auth → entitlement → ownership preamble every Local Trust route needs,
 * in one place so a route cannot land having done two of the three.
 *
 * Order is load-bearing. Authentication precedes entitlement so an anonymous
 * caller cannot learn which plans carry a feature, and entitlement precedes
 * ownership so an unentitled caller cannot probe which client ids exist on
 * their account. Ownership failure is 404 rather than 403 — the id came from
 * the caller, and 403 would confirm it belongs to somebody.
 *
 * Shaped like lib/admin-guard.ts: the caller either gets its context or a ready
 * response to return.
 */
export type LocalTrustFeature = Extract<
  keyof PlanFeatures,
  'local_trust_roi' | 'local_trust_export' | 'local_trust_competitors'
>

export type LocalTrustAccess =
  | { ok: true; profile: ProfileWithAccount; client: Client }
  | { ok: false; response: Response }

export async function authorizeLocalTrustClient(
  clientId: string,
  feature: LocalTrustFeature,
): Promise<LocalTrustAccess> {
  // Deliberately not wrapped: a session-store outage must surface as a 500,
  // not be flattened into a 401 that reads as "signed out".
  const profile = await getProfile()
  if (!profile) {
    return { ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const { plan, features } = resolveCommercialEntitlement(profile.accounts)
  if (!features[feature]) {
    return {
      ok: false,
      response: Response.json({ error: 'UPGRADE_REQUIRED', feature, plan }, { status: 403 }),
    }
  }

  let client: Client | null
  try {
    client = await verifyClientOwnership(clientId, profile.account_id)
  } catch {
    // Never let a failed lookup read as "not yours" — that would silently deny
    // a legitimate owner during a database incident.
    return { ok: false, response: Response.json({ error: 'Lookup failed' }, { status: 503 }) }
  }
  if (!client) {
    return { ok: false, response: Response.json({ error: 'Not found' }, { status: 404 }) }
  }

  return { ok: true, profile, client }
}
