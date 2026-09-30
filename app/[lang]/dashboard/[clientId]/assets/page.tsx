import { notFound } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { loadOwnedWorkspace } from '@/lib/workspace/load-owned-workspace'
import { listAssets, listQuestionDeclarations } from '@/lib/assets/store'
import { buildAssetConvergence, siteFindingsFromEvidence } from '@/lib/view-models/asset-convergence'
import { buildMergeSuggestions } from '@/lib/assets/merge-suggestions'
import { loadSuggestionSources, toRegisteredPages } from '@/lib/assets/suggestion-inputs'
import { AssetConvergenceView } from '@/components/dashboard/AssetConvergenceView'
import { isAnalyticsEnabled, isFeatureEnabled } from '@/lib/flags'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { SearchConsolePanel } from '@/components/integrations/SearchConsolePanel'
import { AnalyticsPanel } from '@/components/integrations/AnalyticsPanel'

export const dynamic = 'force-dynamic'

/**
 * AC-06's asset half, on screen: the pages an owner registered, each showing the
 * site findings and the declared questions that reach it.
 *
 * The dashboard layout already calls `requireAuth`; this calls it again, which
 * is the convention here rather than redundancy. Ownership comes from
 * `loadOwnedWorkspace` returning null, and from every statement in
 * `lib/assets/store.ts` carrying `account_id` in its own text.
 *
 * A failed asset read is deliberately NOT caught. There is no honest empty
 * state for it: "no pages registered" and "we could not read your pages" are
 * different facts, and rendering the first for the second would quietly invite
 * an owner to register a page they already have.
 */
export default async function AssetsPage({
  params,
}: {
  params: Promise<{ lang: string; clientId: string }>
}) {
  const { lang, clientId } = await params
  const profile = await requireAuth(lang)

  const owned = await loadOwnedWorkspace({ clientId, profile })
  if (!owned) notFound()

  const [assets, declarations, sources] = await Promise.all([
    listAssets(profile.account_id, clientId),
    listQuestionDeclarations(profile.account_id, clientId),
    loadSuggestionSources(profile.account_id, clientId),
  ])

  // `scan` is a WorkspaceRead: a read error carries `data: null`, which yields no
  // findings rather than inventing them. The scan itself may also simply not
  // exist yet for a new brand.
  const evidence = (owned.scan.data?.results as { evidence?: unknown } | undefined)?.evidence

  const entitlement = resolveCommercialEntitlement(profile.accounts)
  const searchConsole = isFeatureEnabled('search_console') && entitlement.features.search_console
  // The same gate the analytics routes apply (lib/integrations/analytics/guard.ts):
  // dark unless FEATURE_ANALYTICS and FEATURE_SEARCH_CONSOLE are both on, and only
  // on a plan that grants it.
  const analytics = isAnalyticsEnabled() && entitlement.features.analytics

  return (
    <>
      <AssetConvergenceView
        convergence={buildAssetConvergence({
          assets,
          declarations,
          findings: siteFindingsFromEvidence(evidence),
        })}
        suggestions={buildMergeSuggestions({ assets: toRegisteredPages(assets, declarations), sources })}
        lang={lang}
        clientId={clientId}
      />
      {searchConsole && <SearchConsolePanel clientId={clientId} lang={lang} />}
      {analytics && <AnalyticsPanel clientId={clientId} lang={lang} />}
    </>
  )
}
