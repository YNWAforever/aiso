import { getProfile } from '@/lib/auth'
import { updateLocalTrustActionStatus, verifyClientOwnership } from '@/lib/localTrust/store'
import { planAllows } from '@/lib/tier'
import type { LocalTrustActionStatus } from '@/lib/types'

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
  const profile = await getProfile()
  if (!profile) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const plan = profile.accounts?.plan ?? 'basic'
  if (!planAllows(plan, 'local_trust_roi')) {
    return Response.json({ error: 'UPGRADE_REQUIRED', feature: 'local_trust_roi', plan }, { status: 403 })
  }

  const client = await verifyClientOwnership(clientId, profile.account_id)
  if (!client) return Response.json({ error: 'Not found' }, { status: 404 })

  const body = await parseJson(req)
  if (!body) return Response.json({ error: 'Invalid JSON' }, { status: 400 })

  const status = body.status
  if (!VALID_STATUSES.has(status as LocalTrustActionStatus)) {
    return Response.json({ error: 'Invalid status' }, { status: 400 })
  }

  try {
    const action = await updateLocalTrustActionStatus({ clientId, actionId, status: status as LocalTrustActionStatus })
    if (!action) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json({ action })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Action update failed' }, { status: 500 })
  }
}
