import { db } from '@/lib/db'
import { authorizeCompetitors } from '@/lib/competitors/guard'
import { parseCompetitorInput } from '@/lib/competitors/schema'
import { archiveCompetitor, updateCompetitor } from '@/lib/competitors/store'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ clientId: string; competitorId: string }> }

export async function PATCH(req: Request, { params }: Params) {
  const { clientId, competitorId } = await params
  const access = await authorizeCompetitors()
  if (!access.ok) return access.response

  let body: unknown
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const patch = parseCompetitorInput(body, { partial: true })
  if (!patch.ok) return Response.json({ error: patch.error }, { status: 400 })

  try {
    const result = await updateCompetitor(db(), access.accountId, clientId, competitorId, patch.value)
    if (result.status === 'not_found') return Response.json({ error: 'Not found' }, { status: 404 })
    if (result.status === 'exists') return Response.json({ error: 'COMPETITOR_EXISTS' }, { status: 409 })
    return Response.json({ competitor: result.competitor })
  } catch {
    return Response.json({ error: 'Competitor update failed' }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const { clientId, competitorId } = await params
  const access = await authorizeCompetitors()
  if (!access.ok) return access.response

  try {
    const archived = await archiveCompetitor(db(), access.accountId, clientId, competitorId)
    if (!archived) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json({ archived: true })
  } catch {
    return Response.json({ error: 'Competitor archive failed' }, { status: 500 })
  }
}
