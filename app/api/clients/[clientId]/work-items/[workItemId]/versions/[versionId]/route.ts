import { readAuthenticatedVersion } from '@/lib/change-sets/service'

type Context = { params: Promise<{ clientId: string; workItemId: string; versionId: string }> }

export async function GET(_request: Request, context: Context): Promise<Response> {
  const { clientId, workItemId, versionId } = await context.params
  return readAuthenticatedVersion(clientId, workItemId, versionId)
}
