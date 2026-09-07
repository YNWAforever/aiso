import { getOutcomes } from '@/lib/outcomes/service'

export async function GET(
  request: Request,
  context: { params: Promise<{ clientId: string; workItemId: string; versionId: string }> },
) {
  return getOutcomes(request, await context.params)
}
