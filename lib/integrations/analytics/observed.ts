import 'server-only'
import { isFeatureEnabled } from '@/lib/flags'
import { resolveCommercialEntitlement, type CommercialAccount } from '@/lib/tier'
import { loadAnalyticsBinding, loadAnalyticsPanel, type AnalyticsPanel } from './store'

/**
 * The observed-enquiries panel for the dashboard's ROI step, or null when there is
 * nothing to show. Null covers every reason the card is absent: flag off, plan not
 * granting it, no binding, nothing synced yet, or a failed read.
 *
 * It is a page-shaped sibling of authorizeAnalytics rather than a use of it, since
 * a page cannot answer 4xx: same order (flag, entitlement, then the data), the
 * account always the session's, never a caller-supplied id. The entitlement is
 * resolveCommercialEntitlement, which reads status, trial and overrides.
 *
 * A failed read omits the card instead of throwing, so the dashboard's scenario
 * stays usable. Only the error's name is logged: the Neon driver puts the full
 * connection string in its messages.
 */
export async function loadObservedPanel(
  profile: { account_id: string; accounts: CommercialAccount },
  clientId: string,
): Promise<AnalyticsPanel | null> {
  if (!isFeatureEnabled('analytics')) return null
  if (!resolveCommercialEntitlement(profile.accounts).features.analytics) return null
  try {
    const binding = await loadAnalyticsBinding(profile.account_id, clientId)
    if (!binding) return null
    const panel = await loadAnalyticsPanel(profile.account_id, clientId, binding.keyEvents, binding.boundAt)
    // The same test AnalyticsPanel uses to show figures: a bound stream that has
    // never synced would otherwise read as "0 enquiries", a false fact.
    if (panel.last28 === null && panel.lastGoodDataThrough === null) return null
    return panel
  } catch (error) {
    console.error('[dashboard] observed enquiries unavailable', { name: error instanceof Error ? error.name : typeof error })
    return null
  }
}
