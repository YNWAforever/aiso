import { authorizeAttribution } from '@/lib/attribution/guard'
import { getAttribution } from '@/lib/attribution/service'

/**
 * The measured change for one delivered version (spec §5.2): Search Console
 * figures, and GA4 enquiries for a whole-site measure, 28 days after delivery
 * against 28 days before. Observed change, never a claim of cause.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ clientId: string; workItemId: string; versionId: string }> },
) {
  const { clientId, workItemId, versionId } = await context.params
  const gate = await authorizeAttribution(clientId, workItemId, versionId)
  if (!gate.ok) return gate.response
  return getAttribution(gate, clientId, workItemId, versionId)
}
