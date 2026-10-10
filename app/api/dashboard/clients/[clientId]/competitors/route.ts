import { db } from '@/lib/db'
import { authorizeCompetitors } from '@/lib/competitors/guard'
import { MAX_COMPETITORS, parseCompetitorInput } from '@/lib/competitors/schema'
import { createCompetitor, listCompetitors } from '@/lib/competitors/store'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const { clientId } = await params
  const access = await authorizeCompetitors()
  if (!access.ok) return access.response

  try {
    const competitors = await listCompetitors(db(), access.accountId, clientId)
    if (!competitors) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json({ competitors })
  } catch {
    // A failed lookup must never read as "not yours".
    return Response.json({ error: 'Competitor lookup failed' }, { status: 503 })
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const { clientId } = await params
  const access = await authorizeCompetitors()
  if (!access.ok) return access.response

  let body: unknown
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const input = parseCompetitorInput(body)
  if (!input.ok) return Response.json({ error: input.error }, { status: 400 })

  try {
    const result = await createCompetitor(db(), access.accountId, clientId, input.value)
    switch (result.status) {
      case 'created': return Response.json({ competitor: result.competitor }, { status: 201 })
      case 'not_found': return Response.json({ error: 'Not found' }, { status: 404 })
      case 'exists': return Response.json({ error: 'COMPETITOR_EXISTS' }, { status: 409 })
      // Refused rather than accepted-and-ignored: the classifier reads at most
      // MAX_COMPETITORS, so an eleventh would be stored and never matched.
      case 'limit': return Response.json({ error: 'COMPETITOR_LIMIT_REACHED', max: MAX_COMPETITORS }, { status: 409 })
    }
  } catch {
    // A 2xx must mean the write happened.
    return Response.json({ error: 'Competitor create failed' }, { status: 500 })
  }
}
