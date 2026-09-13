import 'server-only'
import { db } from '@/lib/db'
import {
  issueVerificationToken,
  normalizeVerificationDomain,
  type VerificationRecord,
} from './schema'

/**
 * Reads and writes for domain-ownership verification.
 *
 * Tenancy is a predicate on the statement, never a check performed first —
 * the shape CLAUDE.md prefers. Every write is additionally guarded on the
 * client still naming the domain the row is about, so a concurrent domain
 * change cannot have its proof land against the new value.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function uuid(value: string): string {
  if (!UUID.test(value)) throw new Error('INVALID_VERIFICATION_INPUT')
  return value.toLowerCase()
}

export type VerificationOutcome =
  | 'verified' | 'token_absent' | 'unreachable' | 'redirected' | 'too_large'

export type VerificationRow = VerificationRecord & {
  /** The client's CURRENT domain, which may differ from the verified one. */
  currentDomain: string | null
  token: string
  lastCheckedAt: string | null
  lastOutcome: VerificationOutcome | null
}

const ISO = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'

/**
 * The client's current domain plus any verification row it has. Returns null
 * only when the client is not this account's — "no row yet" is a valid state
 * and comes back with `verifiedAt: null`.
 */
export async function loadVerification(
  accountId: string,
  clientId: string,
): Promise<VerificationRow | null> {
  const account = uuid(accountId)
  const client = uuid(clientId)
  const sql = db()
  const rows = (await sql`
    select c.domain as current_domain,
      v.domain as verified_domain, v.token,
      to_char(v.verified_at at time zone 'UTC', ${ISO}) as verified_at,
      to_char(v.last_checked_at at time zone 'UTC', ${ISO}) as last_checked_at,
      v.last_outcome
    from clients c
    left join client_domain_verifications v
      on v.client_id = c.id and v.account_id = c.account_id
    where c.id = ${client}::uuid and c.account_id = ${account}::uuid
  `) as Array<Record<string, unknown>>

  const row = rows[0]
  if (!row) return null
  return {
    currentDomain: normalizeVerificationDomain(row.current_domain as string | null),
    verifiedDomain: (row.verified_domain as string | null) ?? '',
    verifiedAt: (row.verified_at as string | null) ?? null,
    token: (row.token as string | null) ?? '',
    lastCheckedAt: (row.last_checked_at as string | null) ?? null,
    lastOutcome: (row.last_outcome as VerificationOutcome | null) ?? null,
  }
}

/**
 * Hand back the token to publish, minting one if this client has none for its
 * current domain.
 *
 * Re-issues when the domain changed: the old token proved a different domain,
 * and reusing it would let a token published on the previous site verify the
 * new one. Re-issuing also clears `verified_at`, because the new domain has
 * not been proven.
 */
export async function ensureVerificationToken(
  accountId: string,
  clientId: string,
  actorId: string,
  domain: string,
): Promise<string | null> {
  const account = uuid(accountId)
  const client = uuid(clientId)
  const actor = uuid(actorId)
  const normalized = normalizeVerificationDomain(domain)
  if (!normalized) return null
  const sql = db()

  const rows = (await sql`
    insert into client_domain_verifications (account_id, client_id, domain, token, issued_by)
    select ${account}::uuid, ${client}::uuid, ${normalized}, ${issueVerificationToken()}, ${actor}::uuid
    where exists (
      select 1 from clients c where c.id = ${client}::uuid and c.account_id = ${account}::uuid
    )
    on conflict (account_id, client_id) do update
      set domain = excluded.domain,
          token = excluded.token,
          issued_at = now(),
          issued_by = excluded.issued_by,
          verified_at = null,
          last_checked_at = null,
          last_outcome = null
      where client_domain_verifications.domain <> excluded.domain
    returning token
  `) as Array<{ token: string }>

  // Nothing returned means the row already exists for this exact domain, so
  // the existing token still stands — re-reading it is correct, not a retry.
  if (rows[0]) return rows[0].token
  const existing = (await sql`
    select token from client_domain_verifications
    where account_id = ${account}::uuid and client_id = ${client}::uuid and domain = ${normalized}
  `) as Array<{ token: string }>
  return existing[0]?.token ?? null
}

/**
 * Record what a check found. `verified_at` is only ever set forward, and only
 * for the domain the row is about — a result computed against one domain must
 * never land on a row that has since been re-pointed at another.
 */
export async function recordVerificationResult(
  accountId: string,
  clientId: string,
  domain: string,
  outcome: VerificationOutcome,
): Promise<void> {
  const account = uuid(accountId)
  const client = uuid(clientId)
  const sql = db()
  await sql`
    update client_domain_verifications
    set last_checked_at = now(),
        last_outcome = ${outcome},
        verified_at = case when ${outcome} = 'verified' then now() else verified_at end
    where account_id = ${account}::uuid and client_id = ${client}::uuid and domain = ${domain}
  `
}
