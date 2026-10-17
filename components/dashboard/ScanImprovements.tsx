import { OpportunityWorkspace } from '@/components/opportunities/OpportunityWorkspace'

/** The existing evidence/draft workflow, bound to the selected owned scan. No AI calls. */
export async function ScanImprovements({ clientId, scanId }: { clientId: string; scanId: string }) {
  let initial
  try {
    const { loadAuthenticatedOpportunities } = await import('@/lib/opportunities/service')
    initial = await loadAuthenticatedOpportunities(clientId, new URLSearchParams({ scanId }))
  } catch {
    initial = null
  }
  return initial
    ? <OpportunityWorkspace clientId={clientId} scanId={scanId} initial={initial} />
    : <OpportunityWorkspace clientId={clientId} scanId={scanId} initial={null} initialError="unavailable" />
}
