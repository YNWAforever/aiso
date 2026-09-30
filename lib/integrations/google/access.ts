import { GoogleApiError } from './oauth'
import { VaultError, type SealedToken } from './vault'

/**
 * Turn a stored Google connection into a short-lived access token, and say
 * exactly why not when it cannot. Shared by every Google-backed sync (Search
 * Console, GA4): each one decides its own ledger outcome from a `TokenResult`
 * instead of re-implementing the vault/refresh/deadline handling.
 *
 * Every dependency is injected, so the decision table is unit-tested with no
 * Google, no vault key and no database.
 */

export type ConnectionSecret = {
  status: string
  sealed: SealedToken | null
  /** Scopes the owner granted. Optional so a caller that never reads them need not supply them. */
  scopes?: string[]
}

export type TokenDeps = {
  loadSecret(accountId: string, connectionId: string): Promise<ConnectionSecret | null>
  /** Opens the sealed refresh token; the vault binds each ciphertext to its account. */
  open(sealed: SealedToken, accountId: string): string
  refresh(refreshToken: string): Promise<string>
  markConnection(accountId: string, connectionId: string, status: 'needs_reconnect'): Promise<void>
}

export type TokenFailure = 'revoked' | 'vault_error' | 'deferred' | 'config_error' | 'google_unavailable' | 'quota'

export type TokenResult =
  | { ok: true; accessToken: string; scopes: string[] }
  | { ok: false; outcome: TokenFailure }

/**
 * Throws for anything it does not itself classify (a non-VaultError from
 * `open`, a database error from `loadSecret` or `markConnection`, a refresh
 * `GoogleApiError` of kind `forbidden`, or a non-Google error): the caller
 * turns that into its own `internal_error` or, for `forbidden`, its own
 * `access_lost`.
 *
 * `logTag` prefixes the two log lines; only `clientId`, `code` and `status`
 * are logged, never a token or an error message.
 */
export async function acquireAccessToken(
  deps: TokenDeps,
  input: { accountId: string; connectionId: string; clientId: string; outOfTime: () => boolean; logTag: string },
): Promise<TokenResult> {
  const { accountId, connectionId, clientId, outOfTime, logTag } = input

  const secret = await deps.loadSecret(accountId, connectionId)
  if (!secret || secret.status !== 'active' || !secret.sealed) return { ok: false, outcome: 'revoked' }

  let refreshToken: string
  try {
    refreshToken = deps.open(secret.sealed, accountId)
  } catch (error) {
    if (!(error instanceof VaultError)) throw error
    console.error(`${logTag} vault failure`, { clientId, code: error.code })
    return { ok: false, outcome: 'vault_error' }
  }

  // Checked immediately before the refresh: a run already past its deadline
  // makes no Google call at all.
  if (outOfTime()) return { ok: false, outcome: 'deferred' }

  try {
    const accessToken = await deps.refresh(refreshToken)
    return { ok: true, accessToken, scopes: secret.scopes ?? [] }
  } catch (error) {
    if (!(error instanceof GoogleApiError)) throw error
    switch (error.kind) {
      case 'revoked':
        await deps.markConnection(accountId, connectionId, 'needs_reconnect')
        return { ok: false, outcome: 'revoked' }
      case 'misconfigured':
        // Our client secret or Cloud project is wrong. Never flips the connection, never asks the owner.
        console.error(`${logTag} google misconfigured`, { clientId, status: error.status, code: error.code })
        return { ok: false, outcome: 'config_error' }
      case 'unavailable':
        return { ok: false, outcome: 'google_unavailable' }
      case 'quota':
        return { ok: false, outcome: 'quota' }
      default:
        throw error
    }
  }
}
