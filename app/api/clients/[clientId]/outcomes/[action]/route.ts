import { mutateOutcomes, readCredentials, readOutcomeSummary } from '@/lib/outcome-integrations/service'
export async function POST(request: Request, { params }: { params: Promise<{ clientId: string; action: string }> }) {
  const { clientId, action } = await params
  return mutateOutcomes(clientId, action, request)
}
export async function GET(_request: Request, { params }: { params: Promise<{ clientId: string; action: string }> }) {
  const { clientId, action } = await params
  if (action === 'summary') return readOutcomeSummary(clientId)
  return action === 'credentials' ? readCredentials(clientId) : Response.json({ error: 'OUTCOME_NOT_FOUND' }, { status: 404 })
}
