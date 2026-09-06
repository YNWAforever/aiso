import { listAuthenticatedVersions, submitAuthenticatedVersion } from '@/lib/change-sets/service'

type Context = { params: Promise<{ clientId: string; workItemId: string }> }

export async function GET(request: Request, context: Context): Promise<Response> {
  const { clientId, workItemId } = await context.params
  return listAuthenticatedVersions(clientId, workItemId, new URL(request.url).searchParams)
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const { clientId, workItemId } = await context.params
  return submitAuthenticatedVersion(clientId, workItemId, request)
}
