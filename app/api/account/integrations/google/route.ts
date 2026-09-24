import { authorizeSearchConsoleAccount } from '@/lib/integrations/search-console/guard'
import { listConnections, loadConnectionSecret, revokeConnectionRow } from '@/lib/integrations/search-console/store'
import { openToken, VaultError } from '@/lib/integrations/google/vault'
import { revokeToken } from '@/lib/integrations/google/oauth'

export const dynamic = 'force-dynamic'

/** No account parameter: the account is the session's, like /api/account/*. */
export async function GET() {
  const access = await authorizeSearchConsoleAccount()
  if (!access.ok) return access.response
  try {
    return Response.json({ connections: await listConnections(access.profile.account_id) })
  } catch (error) {
    // Never log error.message or the error object: the Neon driver echoes the
    // connection string, password included, in its own messages.
    console.error('[account/integrations/google] listConnections failed', {
      name: error instanceof Error ? error.name : typeof error,
      ...(error instanceof VaultError ? { code: error.code } : {}),
    })
    return Response.json({ error: 'Lookup failed' }, { status: 503 })
  }
}

/**
 * Revoke at Google best-effort, then delete our copy regardless (spec §5). The
 * response says whether Google accepted, so the owner knows when to remove
 * access in their Google account too.
 */
export async function DELETE(req: Request) {
  const access = await authorizeSearchConsoleAccount()
  if (!access.ok) return access.response
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })

  const accountId = access.profile.account_id
  let secret: Awaited<ReturnType<typeof loadConnectionSecret>>
  try {
    secret = await loadConnectionSecret(accountId, id)
  } catch (error) {
    console.error('[account/integrations/google] loadConnectionSecret failed', {
      name: error instanceof Error ? error.name : typeof error,
      ...(error instanceof VaultError ? { code: error.code } : {}),
    })
    return Response.json({ error: 'Lookup failed' }, { status: 503 })
  }
  if (!secret) return Response.json({ error: 'Not found' }, { status: 404 })

  let googleRevoked = false
  if (secret.sealed) {
    // A Google-side refusal (or an undecryptable token) is expected here — the
    // account is deleted locally regardless, so it needs no log of its own.
    try {
      googleRevoked = await revokeToken(openToken(secret.sealed, { accountId }))
    } catch {
      googleRevoked = false
    }
  }

  try {
    await revokeConnectionRow(accountId, id)
  } catch (error) {
    console.error('[account/integrations/google] revokeConnectionRow failed', {
      name: error instanceof Error ? error.name : typeof error,
      ...(error instanceof VaultError ? { code: error.code } : {}),
    })
    return Response.json({ error: 'Revoke failed' }, { status: 503 })
  }
  return Response.json({ revoked: true, googleRevoked })
}
