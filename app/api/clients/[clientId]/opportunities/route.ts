import { loadAuthenticatedOpportunities, opportunityErrorResponse } from '@/lib/opportunities/service'

export async function GET(_request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  try {
    const { clientId } = await params
    return Response.json(await loadAuthenticatedOpportunities(clientId), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return opportunityErrorResponse(error) }
}
