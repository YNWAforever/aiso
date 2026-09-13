import 'server-only'
import { db } from '@/lib/db'
import type { QuestionDeclaration, RegisteredAsset } from '@/lib/view-models/asset-convergence'
import type { RegisteredPage, SuggestionSource } from '@/lib/assets/merge-suggestions'
import type { DraftSnapshotV1 } from '@/lib/opportunities/types'

/**
 * The real data behind a merge suggestion.
 *
 * toRegisteredPages reuses the assets/declarations lists lib/assets/store.ts
 * already provides to buildAssetConvergence, rather than re-deriving the same
 * join in a second SQL statement that would have to be kept in sync with it
 * forever.
 *
 * loadSuggestionSources is the one genuinely new read: nothing existing lists
 * every live work_item_sources row for a whole client (listLiveSources in
 * lib/work-items/sources.ts is scoped to one item), which a cross-item
 * suggestion needs. evidence_snapshot is a full, versioned DraftSnapshotV1;
 * buildMergeSuggestions only needs the two fields that place a source on a
 * page, so this is the one place that reaches into snapshot.evidence to pull
 * them into the flat shape it expects.
 *
 * Known limitation, not closed here: this only sees sources that already
 * belong to a work item. A page with one already-drafted finding and one
 * still-undrafted question never appears here as a "ready to attach" pair —
 * the undrafted side has no work_item_sources row to read at all. Reaching
 * that case needs the live opportunity feed (lib/opportunities/service.ts),
 * which carries its own recency window and is out of scope for this task.
 */

export function toRegisteredPages(assets: RegisteredAsset[], declarations: QuestionDeclaration[]): RegisteredPage[] {
  return assets.map(asset => ({
    id: asset.id,
    origin: asset.origin,
    label: asset.label,
    promptIds: declarations.filter(declared => declared.assetId === asset.id).map(declared => declared.promptId),
  }))
}

export async function loadSuggestionSources(accountId: string, clientId: string): Promise<SuggestionSource[]> {
  const sql = db()
  const rows = await sql`
    select work_item_id, opportunity_key, source_kind, evidence_snapshot
    from work_item_sources
    where account_id = ${accountId} and client_id = ${clientId} and withdrawn_at is null
    order by work_item_id, opportunity_key
  `
  return rows.map(row => {
    const evidence = (row.evidence_snapshot as DraftSnapshotV1).evidence
    return {
      itemId: String(row.work_item_id),
      opportunityKey: String(row.opportunity_key),
      sourceKind: row.source_kind as SuggestionSource['sourceKind'],
      snapshot: evidence.kind === 'scan-check'
        ? { evaluated: evidence.evaluated, final: evidence.final }
        : { promptId: evidence.promptId },
      // A live work_item_sources row always belongs to an item that exists,
      // so it is drafted by definition. The field stays because
      // buildMergeSuggestions reads it to detect "both already drafted".
      hasDraft: true,
    }
  })
}
