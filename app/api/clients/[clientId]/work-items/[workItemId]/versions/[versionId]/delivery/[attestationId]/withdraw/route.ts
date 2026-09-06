import { withdrawAuthenticatedDelivery } from '@/lib/delivery/service'

type Context = { params: Promise<{ clientId: string; workItemId: string; versionId: string; attestationId: string }> }
export async function POST(request: Request, { params }: Context) {
  const { clientId, workItemId, versionId, attestationId } = await params
  return withdrawAuthenticatedDelivery(clientId, workItemId, versionId, attestationId, request)
}
