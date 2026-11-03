import 'server-only'
import { db } from '@/lib/db'
import { appOrigin } from '@/lib/app-origin'
import { GoogleApiError, googleOAuthConfig, refreshAccessToken } from '@/lib/integrations/google/oauth'
import { openToken } from '@/lib/integrations/google/vault'
import { driveVaultPurpose } from '@/lib/integrations/google-drive/guard'
import { loadDriveCredential, markDriveNeedsReconnect } from '@/lib/integrations/google-drive/store'
import { createGoogleDoc, DriveOutcomeUnknownError, type CreatedDoc } from '@/lib/integrations/google-drive/client'
import { buildStudioDriveDoc, type DriveDocLocale } from './drive-doc'
import type { StudioReply } from './types'

export const DRIVE_EXPORT_OUTCOMES = ['created', 'failed', 'unknown'] as const
export type DriveExportOutcome = typeof DRIVE_EXPORT_OUTCOMES[number]

export type DriveExportResult =
  | { status: 201; body: { outcome: 'created'; link: string | null } }
  | { status: 202; body: { outcome: 'unknown' } }
  | { status: 404 | 409 | 429 | 403 | 500 | 502 | 503; body: { error: string; link?: string | null } }

type SavedTurn = { brandName: string; threadTitle: string; prompt: string; reply: StudioReply }

export type DriveExportDeps = {
  loadTurn(accountId: string, clientId: string, profileId: string, threadId: string, position: number): Promise<SavedTurn | null>
  loadCredential: typeof loadDriveCredential
  markReconnect: typeof markDriveNeedsReconnect
  accessToken(refreshToken: string): Promise<string>
  create(input: { accessToken: string; name: string; html: string }): Promise<CreatedDoc>
  record(row: { accountId: string; clientId: string; profileId: string; threadId: string; position: number; outcome: DriveExportOutcome; fileId?: string; link?: string | null }): Promise<void>
  now(): Date
}

function realDeps(): DriveExportDeps {
  return {
    async loadTurn(accountId, clientId, profileId, threadId, position) {
      // One statement: the brand must be this account's and active, the thread
      // and turn this member's own. Zero rows is 404, never "not yours".
      const rows = await db()`
        select c.brand_name, t.title, u.prompt, u.reply
        from studio_thread_turns u
        join studio_threads t on t.id = u.thread_id and t.account_id = u.account_id
          and t.client_id = u.client_id and t.profile_id = u.profile_id
        join clients c on c.id = u.client_id and c.account_id = u.account_id
        where u.thread_id = ${threadId}::uuid and u.position = ${position}
          and u.account_id = ${accountId}::uuid and u.client_id = ${clientId}::uuid
          and u.profile_id = ${profileId}::uuid and c.status = 'active'
        limit 1
      `
      const row = rows[0]
      if (!row) return null
      return { brandName: String(row.brand_name), threadTitle: String(row.title), prompt: String(row.prompt), reply: row.reply as StudioReply }
    },
    loadCredential: loadDriveCredential,
    markReconnect: markDriveNeedsReconnect,
    async accessToken(refreshToken) {
      const cfg = googleOAuthConfig(process.env, appOrigin())
      if (!cfg) throw new GoogleApiError('misconfigured', 0, 'oauth_client_missing')
      return refreshAccessToken(cfg, refreshToken)
    },
    create: input => createGoogleDoc(input),
    async record(row) {
      await db()`
        insert into studio_drive_exports
          (account_id, client_id, profile_id, thread_id, turn_position, outcome, google_file_id, web_view_link)
        values (${row.accountId}::uuid, ${row.clientId}::uuid, ${row.profileId}::uuid, ${row.threadId}::uuid,
                ${row.position}, ${row.outcome}, ${row.fileId ?? null}, ${row.link ?? null})
      `
    },
    now: () => new Date(),
  }
}

const GOOGLE_ERROR: Record<string, { status: 403 | 409 | 429 | 502 | 503; error: string }> = {
  revoked: { status: 409, error: 'DRIVE_RECONNECT' },
  quota: { status: 429, error: 'DRIVE_QUOTA' },
  forbidden: { status: 403, error: 'DRIVE_FORBIDDEN' },
  misconfigured: { status: 503, error: 'DRIVE_MISCONFIGURED' },
  unavailable: { status: 502, error: 'DRIVE_UNAVAILABLE' },
}

