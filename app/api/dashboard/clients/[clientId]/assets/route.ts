import { authorizeAssetRegistry } from '@/lib/assets/guard'
import { normalizeAssetUrl, parseAssetLabel } from '@/lib/assets/schema'
import { listAssets, listQuestionDeclarations, registerAsset } from '@/lib/assets/store'

export const dynamic = 'force-dynamic'

/**
 * The pages an owner has registered for this brand, and the questions they have
 * said those pages answer.
 *
 * Ownership is enforced inside every statement in `lib/assets/store.ts` rather
 * than by a check here, so an unowned client id yields no rows and — on write —
 * a `null` that this route reports as 404. It never distinguishes "absent" from
 * "not yours", because doing so would confirm another account's client id.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const access = await authorizeAssetRegistry()
  if (!access.ok) return access.response
  const { clientId } = await params

  try {
    const [assets, declarations] = await Promise.all([
      listAssets(access.accountId, clientId),
      listQuestionDeclarations(access.accountId, clientId),
    ])
    return Response.json({ assets, declarations })
  } catch (error) {
    console.error('[assets] read failed:', error)
    return Response.json({ error: 'Asset lookup failed' }, { status: 503 })
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const access = await authorizeAssetRegistry()
  if (!access.ok) return access.response
  const { clientId } = await params

  let body: { url?: unknown; label?: unknown }
  try {
    const parsed = await req.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return Response.json({ error: 'Invalid request' }, { status: 400 })
    }
    body = parsed
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }

  // Validated before the store sees either value: the URL is stored and later
  // rendered back as a link on the owner's own dashboard, so a `javascript:`
  // value must never reach a row.
  const identity = typeof body.url === 'string' ? normalizeAssetUrl(body.url) : null
  if (!identity) return Response.json({ error: 'ASSET_URL_INVALID' }, { status: 400 })

  const label = typeof body.label === 'string' ? parseAssetLabel(body.label) : null
  if (!label) return Response.json({ error: 'ASSET_LABEL_INVALID' }, { status: 400 })

  try {
    const asset = await registerAsset({
      accountId: access.accountId,
      clientId,
      url: identity.url,
      origin: identity.origin,
      label,
      actorId: access.actorId,
    })
    if (!asset) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json({ asset })
  } catch (error) {
    // A 2xx over a failed write is the mistake this codebase has paid for once
    // already: the Stripe webhook returned ok while dropping every write.
    console.error('[assets] register failed:', error)
    return Response.json({ error: 'Asset registration failed' }, { status: 503 })
  }
}
