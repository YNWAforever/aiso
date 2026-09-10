import { importClientSource, listClientSources } from '@/lib/sources/service'

type Context = { params: Promise<{ clientId: string }> }

export async function GET(_request: Request, { params }: Context) {
  const { clientId } = await params
  return listClientSources(clientId)
}

export async function POST(request: Request, { params }: Context) {
  const { clientId } = await params
  return importClientSource(clientId, request)
}
