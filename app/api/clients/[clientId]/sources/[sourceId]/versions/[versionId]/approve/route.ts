import { approveClientSourceVersion } from '@/lib/sources/service'

export async function POST(request: Request, { params }: { params: Promise<{ clientId: string; sourceId: string; versionId: string }> }) {
  const { clientId, sourceId, versionId } = await params
  return approveClientSourceVersion(clientId, sourceId, versionId, request)
}
