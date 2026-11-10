import type { StudioAttachMeta } from './live-types'
import type { StudioInspectorReads } from './types'

/**
 * A turn may carry an attached source: a legacy record (label + version number)
 * or the full metadata a LIVE answer returned (version id, hash, entry counts).
 * Only the LIVE metadata is authoritative, because the saved-evidence path never
 * reads the source body. This pure view model answers, for one turn: which
 * version was used, was it actually read, and has a newer approved version
 * appeared since? It never invents a version when none was recorded.
 */
export type AttachedSourceKind = 'live' | 'recorded'

export type AttachedSourceView = {
  label: string
  kind: AttachedSourceKind
  usedVersionNumber: number | null
  usedVersionId: string | null
  contentHash: string | null
  entriesIncluded: number | null
  entriesTotal: number | null
  truncated: boolean
  /** The brand's current approved version of the same source, when it can be identified. */
  currentVersionNumber: number | null
  currentVersionId: string | null
  /** A newer approved version exists than the one this turn used. */
  stale: boolean
}

type LegacyAttached = { label: string; versionNumber: number }
type Document = NonNullable<StudioInspectorReads['documents']>['items'][number]

/** The documents projection carries only approved, non-revoked sources. */
function findDocument(documents: Document[] | undefined, attach: { sourceId?: string; label: string }): Document | null {
  if (!documents?.length) return null
  if (attach.sourceId) return documents.find(item => item.id === attach.sourceId) ?? null
  const byLabel = documents.filter(item => item.label === attach.label)
  return byLabel.length === 1 ? byLabel[0]! : null
}

export function describeAttachedSource(input: {
  attached?: LegacyAttached | null
  liveAttachment?: StudioAttachMeta | null
  documents: StudioInspectorReads['documents'] | undefined
}): AttachedSourceView | null {
  const live = input.liveAttachment ?? null
  if (!live && !input.attached) return null
  const label = live?.label ?? input.attached!.label
  const usedVersionNumber = live?.versionNumber ?? input.attached?.versionNumber ?? null
  const usedVersionId = live?.versionId ?? null
  const current = findDocument(input.documents?.items, { sourceId: live?.sourceId, label })
  const currentVersionNumber = current?.versionNumber ?? null
  const currentVersionId = current?.versionId ?? null
  const stale = usedVersionNumber !== null && currentVersionNumber !== null && currentVersionNumber > usedVersionNumber
  return {
    label,
    kind: live ? 'live' : 'recorded',
    usedVersionNumber,
    usedVersionId,
    contentHash: live?.contentHash ?? null,
    entriesIncluded: live?.entriesIncluded ?? null,
    entriesTotal: live?.entriesTotal ?? null,
    truncated: live?.truncated ?? false,
    currentVersionNumber,
    currentVersionId,
    stale: stale || (usedVersionId !== null && currentVersionId !== null && usedVersionId !== currentVersionId),
  }
}