const logFailure = (where: string, error: unknown) => console.error(`[studio/drive-export] ${where}`, error instanceof GoogleApiError
  ? { kind: error.kind, status: error.status, code: error.code }
  // Never log error.message: the Neon driver echoes the connection string.
  : { name: error instanceof Error ? error.name : typeof error })

/**
 * Save one saved Studio turn as a new Google Doc in the member's own Drive.
 * Order: saved turn (404) → live connection (409) → token refresh → exactly
 * one create → ledger row. Never a 2xx over a failed ledger write.
 */
export async function exportTurnToGoogleDoc(
  input: { accountId: string; profileId: string; clientId: string; threadId: string; position: number; locale: DriveDocLocale },
  overrides: Partial<DriveExportDeps> = {},
): Promise<DriveExportResult> {
  const deps: DriveExportDeps = { ...realDeps(), ...overrides }
  const { accountId, profileId, clientId, threadId, position } = input

  let turn: SavedTurn | null
  try {
    turn = await deps.loadTurn(accountId, clientId, profileId, threadId, position)
  } catch (error) {
    logFailure('loadTurn failed', error)
    return { status: 503, body: { error: 'STUDIO_UNAVAILABLE' } }
  }
  if (!turn) return { status: 404, body: { error: 'NOT_FOUND' } }

  let credential: Awaited<ReturnType<typeof loadDriveCredential>>
  try {
    credential = await deps.loadCredential(accountId, profileId)
  } catch (error) {
    logFailure('loadCredential failed', error)
    return { status: 503, body: { error: 'STUDIO_UNAVAILABLE' } }
  }
  if (!credential) return { status: 409, body: { error: 'DRIVE_NOT_CONNECTED' } }
  if (credential.status === 'needs_reconnect') return { status: 409, body: { error: 'DRIVE_RECONNECT' } }

  let accessToken: string
  try {
    accessToken = await deps.accessToken(openToken(credential.sealed, { accountId, purpose: driveVaultPurpose(profileId) }))
  } catch (error) {
    logFailure('token refresh failed', error)
    if (error instanceof GoogleApiError) {
      if (error.kind === 'revoked') await deps.markReconnect(accountId, profileId).catch(() => {})
      const mapped = GOOGLE_ERROR[error.kind] ?? GOOGLE_ERROR.unavailable!
      return { status: mapped.status, body: { error: mapped.error } }
    }
    return { status: 503, body: { error: 'DRIVE_MISCONFIGURED' } }
  }

  const doc = buildStudioDriveDoc({ locale: input.locale, ...turn, generatedAt: deps.now().toISOString() })
  const base = { accountId, clientId, profileId, threadId, position }
  try {
    const created = await deps.create({ accessToken, ...doc })
    try {
      await deps.record({ ...base, outcome: 'created', fileId: created.fileId, link: created.webViewLink })
    } catch (error) {
      logFailure('ledger write failed after create', error)
      return { status: 500, body: { error: 'DRIVE_LEDGER_FAILED', link: created.webViewLink } }
    }
    return { status: 201, body: { outcome: 'created', link: created.webViewLink } }
  } catch (error) {
    if (error instanceof DriveOutcomeUnknownError) {
      try {
        await deps.record({ ...base, outcome: 'unknown' })
      } catch (ledgerError) {
        logFailure('ledger write failed after unknown outcome', ledgerError)
        return { status: 500, body: { error: 'DRIVE_LEDGER_FAILED' } }
      }
      return { status: 202, body: { outcome: 'unknown' } }
    }
    logFailure('create failed', error)
    if (error instanceof GoogleApiError && error.kind === 'revoked') await deps.markReconnect(accountId, profileId).catch(() => {})
    // A known refusal created nothing. Record it best-effort; the response is an error either way.
    await deps.record({ ...base, outcome: 'failed' }).catch(ledgerError => logFailure('ledger write failed after refusal', ledgerError))
    const mapped = error instanceof GoogleApiError ? GOOGLE_ERROR[error.kind] ?? GOOGLE_ERROR.unavailable! : GOOGLE_ERROR.unavailable!
    return { status: mapped.status, body: { error: mapped.error } }
  }
}
