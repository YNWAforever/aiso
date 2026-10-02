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
  approved_by?: string | null
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
    approvedBy: row.approved_by ?? null,
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
      v.origin_ref, v.imported_at, v.approved_at, v.approved_by, v.content
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
      v.origin_ref, v.imported_at, v.approved_at, v.approved_by, v.content
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
      v.origin_ref, v.imported_at, v.approved_at, v.approved_by, v.content
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
  | { kind: 'created' | 'version-added' | 'unchanged'; source: SourceDto; approval: 'approved' | 'already-approved' | 'not-requested' }
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
  // Noninteractive HTTP batch, not a transaction callback. The lock statement
  // precedes the dependent CTE so a waiter sees the committed latest version
  // in a fresh READ COMMITTED snapshot. All dependent writes roll back together.
  const results = await sql.transaction([sql`
    insert into client_sources (account_id, client_id, source_key, kind, label, created_by)
    select ${scope.accountId}, c.id, ${input.sourceKey}, ${input.kind}, ${input.label}, ${scope.actorId}
    from clients c where c.id = ${scope.clientId} and c.account_id = ${scope.accountId}
    on conflict (account_id, client_id, source_key) do nothing
  `, sql`
    select id from client_sources
    where account_id = ${scope.accountId} and client_id = ${scope.clientId} and source_key = ${input.sourceKey}
    for update
  `, sql`
    with source_state as materialized (
      select s.*, v.content_hash as previous_hash, v.approved_at as previous_approved_at
      from client_sources s left join client_source_versions v
        on v.account_id = s.account_id and v.client_id = s.client_id
        and v.source_id = s.id and v.version_number = s.latest_version
      where s.account_id = ${scope.accountId} and s.client_id = ${scope.clientId} and s.source_key = ${input.sourceKey}
    ), new_version as (
      insert into client_source_versions (account_id, client_id, source_id, version_number,
        content, content_hash, import_method, origin_ref, imported_by, approved_by, approved_at)
      select ${scope.accountId}, ${scope.clientId}, s.id, s.latest_version + 1,
        ${JSON.stringify(content)}::jsonb, ${contentHash}, ${input.importMethod}, ${input.originRef},
        ${scope.actorId}, ${input.approve ? scope.actorId : null}::uuid,
        case when ${input.approve} then now() else null end
      from source_state s where s.revoked_at is null and s.previous_hash is distinct from ${contentHash}
      returning *
    ), approved_version as (
      update client_source_versions v set approved_by = ${scope.actorId}, approved_at = now()
      from source_state s where v.account_id = ${scope.accountId} and v.client_id = ${scope.clientId}
        and v.source_id = s.id and v.version_number = s.latest_version and v.approved_at is null
        and s.revoked_at is null and ${input.approve} and s.previous_hash = ${contentHash}
      returning v.*
    ), chosen_version as (
      select * from new_version union all select * from approved_version
      union all select v.* from client_source_versions v join source_state s
        on v.source_id = s.id and v.version_number = s.latest_version
        and v.account_id = ${scope.accountId} and v.client_id = ${scope.clientId}
      where not exists (select 1 from new_version) and not exists (select 1 from approved_version)
    ), updated_source as (
      update client_sources t set label = ${input.label}, kind = ${input.kind},
        latest_version = coalesce((select version_number from new_version), t.latest_version), updated_at = now()
      from source_state s where t.id = s.id and t.account_id = ${scope.accountId}
        and t.client_id = ${scope.clientId} and t.revoked_at is null
      returning t.id, t.source_key, t.kind, t.label, t.agent_use_allowed, t.revoked_at, t.latest_version, t.updated_at
    )
    select s.id, s.source_key, coalesce(u.kind,s.kind) as kind, coalesce(u.label,s.label) as label,
      s.agent_use_allowed, s.revoked_at, coalesce(u.latest_version,s.latest_version) as latest_version,
      coalesce(u.updated_at,s.updated_at) as updated_at,
      v.id as version_id, v.version_number, v.content_hash, v.import_method, v.origin_ref,
      v.imported_at, v.approved_at, v.approved_by, v.content,
      case when s.revoked_at is not null then 'revoked' when s.latest_version = 0 then 'created'
        when s.previous_hash = ${contentHash} then 'unchanged' else 'version-added' end as result_kind,
      case when not ${input.approve} then 'not-requested'
        when s.previous_hash = ${contentHash} and s.previous_approved_at is not null then 'already-approved'
        else 'approved' end as approval_result
    from source_state s left join updated_source u on u.id = s.id left join chosen_version v on v.source_id = s.id
  `])
  const row = results[2]![0] as (SourceRow & { result_kind: 'created' | 'version-added' | 'unchanged' | 'revoked'; approval_result: 'approved' | 'already-approved' | 'not-requested' }) | undefined
  if (!row) return { kind: 'not-found' }
  if (row.result_kind === 'revoked') return { kind: 'revoked' }
  return { kind: row.result_kind, approval: row.approval_result, source: dto(row, new Date()) }
}

export type ApprovalInput = { sourceId: string; versionId: string; expectedLatestVersion: number; expectedContentHash: string }
export type ApprovalResult =
  | { kind: 'approved' | 'already-approved'; source: SourceDto }
  | { kind: 'conflict' | 'revoked' | 'not-found' }

export async function approveSourceVersion(scope: SourceScope, input: ApprovalInput): Promise<ApprovalResult> {
  const sql = db()
  const results = await sql.transaction([sql`
    select id from client_sources where account_id = ${scope.accountId} and client_id = ${scope.clientId}
      and id = ${input.sourceId} for update
  `, sql`
    with reviewed as materialized (
      select s.id, s.latest_version, s.revoked_at, v.id as version_id, v.version_number, v.content_hash, v.approved_at
      from client_sources s left join client_source_versions v on v.account_id = s.account_id
        and v.client_id = s.client_id and v.source_id = s.id and v.id = ${input.versionId}
      where s.account_id = ${scope.accountId} and s.client_id = ${scope.clientId} and s.id = ${input.sourceId}
    ), approved as (
      update client_source_versions v set approved_by = ${scope.actorId}, approved_at = now()
      from reviewed r where v.account_id = ${scope.accountId} and v.client_id = ${scope.clientId}
        and v.id = r.version_id and v.source_id = r.id and r.revoked_at is null
        and r.latest_version = ${input.expectedLatestVersion} and r.version_number = ${input.expectedLatestVersion}
        and r.content_hash = ${input.expectedContentHash} and v.approved_at is null returning v.id
    )
    select case when r.version_id is null then 'not-found' when r.revoked_at is not null then 'revoked'
      when r.latest_version <> ${input.expectedLatestVersion} or r.version_number <> ${input.expectedLatestVersion}
        or r.content_hash <> ${input.expectedContentHash} then 'conflict'
      when exists(select 1 from approved) then 'approved' else 'already-approved' end as kind from reviewed r
  `])
  const kind = (results[1]![0] as { kind: ApprovalResult['kind'] } | undefined)?.kind ?? 'not-found'
  if (kind !== 'approved' && kind !== 'already-approved') return { kind }
  const source = await readSource(scope, input.sourceId)
  if (!source) return { kind: 'not-found' }
  return { kind, source }
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
