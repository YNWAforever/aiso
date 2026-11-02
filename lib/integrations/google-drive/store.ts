import { db } from '@/lib/db'
import type { SealedToken } from '@/lib/integrations/google/vault'

export type DriveConnectionStatus = 'active' | 'needs_reconnect' | 'revoked'

/** What a member may see about their own connection. Never the token. */
export type DriveConnectionSummary = {
  /** A revoked row is reported as no connection (null), never as a status. */
  status: Exclude<DriveConnectionStatus, 'revoked'>
  googleEmail: string | null
}

/** Every query is scoped by account AND profile; there is no account-blind read. */
export async function upsertDriveConnection(input: {
  accountId: string
  profileId: string
  subject: string
  email: string | null
  scopes: string[]
  sealed: SealedToken
}): Promise<void> {
  const rows = await db()`
    insert into google_drive_connections
      (account_id, profile_id, google_subject, google_email, scopes, token_ciphertext, token_key_id, status)
    values (${input.accountId}, ${input.profileId}, ${input.subject}, ${input.email}, ${input.scopes}::text[],
            ${input.sealed.ciphertext}, ${input.sealed.keyId}, 'active')
    on conflict (profile_id) do update set
      google_subject = excluded.google_subject,
      google_email = excluded.google_email,
      scopes = excluded.scopes,
      token_ciphertext = excluded.token_ciphertext,
      token_key_id = excluded.token_key_id,
      status = 'active',
      updated_at = now()
    where google_drive_connections.account_id = excluded.account_id
    returning id
  `
  // Zero rows means the conflicting row belongs to another account: refuse
  // rather than report a connection that was never written.
  if (!rows[0]?.id) throw new Error('google_drive_connections upsert wrote no row')
}

export async function loadDriveConnection(accountId: string, profileId: string): Promise<DriveConnectionSummary | null> {
  const rows = await db()`
    select status, google_email from google_drive_connections
    where account_id = ${accountId} and profile_id = ${profileId}
  `
  const row = rows[0]
  if (!row || row.status === 'revoked') return null
  return { status: row.status as DriveConnectionSummary['status'], googleEmail: (row.google_email as string | null) ?? null }
}

export async function loadDriveSecret(accountId: string, profileId: string): Promise<SealedToken | null> {
  const rows = await db()`
    select token_ciphertext, token_key_id from google_drive_connections
    where account_id = ${accountId} and profile_id = ${profileId} and status <> 'revoked'
  `
  const row = rows[0]
  if (!row || !row.token_ciphertext || typeof row.token_key_id !== 'string') return null
  const ciphertext = Buffer.isBuffer(row.token_ciphertext) ? row.token_ciphertext : Buffer.from(row.token_ciphertext as Uint8Array)
  return { ciphertext, keyId: row.token_key_id }
}

/** Deletes the credential, keeps the row. Returns whether a live row was revoked. */
export async function revokeDriveConnectionRow(accountId: string, profileId: string): Promise<boolean> {
  const rows = await db()`
    update google_drive_connections
    set status = 'revoked', token_ciphertext = null, token_key_id = null, updated_at = now()
    where account_id = ${accountId} and profile_id = ${profileId} and status <> 'revoked'
    returning id
  `
  return Boolean(rows[0]?.id)
}
