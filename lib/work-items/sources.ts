import 'server-only'
import { db } from '@/lib/db'
import type { OpportunitySourceKind } from '@/lib/opportunities/types'

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
  snapshot: Record<string, unknown>
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
  snapshot: row.evidence_snapshot as Record<string, unknown>,
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
