import { readClientSource, updateClientSource } from '@/lib/sources/service'

type Context = { params: Promise<{ clientId: string; sourceId: string }> }

export async function GET(_request: Request, { params }: Context) {
  const { clientId, sourceId } = await params
  return readClientSource(clientId, sourceId)
}

export async function PATCH(request: Request, { params }: Context) {
  const { clientId, sourceId } = await params
  return updateClientSource(clientId, sourceId, request)
}
