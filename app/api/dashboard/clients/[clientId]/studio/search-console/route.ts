import { authorizeSearchConsole } from '@/lib/integrations/search-console/guard'
import { queryStudioGsc } from '@/lib/conversation-studio/gsc-query'
import type { StudioGscSnapshot } from '@/lib/conversation-studio/gsc-types'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ clientId: string }> }

const respond = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

/**
 * On-demand only: the Studio page never calls this route. ConversationStudio
 * asks once per turn submit, for saved and LIVE turns alike. Auth, feature and
 * entitlement are the existing Search Console gate; the brand must also be
 * active, matching answerStudio.
 */
export async function POST(_request: Request, context: Ctx): Promise<Response> {
  const { clientId } = await context.params
  const access = await authorizeSearchConsole(clientId)
  if (!access.ok) return access.response
  if (access.client.status !== 'active') return respond({ error: 'Not found' }, 404)

  try {
    const snapshot = await queryStudioGsc({ accountId: access.profile.account_id, clientId })
    return respond({ snapshot })
  } catch {
    console.error('[conversation-studio/gsc] query failed', { reason: 'DEPENDENCY_UNAVAILABLE' })
    const snapshot: StudioGscSnapshot = {
      status: 'unavailable', country: 'hkg', completeness: 'unknown', messageKey: 'gsc.unavailable',
    }
    return respond({ snapshot })
  }
}
