import 'server-only'
import { db } from '@/lib/db'
import type { EntityDto, EntityInput } from './schema'

type EntityRow = {client_id:string; display_name:string; aliases:string[]; revision:number; updated_at:string | Date}
function dto(row: EntityRow): EntityDto {
  return {clientId:row.client_id, displayName:row.display_name, aliases:row.aliases, revision:row.revision, verification:'unverified', updatedAt:row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at}
}

export async function loadOwnedEntityClient(accountId: string, clientId: string): Promise<{id:string; brand_name:string} | null> {
  const sql = db()
  const rows = await sql`select id, brand_name from clients where id = ${clientId} and account_id = ${accountId} limit 1`
  return rows[0] as {id:string; brand_name:string} | undefined ?? null
}

export async function loadEntity(accountId: string, clientId: string): Promise<EntityDto | null> {
  const sql = db()
  const rows = await sql`
    select e.client_id, e.display_name, e.aliases, e.revision, e.updated_at
    from client_entities e join clients c on c.id = e.client_id and c.account_id = e.account_id
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
