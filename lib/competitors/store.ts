import type { db } from '@/lib/db'
import { MAX_COMPETITORS, type CompetitorInput } from '@/lib/competitors/schema'

type Sql = ReturnType<typeof db>

export type CompetitorRow = {
  id: string | null
  name: string
  aliases: string[]
  domains: string[]
  created_at: string | null
  updated_at: string | null
}

// Columns are named on every statement: `returning *` on a statement that
// reads another table collapses duplicate column names (CLAUDE.md).

/**
 * Every write is one transaction of:
 *   lock the client (tenancy) -> copy array-only names into the table ->
 *   the change -> mirror live names back into `clients.competitors`.
 *
 * Onboarding and brand creation still write only the array, so without the
 * sync step a mirror would silently drop every competitor they added since the
 * last edit here.
 */
function lock(sql: Sql, accountId: string, clientId: string) {
  return sql`select c.id from clients c where c.id = ${clientId} and c.account_id = ${accountId} for no key update`
}

function syncArray(sql: Sql, accountId: string, clientId: string) {
  // Onboarding and brand creation still write only the array, so it is copied
  // in before every edit. Two bounds keep the table honest: names longer than
  // the table's CHECK (impossible to store) and anything past the classifier's
  // cap are not materialised. Distinct-on keeps the first spelling of a
  // case-insensitive duplicate, and the outer order keeps the member's order —
  // a row's created_at, which mirrorArray and the readers order by, is not
  // stable within one statement.
  return sql`
    insert into competitors (account_id, client_id, name)
    select c.account_id, c.id, names.name
    from clients c
    cross join lateral (
      select distinct on (lower(btrim(u.value)))
        btrim(u.value) as name, u.ordinality
      from unnest(coalesce(c.competitors, '{}'::text[])) with ordinality as u(value, ordinality)
      where char_length(btrim(u.value)) between 1 and 120
        and not exists (
          select 1 from competitors k
          where k.client_id = c.id and k.account_id = c.account_id
            and k.archived_at is null and lower(k.name) = lower(btrim(u.value))
        )
      order by lower(btrim(u.value)), u.ordinality
    ) as names
    where c.id = ${clientId} and c.account_id = ${accountId}
    order by names.ordinality
    limit greatest(0, ${MAX_COMPETITORS} - (
      select count(*)::int from competitors k
      where k.client_id = ${clientId} and k.account_id = ${accountId} and k.archived_at is null
    ))
    on conflict do nothing
  `
}

function mirrorArray(sql: Sql, accountId: string, clientId: string) {
  return sql`
    update clients c set competitors = coalesce((
      select array_agg(k.name order by k.created_at, k.id) from competitors k
      where k.client_id = c.id and k.account_id = c.account_id and k.archived_at is null
    ), '{}'::text[])
    where c.id = ${clientId} and c.account_id = ${accountId}
  `
}

const isUniqueViolation = (error: unknown) => (error as { code?: unknown })?.code === '23505'

/** Table rows, then array-only names as unsaved entries (`id: null`). Null when not owned. */
export async function listCompetitors(sql: Sql, accountId: string, clientId: string): Promise<CompetitorRow[] | null> {
  const owned = await sql`select id, competitors from clients where id = ${clientId} and account_id = ${accountId} limit 1`
  const client = owned[0] as { competitors?: unknown } | undefined
  if (!client) return null
  const rows = await sql`
    select id, name, aliases, domains, created_at, updated_at from competitors
    where client_id = ${clientId} and account_id = ${accountId} and archived_at is null
    order by created_at, id
  ` as CompetitorRow[]
  const known = new Set(rows.map(row => row.name.toLowerCase()))
  const legacy: CompetitorRow[] = []
  for (const value of Array.isArray(client.competitors) ? client.competitors : []) {
    const name = typeof value === 'string' ? value.trim() : ''
    if (!name || known.has(name.toLowerCase())) continue
    known.add(name.toLowerCase())
    legacy.push({ id: null, name, aliases: [], domains: [], created_at: null, updated_at: null })
  }
  return [...rows, ...legacy]
}

export type CreateResult =
  | { status: 'created'; competitor: CompetitorRow }
  | { status: 'not_found' } | { status: 'exists' } | { status: 'limit' }

export async function createCompetitor(sql: Sql, accountId: string, clientId: string, input: CompetitorInput): Promise<CreateResult> {
  const [locked, , inserted, , state] = await sql.transaction([
    lock(sql, accountId, clientId),
    syncArray(sql, accountId, clientId),
    sql`
      insert into competitors (account_id, client_id, name, aliases, domains)
      select c.account_id, c.id, ${input.name}::text, ${input.aliases}::text[], ${input.domains}::text[]
      from clients c
      where c.id = ${clientId} and c.account_id = ${accountId}
        and (select count(*) from competitors k
             where k.client_id = c.id and k.account_id = c.account_id and k.archived_at is null) < ${MAX_COMPETITORS}
      on conflict do nothing
      returning id, name, aliases, domains, created_at, updated_at
    `,
    mirrorArray(sql, accountId, clientId),
    sql`
      select (select count(*)::int from competitors where client_id = ${clientId} and account_id = ${accountId} and archived_at is null) as live_count,
             exists (select 1 from competitors where client_id = ${clientId} and account_id = ${accountId}
                     and archived_at is null and lower(name) = lower(${input.name})) as name_taken
    `,
  ])
  if (!locked[0]) return { status: 'not_found' }
  const competitor = inserted[0] as CompetitorRow | undefined
  if (competitor) return { status: 'created', competitor }
  return (state[0] as { name_taken?: boolean } | undefined)?.name_taken ? { status: 'exists' } : { status: 'limit' }
}

export type UpdateResult = { status: 'updated'; competitor: CompetitorRow } | { status: 'not_found' } | { status: 'exists' }

export async function updateCompetitor(
  sql: Sql, accountId: string, clientId: string, competitorId: string, patch: Partial<CompetitorInput>,
): Promise<UpdateResult> {
  try {
    const [locked, , updated] = await sql.transaction([
      lock(sql, accountId, clientId),
      syncArray(sql, accountId, clientId),
      sql`
        update competitors k set
          name = coalesce(${patch.name ?? null}::text, k.name),
          aliases = coalesce(${patch.aliases ?? null}::text[], k.aliases),
          domains = coalesce(${patch.domains ?? null}::text[], k.domains),
          updated_at = now()
        where k.id = ${competitorId} and k.client_id = ${clientId} and k.account_id = ${accountId} and k.archived_at is null
        returning k.id, k.name, k.aliases, k.domains, k.created_at, k.updated_at
      `,
      mirrorArray(sql, accountId, clientId),
    ])
    const competitor = updated[0] as CompetitorRow | undefined
    if (!locked[0] || !competitor) return { status: 'not_found' }
    return { status: 'updated', competitor }
  } catch (error) {
    // A rename onto a live name trips competitors_client_name_live.
    if (isUniqueViolation(error)) return { status: 'exists' }
    throw error
  }
}

/** Archived, never deleted: a later per-competitor history keeps its id. */
export async function archiveCompetitor(sql: Sql, accountId: string, clientId: string, competitorId: string): Promise<boolean> {
  const [locked, , archived] = await sql.transaction([
    lock(sql, accountId, clientId),
    syncArray(sql, accountId, clientId),
    sql`
      update competitors k set archived_at = now(), updated_at = now()
      where k.id = ${competitorId} and k.client_id = ${clientId} and k.account_id = ${accountId} and k.archived_at is null
      returning k.id
    `,
    mirrorArray(sql, accountId, clientId),
  ])
  return !!locked[0] && archived.length > 0
}
