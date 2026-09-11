import 'server-only'
import { db } from '@/lib/db'
import type { EntityDto, EntityInput } from './schema'
import { deriveVerificationState, normalizeVerificationDomain } from '@/lib/domain-verification/schema'

type EntityRow = {client_id:string; display_name:string; aliases:string[]; revision:number; updated_at:string | Date
  verified_at?:string | Date | null; verified_domain?:string | null; current_domain?:string | null}
/**
 * `verification` used to be the literal 'unverified' here, so the DTO stated
 * a status nothing could establish. It is now derived from the proof (048)
 * and the domain the client currently names -- a proof recorded for a domain
 * the client has since moved off does NOT carry over.
 *
 * saveEntity's RETURNING cannot see the join, so a write reports 'unverified'
 * rather than guessing; the next read is authoritative. Under-reporting a
 * proof is recoverable, claiming one that was not checked is not.
 */
function dto(row: EntityRow): EntityDto {
  const verifiedAt = row.verified_at instanceof Date ? row.verified_at.toISOString() : row.verified_at ?? null
  return {clientId:row.client_id, displayName:row.display_name, aliases:row.aliases, revision:row.revision,
    verification: deriveVerificationState(
      verifiedAt === null ? null : {verifiedAt, verifiedDomain: row.verified_domain ?? ''},
      normalizeVerificationDomain(row.current_domain ?? null)),
    updatedAt:row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at}
}

// account_id is selected as well as matched: the entities page needs it to
// read the domain-verification row, and re-deriving it from the session in a
// second place is how two sources of the same id drift apart.
export async function loadOwnedEntityClient(accountId: string, clientId: string): Promise<{id:string; account_id:string; brand_name:string} | null> {
  const sql = db()
  const rows = await sql`select id, account_id, brand_name from clients where id = ${clientId} and account_id = ${accountId} limit 1`
  return rows[0] as {id:string; account_id:string; brand_name:string} | undefined ?? null
}

export async function loadEntity(accountId: string, clientId: string): Promise<EntityDto | null> {
  const sql = db()
  const rows = await sql`
    select e.client_id, e.display_name, e.aliases, e.revision, e.updated_at,
      c.domain as current_domain, v.domain as verified_domain, v.verified_at
    from client_entities e join clients c on c.id = e.client_id and c.account_id = e.account_id
    left join client_domain_verifications v on v.client_id = e.client_id and v.account_id = e.account_id
    where e.client_id = ${clientId} and e.account_id = ${accountId}
  `
  return rows[0] ? dto(rows[0] as EntityRow) : null
}

export async function saveEntity(accountId: string, clientId: string, actorId: string | null, input: EntityInput): Promise<EntityDto | null> {
  const sql = db()
  const aliases = JSON.stringify(input.aliases)
  const mutation = input.expectedRevision === 0
    ? sql`
      insert into client_entities (client_id, account_id, display_name, aliases, revision, updated_by)
      select c.id, c.account_id, ${input.displayName}, ${aliases}::jsonb, 1, ${actorId}::uuid
      from clients c where c.id = ${clientId} and c.account_id = ${accountId}
      on conflict (client_id) do nothing
      returning client_id, display_name, aliases, revision, updated_at
    `
    : sql`
      update client_entities e set display_name = ${input.displayName}, aliases = ${aliases}::jsonb,
        revision = e.revision + 1, updated_by = ${actorId}, updated_at = now()
      where e.client_id = ${clientId} and e.account_id = ${accountId} and e.revision = ${input.expectedRevision}
        and exists (select 1 from clients c where c.id = e.client_id and c.account_id = e.account_id)
      returning client_id, display_name, aliases, revision, updated_at
    `
  // A second READ COMMITTED statement sees the winner of a concurrent INSERT
  // conflict (a same-statement CTE fallback would still have its older snapshot).
  // Only older, identical payloads qualify as an acknowledged lost response.
  const replay = sql`
    select e.client_id, e.display_name, e.aliases, e.revision, e.updated_at
    from client_entities e join clients c on c.id = e.client_id and c.account_id = e.account_id
    where e.client_id = ${clientId} and e.account_id = ${accountId}
      and e.revision > ${input.expectedRevision}
      and e.display_name = ${input.displayName} and e.aliases = ${aliases}::jsonb
  `
  const [written, current] = await sql.transaction([mutation,replay], {isolationLevel:'ReadCommitted'})
  const row = written[0] ?? current[0]
  return row ? dto(row as EntityRow) : null
}
