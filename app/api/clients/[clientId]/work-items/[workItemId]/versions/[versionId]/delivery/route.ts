import { attestAuthenticatedDelivery, listAuthenticatedDelivery } from '@/lib/delivery/service'

type Context = { params: Promise<{ clientId: string; workItemId: string; versionId: string }> }
export async function GET(request: Request, { params }: Context) {
  const { clientId, workItemId, versionId } = await params
  return listAuthenticatedDelivery(clientId, workItemId, versionId, new URL(request.url).searchParams)
}
export async function POST(request: Request, { params }: Context) {
  const { clientId, workItemId, versionId } = await params
  return attestAuthenticatedDelivery(clientId, workItemId, versionId, request)
}
