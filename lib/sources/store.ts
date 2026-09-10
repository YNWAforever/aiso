import 'server-only'
import { db } from '@/lib/db'
import {
  buildSourceContent,
  hashSourceContent,
  sourceFreshness,
  type ImportMethod,
  type SourceContent,
  type SourceDto,
  type SourceEntry,
  type SourceKind,
  type SourceVersionDto,
} from './schema'

/**
 * Tenancy is inside every statement, never checked beforehand.
 *
 * `where account_id = $1 and client_id = $2` in one round trip has no TOCTOU
 * window, and zero rows means 404 without distinguishing "absent" from "not
 * yours" — the shape
 * `app/api/dashboard/clients/[clientId]/prompts/[promptId]/route.ts` already
 * uses. Migration 044's composite foreign keys make the same guarantee
 * structurally, so a row of one account cannot reference another's client even
 * if a query here were wrong.
 */

export type SourceScope = { accountId: string; clientId: string; actorId: string }

type SourceRow = {
  id: string; source_key: string; kind: SourceKind; label: string
  agent_use_allowed: boolean; revoked_at: string | Date | null; latest_version: number
  updated_at: string | Date
  version_id: string | null; version_number: number | null; content_hash: string | null
  import_method: ImportMethod | null; origin_ref: string | null
  imported_at: string | Date | null; approved_at: string | Date | null
  content: SourceContent | null
}

const iso = (value: string | Date | null): string | null =>
  value === null ? null : value instanceof Date ? value.toISOString() : value

function versionDto(row: SourceRow): SourceVersionDto | null {
  if (!row.version_id || row.version_number === null || !row.content_hash || !row.import_method) return null
  return {
    id: row.version_id,
    versionNumber: row.version_number,
    contentHash: row.content_hash,
    importMethod: row.import_method,
    originRef: row.origin_ref,
    importedAt: iso(row.imported_at) ?? '',
    approvedAt: iso(row.approved_at),
    entries: row.content?.entries ?? [],
  }
}

function dto(row: SourceRow, now: Date): SourceDto {
  const current = versionDto(row)
  return {
    id: row.id,
    sourceKey: row.source_key,
    kind: row.kind,
    label: row.label,
    agentUseAllowed: row.agent_use_allowed,
    revokedAt: iso(row.revoked_at),
    latestVersion: row.latest_version,
    // Freshness is a property of the content, so a source with no version yet has
    // none to report. Null is not 'stale'.
    freshness: current ? sourceFreshness(current.importedAt, now) : null,
    updatedAt: iso(row.updated_at) ?? '',
    current,
  }
}

export async function listSources(scope: SourceScope, now = new Date()): Promise<SourceDto[]> {
  const sql = db()
  const rows = await sql`
    select
      s.id, s.source_key, s.kind, s.label, s.agent_use_allowed, s.revoked_at,
      s.latest_version, s.updated_at,
      v.id as version_id, v.version_number, v.content_hash, v.import_method,
      v.origin_ref, v.imported_at, v.approved_at, v.content
    from client_sources s
    left join client_source_versions v
      on v.account_id = s.account_id and v.client_id = s.client_id
      and v.source_id = s.id and v.version_number = s.latest_version
    where s.account_id = ${scope.accountId} and s.client_id = ${scope.clientId}
    order by s.created_at desc, s.id desc
    limit 200
  `
  return (rows as SourceRow[]).map(row => dto(row, now))
}

/**
 * The single server-side enforcement point for "may an agent use this".
 *
 * A revoked source leaves this list the moment it is revoked, `agent_use_allowed`
 * defaults to false in 044 so a freshly imported pack is inert until someone says
 * otherwise, and an unapproved import is excluded whatever that flag says.
 * Drafting must read sources through this function and no other: a second reader
 * that forgot one of these three predicates is exactly how a revoked fact ends up
 * in a published answer.
 */
export async function listAgentUsableSources(scope: SourceScope, now = new Date()): Promise<SourceDto[]> {
  const sql = db()
  const rows = await sql`
    select
      s.id, s.source_key, s.kind, s.label, s.agent_use_allowed, s.revoked_at,
      s.latest_version, s.updated_at,
      v.id as version_id, v.version_number, v.content_hash, v.import_method,
      v.origin_ref, v.imported_at, v.approved_at, v.content
    from client_sources s
    join client_source_versions v
      on v.account_id = s.account_id and v.client_id = s.client_id
      and v.source_id = s.id and v.version_number = s.latest_version
    where s.account_id = ${scope.accountId} and s.client_id = ${scope.clientId}
      and s.agent_use_allowed = true
      and s.revoked_at is null
      and v.approved_at is not null
    order by s.created_at desc, s.id desc
    limit 200
  `
  return (rows as SourceRow[]).map(row => dto(row, now))
}

