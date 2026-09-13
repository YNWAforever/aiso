import 'server-only'
import { db } from '@/lib/db'
import type { DraftSnapshotV1, OpportunitySourceKind } from '@/lib/opportunities/types'

/**
 * Reads of work_item_sources. Later tasks add attach/withdraw to this module
 * and then use it from the submit and decision paths.
 *
 * Tenancy lives inside each statement rather than in a check before it: one
 * statement, no TOCTOU window, and zero rows means "absent or not yours"
 * without distinguishing the two.
 *
 * Columns are named on every statement. `returning *` or `select *` on a
 * statement that joins silently collapses duplicate column names — last wins —
 * so `row.id` would hold the joined table's id.
 */

export type LiveSource = {
  id: string
  opportunityKey: string
  sourceKind: OpportunitySourceKind
  sourceId: string
  ruleVersion: string
  checkKey: string | null
  fingerprint: string
  snapshot: DraftSnapshotV1
}

const dto = (row: Record<string, unknown>): LiveSource => ({
  id: String(row.id),
  opportunityKey: String(row.opportunity_key),
  sourceKind: row.source_kind as LiveSource['sourceKind'],
  sourceId: String(row.source_id),
  ruleVersion: String(row.rule_version),
  checkKey: row.check_key === null ? null : String(row.check_key),
  fingerprint: String(row.evidence_fingerprint),
  // No `?? {}` fallback here, deliberately. 051 declares evidence_snapshot
  // `not null` plus `work_item_sources_snapshot_object_check`
  // (`jsonb_typeof(evidence_snapshot) = 'object'`), so the column can be
  // neither SQL NULL nor JSON null, and the Neon driver hands back jsonb
  // already parsed (see store.ts's dto(), which uses row.evidence_snapshot
  // directly with no JSON.parse). A nullish value here means something is
  // badly wrong upstream, not a valid empty snapshot -- falling back to `{}`
  // would present that failure as a success, which this codebase never does.
  snapshot: row.evidence_snapshot as DraftSnapshotV1,
})

/**
 * The live (not withdrawn) sources attached to one work item, ordered by
 * opportunity_key. A withdrawn row is excluded rather than deleted (051's
 * `withdrawn_at`/`withdrawn_by` columns) — it stays in the table so a draft
 * that once cited it stays explainable, but it must not read back as an
 * attached source, which is why `withdrawn_at is null` lives in the
 * statement rather than being left to the caller to filter after the fact.
 */
export async function listLiveSources(
  accountId: string,
  clientId: string,
  workItemId: string,
): Promise<LiveSource[]> {
  const sql = db()
  const rows = await sql`
    select id, opportunity_key, source_kind, source_id, rule_version, check_key,
      evidence_fingerprint, evidence_snapshot
    from work_item_sources
    where account_id = ${accountId} and client_id = ${clientId}
      and work_item_id = ${workItemId} and withdrawn_at is null
    order by opportunity_key
  `
  return rows.map(row => dto(row as Record<string, unknown>))
}

/**
 * Attach a validated source to an existing item, bumping its revision.
 *
 * The caller MUST have derived and validated the source's suggestion (via
 * lib/opportunities/rules.ts's deriveSuggestions) before calling this. A
 * source row cannot exist without its snapshot -- this is exactly the
 * validation step the old opportunity_key-based short-circuit in
 * saveAuthenticatedDraft used to skip for a second source, which is the
 * provenance lie 041-046 exist to prevent.
 *
 * One statement, two chained data-modifying CTEs -- the same shape
 * createDraftIfEvidenceCurrent uses in lib/work-items/store.ts, proven
 * against real Postgres there. The revision bump runs only
 * `exists(select 1 from inserted)`: a tenancy failure (the item does not
 * exist under this account/client) inserts nothing AND bumps nothing, never
 * a half-applied write where the revision moves but no source landed.
 *
 * A unique violation (the opportunity is already live on another item, or
 * this exact source is already attached here) is deliberately NOT swallowed
 * with `on conflict do nothing`: that would report a genuine conflict as an
 * indistinguishable "not found" or a false "nothing to do", and this
 * codebase never returns a success, or a success-shaped no-op, over a write
 * that did not do what the caller asked. It propagates as a thrown Postgres
 * error naming the violated constraint.
 */
export async function attachSource(input: {
  accountId: string
  clientId: string
  workItemId: string
  source: Omit<LiveSource, 'id'>
  actorId: string
}): Promise<boolean> {
  const sql = db()
  const rows = await sql`
    with inserted as (
      insert into work_item_sources (
        account_id, client_id, work_item_id, opportunity_key, source_kind, source_id,
        rule_version, check_key, evidence_fingerprint, evidence_snapshot, attached_by
      )
      select d.account_id, d.client_id, d.id, ${input.source.opportunityKey}, ${input.source.sourceKind},
        ${input.source.sourceId}, ${input.source.ruleVersion}, ${input.source.checkKey},
        ${input.source.fingerprint}, ${JSON.stringify(input.source.snapshot)}::jsonb, ${input.actorId}::uuid
      from evidence_work_items d
      where d.id = ${input.workItemId} and d.account_id = ${input.accountId} and d.client_id = ${input.clientId}
      returning id
    ), bumped as (
      update evidence_work_items
      set revision = revision + 1, updated_at = now(), updated_by = ${input.actorId}::uuid
      where id = ${input.workItemId} and account_id = ${input.accountId} and client_id = ${input.clientId}
        and exists (select 1 from inserted)
      returning id
    )
    select id from inserted
  `
  return rows.length > 0
}

/**
 * Withdraw a source. Refuses to withdraw the last live one on the item: a
 * work item must keep at least one source's evidence behind it.
 *
 * The remaining-count check lives inside the same statement as the write --
 * `(select count(*) from work_item_sources live where ... ) > 1`, counting
 * this row alongside every other live one -- so there is no window between
 * checking and writing where a concurrent withdrawal of the "other" source
 * could race this one and leave zero.
 *
 * Zero rows returned means: absent, not this account/client's, already
 * withdrawn, or the only live source on the item. The caller cannot
 * distinguish those from the return value alone, on purpose -- the same
 * "absent or not yours" convention every store in this codebase uses.
 */
export async function withdrawSource(input: {
  accountId: string
  clientId: string
  workItemId: string
  opportunityKey: string
  actorId: string
}): Promise<boolean> {
  const sql = db()
  const rows = await sql`
    update work_item_sources s
    set withdrawn_at = now(), withdrawn_by = ${input.actorId}::uuid
    where s.account_id = ${input.accountId} and s.client_id = ${input.clientId}
      and s.work_item_id = ${input.workItemId} and s.opportunity_key = ${input.opportunityKey}
      and s.withdrawn_at is null
      and (select count(*) from work_item_sources live
           where live.work_item_id = s.work_item_id and live.account_id = s.account_id
             and live.client_id = s.client_id and live.withdrawn_at is null) > 1
    returning s.id
  `
  return rows.length > 0
}
