import { importClientSource, listClientSources } from '@/lib/sources/service'

type Context = { params: Promise<{ clientId: string }> }

export async function GET(request: Request, { params }: Context) {
  const { clientId } = await params
  return listClientSources(clientId,request)
}

export async function POST(request: Request, { params }: Context) {
  const { clientId } = await params
  return importClientSource(clientId, request)
}
