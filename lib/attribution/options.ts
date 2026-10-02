import 'server-only'
import { listAssets } from '@/lib/assets/store'
import { getProfile } from '@/lib/auth'
import { isAttributionEnabled } from '@/lib/flags'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { loadSyncedPageIds } from './store'
import type { MeasureOptions } from './types'

/**
 * The pages a delivery can be measured against, or null when the form should
 * not offer measuring at all: flag off, no session, a plan without
 * `search_console` (the feature attribution compares), or a failed read.
 *
 * A page-shaped sibling of authorizeAttribution: same order (flag, session,
 * entitlement), and the account is always the session's, never a caller's id.
 * `listAssets` filters on both account_id and client_id, so a client id from
 * another account yields an empty list rather than someone else's pages.
 * Every page is listed, each marked whether Search Console syncs it
 * (loadSyncedPageIds, scoped the same way), so the form can show an unsynced
 * page as not choosable instead of silently leaving it out.
 *
 * A failed read hides the field instead of throwing, so recording a delivery
 * stays possible. Only the error's name is logged: the Neon driver puts the
 * full connection string in its messages.
 */
export async function loadMeasureOptions(clientId: string): Promise<MeasureOptions | null> {
  if (!isAttributionEnabled()) return null
  try {
    const profile = await getProfile()
    if (!profile) return null
    if (!resolveCommercialEntitlement(profile.accounts).features.search_console) return null
    const [assets, syncedIds] = await Promise.all([
      listAssets(profile.account_id, clientId),
      loadSyncedPageIds(profile.account_id, clientId),
    ])
    const synced = new Set(syncedIds)
    return { pages: assets.map(a => ({ id: a.id, url: a.url, label: a.label, synced: synced.has(a.id) })) }
  } catch (error) {
    console.error('[attribution] measure options unavailable', { name: error instanceof Error ? error.name : typeof error })
    return null
  }
}
