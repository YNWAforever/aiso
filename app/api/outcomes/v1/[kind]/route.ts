import { ingestOutcomeRequest } from '@/lib/outcome-integrations/service'
export async function POST(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params
  return kind === 'analytics' || kind === 'deployments' ? ingestOutcomeRequest(request, kind) : Response.json({ error: 'OUTCOME_NOT_FOUND' }, { status: 404 })
}
