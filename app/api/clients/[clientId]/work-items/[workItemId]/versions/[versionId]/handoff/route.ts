import { readAuthenticatedHandoff, sendAuthenticatedHandoff } from '@/lib/site-edit/handoff-service'

// Site-edit S2: hand an approved edit spec to the executor. Gated inside
// lib/site-edit/handoff-service.ts (session, then account → client → item →
// version ownership in SQL); the account never comes from the request.
type Context = { params: Promise<{ clientId: string; workItemId: string; versionId: string }> }
export async function GET(_request: Request, { params }: Context) {
  const { clientId, workItemId, versionId } = await params
  return readAuthenticatedHandoff(clientId, workItemId, versionId)
}
export async function POST(request: Request, { params }: Context) {
  const { clientId, workItemId, versionId } = await params
  return sendAuthenticatedHandoff(clientId, workItemId, versionId, request)
}
