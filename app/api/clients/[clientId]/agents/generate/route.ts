import { getProfile } from '@/lib/auth'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { generateImprove } from '@/lib/agents/generate'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function POST(req: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const deadlineAt = Date.now() + 55_000
  try {
    const profile = await getProfile()
    if (!profile) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (!resolveCommercialEntitlement(profile.accounts).features.agent_recs) return Response.json({ error: 'UPGRADE_REQUIRED' }, { status: 403 })
    const { clientId } = await params
    let body: unknown
    try { body = await req.json() } catch { return Response.json({ error: 'Invalid request' }, { status: 400 }) }
    const scanId = body && typeof body === 'object' && !Array.isArray(body) ? (body as {scanId?: unknown}).scanId : null
    if (!UUID.test(clientId) || typeof scanId !== 'string' || !UUID.test(scanId)) return Response.json({ error: 'Valid scanId required' }, { status: 400 })
    const { status, ...result } = await generateImprove({ accountId: profile.account_id, clientId, scanId }, { deadlineAt })
    return Response.json(result, { status })
  } catch {
    return Response.json({ error: 'Generation unavailable' }, { status: 503 })
  }
}
