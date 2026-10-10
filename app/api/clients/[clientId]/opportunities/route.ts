import { loadAuthenticatedOpportunities, opportunityErrorResponse } from '@/lib/opportunities/service'

export async function GET(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  try {
    const { clientId } = await params
    return Response.json(await loadAuthenticatedOpportunities(clientId,new URL(request.url).searchParams), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return opportunityErrorResponse(error) }
}
