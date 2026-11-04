import { checkAuthenticatedLivePage } from '@/lib/site-edit/handoff-service'

// Site-edit S4: check the live page for the approved payload. Gated inside
// lib/site-edit/handoff-service.ts (session, then account → client → item →
// version ownership in SQL); the account never comes from the request.
type Context = { params: Promise<{ clientId: string; workItemId: string; versionId: string }> }
export async function POST(request: Request, { params }: Context) {
  const { clientId, workItemId, versionId } = await params
  return checkAuthenticatedLivePage(clientId, workItemId, versionId, request)
}
