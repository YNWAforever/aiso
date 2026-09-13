import { authorizeAssetRegistry } from '@/lib/assets/guard'
import { declareQuestion, withdrawQuestion } from '@/lib/assets/store'

export const dynamic = 'force-dynamic'

/**
 * "This page answers this question", asserted and withdrawn by the owner.
 *
 * It is the only page-level claim available on the Pulse side: a pulse rule's
 * args are exactly `{question, platform}`, and `ai_citation_log` cannot be
 * joined to a metric. So this is a person's statement, recorded as one — not an
 * inference the product made and then presented as an observation.
 *
 * Both ids come from the caller and neither is trusted here: `declareQuestion`
 * constrains the asset by account and client, and the prompt by the asset's own
 * `client_id`, in one statement.
 */

type Body = { assetId?: unknown; promptId?: unknown }

async function readIds(req: Request): Promise<{ assetId: string; promptId: string } | null> {
  let body: Body
  try {
    const parsed = await req.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    body = parsed
  } catch {
    return null
  }
  const assetId = typeof body.assetId === 'string' ? body.assetId.trim() : ''
  const promptId = typeof body.promptId === 'string' ? body.promptId.trim() : ''
  if (!assetId || !promptId) return null
  return { assetId, promptId }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const access = await authorizeAssetRegistry()
  if (!access.ok) return access.response
  const { clientId } = await params

  const ids = await readIds(req)
  if (!ids) return Response.json({ error: 'Invalid request' }, { status: 400 })

  try {
    const declared = await declareQuestion({
      accountId: access.accountId,
      clientId,
      assetId: ids.assetId,
      promptId: ids.promptId,
      actorId: access.actorId,
    })
    // No row means the asset is not this account's, or the prompt is not this
    // client's. Both are "not found" from here; separating them would tell the
    // caller which of another account's ids exist.
    if (!declared) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json({ declared: true })
  } catch (error) {
    console.error('[assets] declare failed:', error)
    return Response.json({ error: 'Declaration failed' }, { status: 503 })
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const access = await authorizeAssetRegistry()
  if (!access.ok) return access.response
  const { clientId } = await params

  const ids = await readIds(req)
  if (!ids) return Response.json({ error: 'Invalid request' }, { status: 400 })

  try {
    const withdrawn = await withdrawQuestion({
      accountId: access.accountId,
      clientId,
      assetId: ids.assetId,
      promptId: ids.promptId,
    })
    if (!withdrawn) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json({ withdrawn: true })
  } catch (error) {
    console.error('[assets] withdraw failed:', error)
    return Response.json({ error: 'Withdrawal failed' }, { status: 503 })
  }
}
