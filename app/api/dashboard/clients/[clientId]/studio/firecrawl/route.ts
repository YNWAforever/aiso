import { getProfile } from '@/lib/auth'
import { db } from '@/lib/db'
import { isFeatureEnabled } from '@/lib/flags'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { readLimitedJson } from '@/lib/approvals/request'
import { queryStudioFirecrawl } from '@/lib/conversation-studio/firecrawl-query'
import type { StudioFirecrawlSnapshot } from '@/lib/conversation-studio/firecrawl-types'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ clientId: string }> }

const respond = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

/**
 * On-demand only: Studio calls this once per turn submit that names a public
 * URL. The page, layout and connections view never scrape.
 */
export async function POST(request: Request, context: Ctx): Promise<Response> {
  if (!isFeatureEnabled('conversation_studio')) return respond({ error: 'Not found' }, 404)
  const { clientId } = await context.params
  const profile = await getProfile()
  if (!profile) return respond({ error: 'Unauthorized' }, 401)
  if (!resolveCommercialEntitlement(profile.accounts).features.platform_access.length) {
    return respond({ error: 'UPGRADE_REQUIRED' }, 403)
  }
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(clientId)) return respond({ error: 'Not found' }, 404)

  let url: string | undefined
  try {
    const brands = await db()`select id, status from clients where id = ${clientId}::uuid and account_id = ${profile.account_id}`
    if (!brands[0] || brands[0].status !== 'active') return respond({ error: 'Not found' }, 404)

    if (request.body) {
      let raw: unknown
      try { raw = await readLimitedJson(request, 4096) } catch { return respond({ error: 'INVALID_STUDIO_INPUT' }, 400) }
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return respond({ error: 'INVALID_STUDIO_INPUT' }, 400)
      const body = raw as Record<string, unknown>
      if (Object.keys(body).some(key => key !== 'url')
        || (body.url !== undefined && typeof body.url !== 'string')) {
        return respond({ error: 'INVALID_STUDIO_INPUT' }, 400)
      }
      url = body.url as string | undefined
    }

    const snapshot = await queryStudioFirecrawl({ accountId: profile.account_id, clientId, url })
    return respond({ snapshot })
  } catch {
    console.error('[conversation-studio/firecrawl] query failed', { reason: 'DEPENDENCY_UNAVAILABLE' })
    const snapshot: StudioFirecrawlSnapshot = { status: 'unavailable' }
    return respond({ snapshot })
  }
}
