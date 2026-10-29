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

export async function requireStudioBrand(lang: string, clientId: string) {
  const profile = await requireAuth(lang)
  if (!isFeatureEnabled('conversation_studio')) redirect(`/${lang}/dashboard/${encodeURIComponent(clientId)}?step=home`)
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(clientId)) notFound()
  // A failed query propagates as unavailable; only a confirmed absence is 404.
  const brands = await db()`select id, brand_name from clients where id = ${clientId} and account_id = ${profile.account_id}`
  if (!brands[0]) notFound()
  return { profile, brand: { id: String(brands[0].id), name: String(brands[0].brand_name) } }
}

export type StudioOutputs = { items: { id: string; title: string; status: string; revision: number; updatedAt: string }[]; truncated: boolean }
export async function loadStudioOutputs(clientId: string): Promise<StudioOutputs | null> {
  try {
    // Service independently authenticates and scopes both ownership and list SQL.
    const page = await listAuthenticatedDrafts(clientId, new URLSearchParams({ limit: '50' }))
    return { items: page.items.map(({ id, title, status, revision, updatedAt }) => ({ id, title, status, revision, updatedAt })), truncated: page.nextCursor !== null }
  } catch { return null }
}

export type StudioConnection = { sourceStatus: StudioSourceStatus; state: OwnerState | null }
export async function loadStudioConnection(profile: Awaited<ReturnType<typeof requireAuth>>, clientId: string): Promise<StudioConnection> {
  const result: StudioConnection = { sourceStatus: 'unavailable', state: null }
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
