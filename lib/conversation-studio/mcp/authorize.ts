import 'server-only'
import { db } from '@/lib/db'
import { isFeatureEnabled, isStudioMcpEnabled } from '@/lib/flags'
import { resolveCommercialEntitlement } from '@/lib/tier'
import type { StudioMcpPrincipal } from './types'

type Claims = { accountId: string; clientId: string; profileId: string }

export type StudioMcpAuthorization =
  | { ok: true; principal: StudioMcpPrincipal }
  | { ok: false; reason: 'forbidden' }

/**
 * The transport's second step, after the signed token proved who asked: re-read
 * the profile, the brand and the plan from the database, so a removed member, a
 * brand moved to another account, a revoked staff grant or a downgrade stops
 * the token working immediately. A token never carries permissions.
 */
export async function authorizeStudioMcp(claims: Claims): Promise<StudioMcpAuthorization> {
  if (!isStudioMcpEnabled(claims.clientId)) return { ok: false, reason: 'forbidden' }
  const sql = db()
  const profiles = await sql`
    select p.id, p.account_id, p.is_admin
    from profiles p
    where p.id = ${claims.profileId}::uuid and p.deactivated_at is null
    limit 1
  `
  const profile = profiles[0] as { id: string; account_id: string; is_admin: boolean | null } | undefined
  if (!profile) return { ok: false, reason: 'forbidden' }

  const brands = await sql`
    select id, account_id from clients
    where id = ${claims.clientId}::uuid and account_id = ${claims.accountId}::uuid and status = 'active'
    limit 1
  `
  if (!brands[0]) return { ok: false, reason: 'forbidden' }

  const owned = String(profile.account_id) === claims.accountId
  if (!owned) {
    if (profile.is_admin !== true) return { ok: false, reason: 'forbidden' }
    const grants = await sql`
      select g.id from studio_staff_grants g
      where g.grantee_profile_id = ${claims.profileId}::uuid
        and g.account_id = ${claims.accountId}::uuid
        and g.revoked_at is null and g.expires_at > now()
      limit 1
    `
    if (!grants[0]) return { ok: false, reason: 'forbidden' }
  }

  // The entitlement belongs to the account that owns the brand, not to the
  // staff member's own account, so a staff read is bounded by the brand's plan.
  const accounts = await sql`
    select plan, status, stripe_subscription_id, trial_ends_at, override_plan, override_expires_at
    from accounts where id = ${claims.accountId}::uuid limit 1
  `
  const account = accounts[0]
  if (!account) return { ok: false, reason: 'forbidden' }
  const features = resolveCommercialEntitlement(account).features
  return {
    ok: true,
    principal: {
      accountId: claims.accountId,
      clientId: claims.clientId,
      profileId: claims.profileId,
      entitlements: { search_console: isFeatureEnabled('search_console') && features.search_console },
    },
  }
}
