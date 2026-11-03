import { readLimitedJson } from '@/lib/approvals/request'
import { authorizeDriveAccount } from '@/lib/integrations/google-drive/guard'
import { exportTurnToGoogleDoc } from '@/lib/conversation-studio/drive-export'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ clientId: string }> }

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
const respond = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

/**
 * Save one of the member's own saved Studio turns as a new Google Doc in their
 * own Drive. One click, one create request, no retries (post–Stage 6 act/edit).
 */
export async function POST(request: Request, context: Ctx): Promise<Response> {
  const access = await authorizeDriveAccount()
  if (!access.ok) return access.response
  const { clientId } = await context.params
  if (!UUID.test(clientId)) return respond({ error: 'NOT_FOUND' }, 404)

  let raw: unknown
  try { raw = await readLimitedJson(request, 1024) } catch { return respond({ error: 'INVALID_STUDIO_INPUT' }, 400) }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return respond({ error: 'INVALID_STUDIO_INPUT' }, 400)
  const body = raw as Record<string, unknown>
  const keys = Object.keys(body)
  if (keys.some(key => key !== 'threadId' && key !== 'position' && key !== 'locale')
    || typeof body.threadId !== 'string' || !UUID.test(body.threadId)
    || !Number.isSafeInteger(body.position) || (body.position as number) < 0
    || (body.locale !== undefined && body.locale !== 'en' && body.locale !== 'zh-HK')) {
    return respond({ error: 'INVALID_STUDIO_INPUT' }, 400)
  }

  const result = await exportTurnToGoogleDoc({
    accountId: access.profile.account_id,
    profileId: access.profile.id,
    clientId,
    threadId: body.threadId,
    position: body.position as number,
    locale: body.locale === 'zh-HK' ? 'zh-HK' : 'en',
  })
  return respond(result.body, result.status)
}
