import { OpportunityWorkspace } from '@/components/opportunities/OpportunityWorkspace'
import { ResultPriorityCard } from '@/components/dashboard/ResultPriorityCard'
import { firstScanOpportunity } from '@/lib/opportunities/scan-selection'

/** The existing evidence/draft workflow, bound to the selected owned scan. No AI calls. */
export async function ScanImprovements({ clientId, scanId, featured = false, brandName }: { clientId: string; scanId: string; featured?: boolean; brandName?: string | null }) {
  let initial
  try {
    const { loadAuthenticatedOpportunities } = await import('@/lib/opportunities/service')
    initial = await loadAuthenticatedOpportunities(clientId, new URLSearchParams({ scanId }))
  } catch {
    initial = null
  }
  if (featured) return <ResultPriorityCard clientId={clientId} scanId={scanId} brandName={brandName} initial={firstScanOpportunity(initial, scanId)} />
  return initial
    ? <OpportunityWorkspace clientId={clientId} scanId={scanId} initial={initial} />
    : <OpportunityWorkspace clientId={clientId} scanId={scanId} initial={null} initialError="unavailable" />
}