export async function readSource(scope: SourceScope, sourceId: string, now = new Date()): Promise<SourceDto | null> {
  const sql = db()
  const rows = await sql`
    select
      s.id, s.source_key, s.kind, s.label, s.agent_use_allowed, s.revoked_at,
      s.latest_version, s.updated_at,
      v.id as version_id, v.version_number, v.content_hash, v.import_method,
      v.origin_ref, v.imported_at, v.approved_at, v.content
    from client_sources s
    left join client_source_versions v
      on v.account_id = s.account_id and v.client_id = s.client_id
      and v.source_id = s.id and v.version_number = s.latest_version
    where s.account_id = ${scope.accountId} and s.client_id = ${scope.clientId} and s.id = ${sourceId}
    limit 1
  `
  const row = rows[0] as SourceRow | undefined
  return row ? dto(row, now) : null
}

export type ImportInput = {
  sourceKey: string
  kind: SourceKind
  label: string
  entries: SourceEntry[]
  importMethod: ImportMethod
  originRef: string | null
  /** Recorded only when the importer is entitled to approve; the service decides. */
  approve: boolean
}

export type ImportResult =
  | { kind: 'created' | 'version-added' | 'unchanged'; source: SourceDto }
  | { kind: 'revoked' }
  | { kind: 'not-found' }

/**
 * Import is upsert-by-source-key, then append-a-version. Re-importing identical
 * content is reported as `unchanged` rather than written again: an unchanged
 * paste is not an edit, and a history full of identical rows would bury the real
 * edits.
 */
export async function importSource(scope: SourceScope, input: ImportInput): Promise<ImportResult> {
  const sql = db()
  const content = buildSourceContent(input.entries)
  const contentHash = hashSourceContent(content)

  // Tenancy inside the write: the insert cannot name a client this account does
  // not own, because the select it draws from returns nothing.
  const upserted = await sql`
    insert into client_sources (account_id, client_id, source_key, kind, label, created_by)
    select ${scope.accountId}, c.id, ${input.sourceKey}, ${input.kind}, ${input.label}, ${scope.actorId}
    from clients c where c.id = ${scope.clientId} and c.account_id = ${scope.accountId}
    on conflict (account_id, client_id, source_key)
      do update set label = excluded.label, kind = excluded.kind, updated_at = now()
    returning id, latest_version, revoked_at
  `
  const source = upserted[0] as { id: string; latest_version: number; revoked_at: string | Date | null } | undefined
  if (!source) return { kind: 'not-found' }
  // A revoked source is not a place to put new content. Restoring one is a
  // separate, deliberate act rather than a side effect of importing again.
  if (source.revoked_at !== null) return { kind: 'revoked' }

  const existing = await sql`
    select content_hash from client_source_versions
    where account_id = ${scope.accountId} and client_id = ${scope.clientId}
      and source_id = ${source.id} and version_number = ${source.latest_version}
    limit 1
  `
  if ((existing[0] as { content_hash?: string } | undefined)?.content_hash === contentHash) {
    const unchanged = await readSource(scope, source.id)
    return unchanged ? { kind: 'unchanged', source: unchanged } : { kind: 'not-found' }
  }

  const nextVersion = source.latest_version + 1
  await sql`
    insert into client_source_versions (
      account_id, client_id, source_id, version_number, content, content_hash,
      import_method, origin_ref, imported_by, approved_by, approved_at
    ) values (
      ${scope.accountId}, ${scope.clientId}, ${source.id}, ${nextVersion},
      ${JSON.stringify(content)}::jsonb, ${contentHash},
      ${input.importMethod}, ${input.originRef}, ${scope.actorId},
      ${input.approve ? scope.actorId : null}, ${input.approve ? new Date().toISOString() : null}
    )
  `
  const bumped = await sql`
    update client_sources set latest_version = ${nextVersion}, updated_at = now()
    where account_id = ${scope.accountId} and client_id = ${scope.clientId} and id = ${source.id}
    returning id
  `
  // Zero rows here means the source vanished under us. Reporting success would
  // claim a write that did not land.
  if (!bumped[0]) return { kind: 'not-found' }

  const stored = await readSource(scope, source.id)
  if (!stored) return { kind: 'not-found' }
  return { kind: source.latest_version === 0 ? 'created' : 'version-added', source: stored }
}

/** Revocation is a state, never a delete: a draft that cited this must stay explainable. */
export async function revokeSource(scope: SourceScope, sourceId: string): Promise<SourceDto | null> {
  const sql = db()
  const rows = await sql`
    update client_sources
      set revoked_at = now(), revoked_by = ${scope.actorId},
          agent_use_allowed = false, updated_at = now()
    where account_id = ${scope.accountId} and client_id = ${scope.clientId}
      and id = ${sourceId} and revoked_at is null
    returning id
  `
  return rows[0] ? readSource(scope, sourceId) : null
}

export async function setAgentUse(scope: SourceScope, sourceId: string, allowed: boolean): Promise<SourceDto | null> {
  const sql = db()
  const rows = await sql`
    update client_sources set agent_use_allowed = ${allowed}, updated_at = now()
    where account_id = ${scope.accountId} and client_id = ${scope.clientId}
      and id = ${sourceId} and revoked_at is null
    returning id
  `
  return rows[0] ? readSource(scope, sourceId) : null
}
