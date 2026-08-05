import { authorizeLocalTrustClient } from '@/lib/localTrust/guard'
import { updateLocalTrustActionStatus } from '@/lib/localTrust/store'
import type { LocalTrustActionStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

const VALID_STATUSES = new Set<LocalTrustActionStatus>(['open', 'planned', 'done', 'skipped'])

async function parseJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
  } catch {
    return null
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ clientId: string; actionId: string }> },
) {
  const { clientId, actionId } = await params
  const access = await authorizeLocalTrustClient(clientId, 'local_trust_roi')
  if (!access.ok) return access.response

  const body = await parseJson(req)
  if (!body) return Response.json({ error: 'Invalid JSON' }, { status: 400 })

  const status = body.status
  if (!VALID_STATUSES.has(status as LocalTrustActionStatus)) {
    return Response.json({ error: 'Invalid status' }, { status: 400 })
  }

  try {
    // Scoped by clientId, which the guard has already proven belongs to the
    // caller — so an actionId from another account matches nothing.
    const action = await updateLocalTrustActionStatus({
      clientId,
      actionId,
      status: status as LocalTrustActionStatus,
    })
    if (!action) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json({ action })
  } catch {
    return Response.json({ error: 'Action update failed' }, { status: 500 })
  }
}
