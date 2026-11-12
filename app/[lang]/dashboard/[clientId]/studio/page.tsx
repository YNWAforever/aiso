import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { isConversationStudioEnabled, isFeatureEnabled, isSmeCopilotUiEnabled } from '@/lib/flags'
import { requireStudioBrand } from '@/lib/conversation-studio/secondary'
import { ConversationStudio } from '@/components/dashboard/ConversationStudio'
import { loadStudioEvidence } from '@/lib/conversation-studio/evidence'
import { loadStudioOpportunities } from '@/lib/conversation-studio/opportunities'
import { studioLiveCap } from '@/lib/conversation-studio/live-quota'
import { runtimePlatformsFor } from '@/lib/pulse/platforms'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { loadBinding, loadPanelData } from '@/lib/integrations/search-console/store'
import { deriveOwnerState } from '@/lib/integrations/search-console/state'
import { loadStudioAttachCandidates, loadStudioDocuments } from '@/lib/conversation-studio/inspector'
import type { StudioInspectorReads } from '@/lib/conversation-studio/types'
import type { StudioAttachCandidate } from '@/lib/conversation-studio/live-types'
import { bindingMatchesDomain } from '@/lib/integrations/search-console/binding'
import type { StudioSourceStatus } from '@/lib/conversation-studio/home'

export default async function StudioPage({ params, searchParams }: {
  params: Promise<{ lang: string; clientId: string }>
  searchParams: Promise<{ ask?: string }>
}) {
  const { lang, clientId } = await params
  // The Today composer carries one question in. It only prefills the draft; the
  // user still presses Send, so quota and writes keep their existing path.
  const { ask } = await searchParams
  const initialDraft = typeof ask === 'string' ? ask.slice(0, 1000) : undefined
  const profile = await requireAuth(lang)
  if (!isConversationStudioEnabled(clientId)) redirect(`/${lang}/dashboard/${encodeURIComponent(clientId)}?step=home`)
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(clientId)) notFound()

  let brands
  let evidence
  let opportunities
  try {
    // Establish ownership before loading saved, account-scoped evidence.
    brands = await db()`select id, brand_name, domain from clients where id = ${clientId} and account_id = ${profile.account_id}`
    if (brands[0]) {
      evidence = await loadStudioEvidence(profile.account_id, clientId)
      opportunities = await loadStudioOpportunities(clientId, lang)
    }
  } catch {
    const t = await getTranslations('conversationStudio')
    return <main className="mx-auto w-full max-w-3xl space-y-4 p-6">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p role="alert">{t('loadError')}</p>
      <a href={`/${lang}/dashboard/${encodeURIComponent(clientId)}/studio`} className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 underline">{t('retry')}</a>
    </main>
  }
  const brand = brands[0]
  // R3 A1: not this account's brand. A platform admin may still open it as a
  // staff view under a live grant; anyone else gets the same 404 as a missing brand.
  if (!brand && profile.is_admin === true) return staffStudio(lang, clientId)
  if (!brand || !evidence || opportunities === null) notFound()
  const inspector: StudioInspectorReads = { documents: null, searchConsole: null }
  try { inspector.documents = await loadStudioDocuments(clientId) } catch { /* Failed reads stay pending verification. */ }
  // Metadata only. Full entry bodies stay server-side until an explicit Send.
  let attachCandidates: StudioAttachCandidate[] | null = null
  try {
    attachCandidates = await loadStudioAttachCandidates({ accountId: profile.account_id, clientId, actorId: profile.id })
  } catch { /* Failed read stays unavailable rather than pretending there are none. */ }
  let sourceStatus: StudioSourceStatus = 'unavailable'
  if (isFeatureEnabled('search_console') && resolveCommercialEntitlement(profile.accounts).features.search_console) {
    try {
      // Saved binding and sync metadata after ownership. No Google query or sync.
      const binding = await loadBinding(profile.account_id, clientId)
      sourceStatus = !binding || binding.connectionStatus === 'revoked' ? 'unbound'
        : binding.connectionStatus === 'needs_reconnect' ? 'reconnect'
        : bindingMatchesDomain(binding, binding.currentDomain) ? 'bound' : 'rebind'
      if (sourceStatus === 'unbound') inspector.searchConsole = { kind: 'unbound' }
      else if (binding) {
        // Existing saved ledger/metrics reader only; no Google client or sync.
        const panel = await loadPanelData(profile.account_id, clientId)
        inspector.searchConsole = deriveOwnerState({
          bound: true, entitled: true, connectionStatus: binding.connectionStatus,
          domainMatches: bindingMatchesDomain(binding, binding.currentDomain), boundAt: binding.boundAt,
          latest: panel.latest, lastGoodDataThrough: panel.lastGoodDataThrough,
        })
      }
    } catch { /* Unknown stays unknown; a failed read is never an unbound claim. */ }
  }
  // Brand changes remount the studio, clearing all page-local conversation state.
  const live = isFeatureEnabled('conversation_studio_live') ? {
    platforms: runtimePlatformsFor(resolveCommercialEntitlement(profile.accounts).features.platform_access),
    cap: studioLiveCap(),
  } : undefined
  return <ConversationStudio key={clientId} clientId={clientId} brandName={brand.brand_name} evidence={evidence} opportunities={opportunities} live={live} sourceStatus={sourceStatus} inspector={inspector} attachCandidates={attachCandidates} initialDraft={initialDraft} smeCopilot={isSmeCopilotUiEnabled()} brandDomain={brand.domain ?? null} features={resolveCommercialEntitlement(profile.accounts).features} />
}

/**
 * Staff view (R3): saved evidence of the brand's own account, only under that
 * account's live grant. No LIVE answer, no provider or Google read, no attach.
 * The gate re-resolves the brand with the grant and 404s anything without one.
 */
async function staffStudio(lang: string, clientId: string) {
  const gate = await requireStudioBrand(lang, clientId, { allowStaff: true })
  let evidence
  try { evidence = await loadStudioEvidence(gate.accountId, clientId) } catch { evidence = null }
  if (!evidence) {
    const t = await getTranslations('conversationStudio')
    return <main className="mx-auto w-full max-w-3xl space-y-4 p-6"><h1 className="text-2xl font-bold">{t('title')}</h1><p role="alert">{t('loadError')}</p></main>
  }
  return <ConversationStudio key={clientId} clientId={clientId} brandName={gate.brand.name} evidence={evidence} staffView />
}
