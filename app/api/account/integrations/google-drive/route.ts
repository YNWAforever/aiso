import { authorizeDriveAccount, driveVaultPurpose } from '@/lib/integrations/google-drive/guard'
import { loadDriveConnection, loadDriveSecret, revokeDriveConnectionRow } from '@/lib/integrations/google-drive/store'
import { openToken, VaultError } from '@/lib/integrations/google/vault'
import { revokeToken } from '@/lib/integrations/google/oauth'

export const dynamic = 'force-dynamic'

const respond = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

const failure = (where: string, error: unknown) => {
  // Never log error.message or the error object: the Neon driver echoes the
  // connection string, password included, in its own messages.
  console.error(`[account/integrations/google-drive] ${where} failed`, {
    name: error instanceof Error ? error.name : typeof error,
    ...(error instanceof VaultError ? { code: error.code } : {}),
  })
}

/** The signed-in member's own Drive connection. No id, no account parameter. */
export async function GET() {
  const access = await authorizeDriveAccount()
  if (!access.ok) return access.response
  try {
    return respond({ connection: await loadDriveConnection(access.profile.account_id, access.profile.id) })
  } catch (error) {
    failure('load', error)
    return respond({ error: 'Lookup failed' }, 503)
  }
}

/**
 * Revoke at Google best-effort, then delete our copy regardless. The response
 * says whether Google accepted, so the member knows when to remove access in
 * their Google account too.
 */
export async function DELETE() {
  const access = await authorizeDriveAccount()
  if (!access.ok) return access.response
  const { account_id: accountId, id: profileId } = access.profile

  let sealed: Awaited<ReturnType<typeof loadDriveSecret>>
  try {
    sealed = await loadDriveSecret(accountId, profileId)
  } catch (error) {
    failure('loadDriveSecret', error)
    return respond({ error: 'Lookup failed' }, 503)
  }
  if (!sealed) return respond({ error: 'Not found' }, 404)

  let googleRevoked = false
  try {
    googleRevoked = await revokeToken(openToken(sealed, { accountId, purpose: driveVaultPurpose(profileId) }))
  } catch {
    googleRevoked = false
  }

  try {
    if (!(await revokeDriveConnectionRow(accountId, profileId))) return respond({ error: 'Not found' }, 404)
  } catch (error) {
    failure('revokeDriveConnectionRow', error)
    // Never report a disconnect over a failed write.
    return respond({ error: 'Revoke failed' }, 503)
  }
  return respond({ revoked: true, googleRevoked })
}
