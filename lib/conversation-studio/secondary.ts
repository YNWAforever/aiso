import 'server-only'
import { notFound, redirect } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { isFeatureEnabled } from '@/lib/flags'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { listAuthenticatedDrafts } from '@/lib/work-items/service'
import { loadBinding, loadPanelData } from '@/lib/integrations/search-console/store'
import { bindingMatchesDomain } from '@/lib/integrations/search-console/binding'
import { deriveOwnerState } from '@/lib/integrations/search-console/state'
import type { OwnerState } from '@/lib/integrations/search-console/state'
import type { StudioSourceStatus } from './home'
import { loadStudioDfsBrandSettings, type StudioDfsBrandSettings } from './dfs-query'
import { loadStudioFirecrawlBrandSettings, type StudioFirecrawlBrandSettings } from './firecrawl-query'
import { loadDriveConnection } from '@/lib/integrations/google-drive/store'
import { loadLiveStaffGrant, recordStaffAudit } from '@/lib/staff-grants/store'

/**
 * The Studio gate. A brand of the signed-in account is always allowed.
 *
 * R3 A1 (staff view): with `allowStaff`, a platform administrator
 * (`profiles.is_admin`, whose only writer is `npm run grant-admin`) may also
 * open a brand of another account. That view is read-only and temporary by
 * construction: every Studio API route still scopes to the session's own
 * account, so nothing a staff viewer does can write into the client's
 * account. Threads are kept in the viewer's tab only, unless the client
 * account has given this admin a live grant (A2b, see staffCanSaveThreads).
 * Every open is recorded in the client account's audit (auditStudioStaffOpen).
 * A non-admin asking for another account's brand gets the same 404 as a
 * brand that does not exist, so the id reveals nothing.
 */
export async function requireStudioBrand(lang: string, clientId: string, { allowStaff = false }: { allowStaff?: boolean } = {}) {
  const profile = await requireAuth(lang)
  if (!isFeatureEnabled('conversation_studio')) redirect(`/${lang}/dashboard/${encodeURIComponent(clientId)}?step=home`)
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(clientId)) notFound()
  // A failed query propagates as unavailable; only a confirmed absence is 404.
  const brands = await db()`select id, brand_name from clients where id = ${clientId} and account_id = ${profile.account_id}`
  if (brands[0]) return { profile, brand: { id: String(brands[0].id), name: String(brands[0].brand_name) }, accountId: String(profile.account_id), staff: false as const }
  if (!allowStaff || profile.is_admin !== true) notFound()
  const other = await db()`select id, brand_name, account_id from clients where id = ${clientId}`
  if (!other[0]) notFound()
  return { profile, brand: { id: String(other[0].id), name: String(other[0].brand_name) }, accountId: String(other[0].account_id), staff: true as const }
}

/**
 * Every staff open is recorded where the client account can read it
 * (studio_staff_audit, 087, shown under Settings → Fimmick staff access), plus
 * one structured log line. The durable write fails CLOSED: a staff view whose
 * open could not be recorded does not render, because "every staff open
 * writes an audit row" is a non-negotiable of the brief.
 */
export async function auditStudioStaffOpen(input: { actorId: string; accountId: string; clientId: string }) {
  console.info(JSON.stringify({ event: 'studio_staff_open', actor: input.actorId, account: input.accountId, client: input.clientId, at: new Date().toISOString() }))
  await recordStaffAudit({ accountId: input.accountId, clientId: input.clientId, actorId: input.actorId, action: 'open' })
}

/**
 * R3 A2b: a staff viewer saves threads only under a live grant from the client
 * account. A failed lookup reads as "no grant": the view stays tab-only rather
 * than failing, and the thread routes re-check the grant on every write anyway.
 */
export async function staffCanSaveThreads(input: { accountId: string; profileId: string }): Promise<boolean> {
  try {
    return Boolean(await loadLiveStaffGrant(input.accountId, input.profileId))
  } catch (error) {
    console.error('[studio] staff grant lookup failed', { name: error instanceof Error ? error.name : typeof error })
    return false
  }
}

export type StudioOutputs = { items: { id: string; title: string; status: string; revision: number; updatedAt: string }[]; truncated: boolean }
export async function loadStudioOutputs(clientId: string): Promise<StudioOutputs | null> {
  try {
    // Service independently authenticates and scopes both ownership and list SQL.
    const page = await listAuthenticatedDrafts(clientId, new URLSearchParams({ limit: '50' }))
    return { items: page.items.map(({ id, title, status, revision, updatedAt }) => ({ id, title, status, revision, updatedAt })), truncated: page.nextCursor !== null }
  } catch { return null }
}

export type StudioConnection = { sourceStatus: StudioSourceStatus; state: OwnerState | null; dfs?: StudioDfsBrandSettings; firecrawl?: StudioFirecrawlBrandSettings; drive?: StudioDriveConnection }
/** The signed-in member's own Google Drive (act/edit path). Never another member's. */
export type StudioDriveConnection = { status: 'active' | 'needs_reconnect' | 'disconnected'; googleEmail: string | null }
export async function loadStudioConnection(profile: Awaited<ReturnType<typeof requireAuth>>, clientId: string): Promise<StudioConnection> {
  const result: StudioConnection = { sourceStatus: 'unavailable', state: null }
  try {
    // Saved per-brand switch only; this never calls DataForSEO.
    result.dfs = await loadStudioDfsBrandSettings(profile.account_id, clientId)
  } catch { /* A failed settings read stays unavailable rather than claiming off. */ }
  try {
    // Saved per-brand switch only; this never calls Firecrawl.
    result.firecrawl = await loadStudioFirecrawlBrandSettings(profile.account_id, clientId)
  } catch { /* Same: unknown, not off. */ }
  if (resolveCommercialEntitlement(profile.accounts).features.platform_access.length) {
    try {
      // Saved connection row only; this never calls Google.
      result.drive = (await loadDriveConnection(profile.account_id, profile.id)) ?? { status: 'disconnected', googleEmail: null }
    } catch { /* Unknown (e.g. 084 not applied): no card rather than a false 未連接. */ }
  }
  if (!isFeatureEnabled('search_console') || !resolveCommercialEntitlement(profile.accounts).features.search_console) return result
  try {
    const binding = await loadBinding(profile.account_id, clientId)
    result.sourceStatus = !binding || binding.connectionStatus === 'revoked' ? 'unbound'
      : binding.connectionStatus === 'needs_reconnect' ? 'reconnect'
      : bindingMatchesDomain(binding, binding.currentDomain) ? 'bound' : 'rebind'
    if (result.sourceStatus === 'unbound') result.state = { kind: 'unbound' }
    else if (binding) {
      const panel = await loadPanelData(profile.account_id, clientId)
      result.state = deriveOwnerState({ bound: true, entitled: true, connectionStatus: binding.connectionStatus,
        domainMatches: bindingMatchesDomain(binding, binding.currentDomain), boundAt: binding.boundAt,
        latest: panel.latest, lastGoodDataThrough: panel.lastGoodDataThrough })
    }
  } catch { /* Keep successful binding state and pending sync on partial failure. */ }
  return result
}
