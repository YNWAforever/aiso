import { decideAuthenticatedVersion } from '@/lib/change-sets/service'

type Context = { params: Promise<{ clientId: string; workItemId: string; versionId: string }> }

export async function POST(request: Request, context: Context): Promise<Response> {
  const { clientId, workItemId, versionId } = await context.params
  return decideAuthenticatedVersion(clientId, workItemId, versionId, request)
}
