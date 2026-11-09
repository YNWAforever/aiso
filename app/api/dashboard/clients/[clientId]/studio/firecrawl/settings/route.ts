import { getProfile } from '@/lib/auth'
import { db } from '@/lib/db'
import { isConversationStudioEnabled } from '@/lib/flags'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { readLimitedJson } from '@/lib/approvals/request'
import { setStudioFirecrawlBrandEnabled } from '@/lib/conversation-studio/firecrawl-query'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ clientId: string }> }

const respond = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

export async function POST(request: Request, context: Ctx): Promise<Response> {
  const { clientId } = await context.params
  if (!isConversationStudioEnabled(clientId)) return respond({ error: 'Not found' }, 404)
  const profile = await getProfile()
  if (!profile) return respond({ error: 'Unauthorized' }, 401)
  if (!resolveCommercialEntitlement(profile.accounts).features.platform_access.length) {
    return respond({ error: 'UPGRADE_REQUIRED' }, 403)
  }
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(clientId)) return respond({ error: 'Not found' }, 404)

  try {
    let raw: unknown
    try { raw = await readLimitedJson(request, 1024) } catch { return respond({ error: 'INVALID_STUDIO_INPUT' }, 400) }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return respond({ error: 'INVALID_STUDIO_INPUT' }, 400)
    const body = raw as Record<string, unknown>
    if (Object.keys(body).length !== 1 || typeof body.enabled !== 'boolean') {
      return respond({ error: 'INVALID_STUDIO_INPUT' }, 400)
    }

    // Owning-account membership is the only enable right; platform admins do
    // not get a cross-account toggle.
    const brands = await db()`select id, status from clients where id = ${clientId}::uuid and account_id = ${profile.account_id}`
    const brand = brands[0] as { status: string } | undefined
    if (!brand || brand.status !== 'active') return respond({ error: 'Not found' }, 404)

    await setStudioFirecrawlBrandEnabled({
      accountId: profile.account_id,
      clientId,
      enabled: body.enabled,
      updatedBy: profile.id,
    })
    return respond({ enabled: body.enabled })
  } catch {
    console.error('[conversation-studio/firecrawl] settings failed', { reason: 'DEPENDENCY_UNAVAILABLE' })
    return respond({ error: 'STUDIO_UNAVAILABLE' }, 503)
  }
}
