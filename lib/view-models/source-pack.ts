import { sourceFreshness, STALE_AFTER_DAYS, type FreshnessState, type ImportMethod, type SourceDto } from '@/lib/sources/schema'

/**
 * What an owner sees about the facts a draft is allowed to quote.
 *
 * The question this surface has to answer honestly is narrow: **will a draft
 * actually use this?** Three separate server conditions decide that — the source
 * is not revoked, its latest version was approved, and agent use is permitted —
 * and `listAgentUsableSources` requires all three. An owner who flips "allow
 * agent use" on an unapproved source has changed nothing, and a screen that
 * showed a green toggle would be telling them otherwise.
 *
 * So `usability` is derived from the same three conditions, and the integration
 * suite pins the derived in-use set against what the SQL gate actually returns,
 * on real Postgres. A UI that drifts from the gate is the failure worth catching.
 *
 * Two things this deliberately does NOT claim:
 *
 *  - **Import is not a connection.** A version is a point-in-time copy of text
 *    the customer pasted or uploaded. Nothing re-reads the origin, so there is no
 *    "last synced" and no such field exists to be misread as one. `originRef` is
 *    a note about where the text came from, not a live address.
 *  - **Stale does not mean unused.** Freshness is an age, computed on read from
 *    the import time; the gate ignores it entirely. A stale source keeps being
 *    quoted, which is exactly why the age is worth showing — but presenting it as
 *    though it excluded the source would invert the risk.
 */

export type SourceUsability = 'in-use' | 'revoked' | 'awaiting-approval' | 'not-permitted'

export type SourcePackEntry = {
  id: string
  sourceKey: string
  kind: SourceDto['kind']
  label: string
  usability: SourceUsability
  /** Mirrors the server toggle, which is not on its own enough to reach a draft. */
  agentUseAllowed: boolean
  versionNumber: number | null
  /** Identifies the exact approved text a draft would quote and cite. */
  contentHash: string | null
  entryCount: number
  provenance: {
    importMethod: ImportMethod | null
    /** Where the customer said the text came from. A note, never fetched. */
    originRef: string | null
    importedAt: string | null
    /** Whole days since the import, so "180 days ago" is sayable without a clock in the view. */
    ageDays: number | null
  }
  freshness: FreshnessState | null
  revokedAt: string | null
}

export type SourcePack = {
  state: 'ready' | 'empty'
  entries: SourcePackEntry[]
  /** Exactly the sources the server would let a draft cite. */
  inUse: number
  /** In use AND past the staleness age: quoted today, imported long ago. */
  staleInUse: number
  awaitingApproval: number
  revoked: number
  staleAfterDays: number
}

const DAY = 24 * 60 * 60 * 1000

function usabilityOf(source: SourceDto): SourceUsability {
  // Strongest blocker first. Revocation is terminal — reporting "one toggle
  // away" for a revoked source would name a step that does nothing.
  if (source.revokedAt !== null) return 'revoked'
  if (!source.current || source.current.approvedAt === null) return 'awaiting-approval'
  if (!source.agentUseAllowed) return 'not-permitted'
  return 'in-use'
}

function entryOf(source: SourceDto, now: Date): SourcePackEntry {
  const version = source.current
  const importedAt = version?.importedAt ?? null
  return {
    id: source.id,
    sourceKey: source.sourceKey,
    kind: source.kind,
    label: source.label,
    usability: usabilityOf(source),
    agentUseAllowed: source.agentUseAllowed,
    versionNumber: version?.versionNumber ?? null,
    contentHash: version?.contentHash ?? null,
    entryCount: version?.entries.length ?? 0,
    provenance: {
      importMethod: version?.importMethod ?? null,
      originRef: version?.originRef ?? null,
      importedAt,
      ageDays: importedAt === null ? null : Math.floor((now.getTime() - Date.parse(importedAt)) / DAY),
    },
    // Recomputed here rather than trusted from the DTO: both derive from the
    // import time, and one definition is what keeps the age and the label from
    // disagreeing on the boundary day.
    freshness: importedAt === null ? null : sourceFreshness(importedAt, now),
    revokedAt: source.revokedAt,
  }
}

/**
 * Pure. Takes what the caller already loaded under its own tenancy scope and
 * returns what to render; reads no database and makes no network call.
 *
 * Revoked sources are kept, not hidden. A draft that cited one stays explainable
 * only while the owner can still see it existed.
 */
export function buildSourcePack(sources: SourceDto[], now = new Date()): SourcePack {
  const entries = sources.map(source => entryOf(source, now))
  const count = (predicate: (entry: SourcePackEntry) => boolean) => entries.filter(predicate).length
  return {
    state: entries.length ? 'ready' : 'empty',
    entries,
    inUse: count(entry => entry.usability === 'in-use'),
    staleInUse: count(entry => entry.usability === 'in-use' && entry.freshness === 'stale'),
    awaitingApproval: count(entry => entry.usability === 'awaiting-approval'),
    revoked: count(entry => entry.usability === 'revoked'),
    staleAfterDays: STALE_AFTER_DAYS,
  }
}
