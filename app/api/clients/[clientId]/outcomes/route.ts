import { readOutcomes } from '@/lib/outcome-integrations/service'
export async function GET(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  return readOutcomes((await params).clientId, request)
}
