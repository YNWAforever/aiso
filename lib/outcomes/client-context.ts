import type { VersionDetail } from '@/lib/change-sets/types'
import type { DraftSnapshotV1 } from '@/lib/opportunities/types'
import type { OutcomeResponse, SourceRef } from './types'
import { parseOutcomeResponse } from './dto'
import { parseMultiSourceOutcomeResponse, type MultiSourceOutcomeContext, type MultiSourceOutcomeResponse } from './multi-source'

export type SelectedOutcomeExpectation = { schemaVersion: 1 | 2; context: MultiSourceOutcomeContext }
export type SelectedOutcomeResponse = OutcomeResponse | MultiSourceOutcomeResponse

function scopeId(value: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw Error('Invalid outcome context')
  return value.toLowerCase()
}
function frozenRef(snapshot: DraftSnapshotV1): SourceRef {
  const evidence = snapshot.evidence
  const source: SourceRef = evidence.kind === 'scan-check'
    ? { kind: 'scan-check', id: evidence.scanId, checkKey: evidence.checkKey }
    : { kind: 'pulse-metric', id: evidence.id, checkKey: null }
  if (snapshot.source.kind !== source.kind || snapshot.source.id !== source.id ||
    (snapshot.source.checkKey !== undefined && snapshot.source.checkKey !== source.checkKey)) throw Error('Contradictory frozen source')
  return source
}

/** All expectations come from the parsed selected version and the owned parent, never the outcome reply. */
export function selectedOutcomeExpectation(clientId: string, itemId: string, version: VersionDetail): SelectedOutcomeExpectation {
  const client = scopeId(clientId), item = scopeId(itemId), versionId = scopeId(version.id)
  if (scopeId(version.workItemId) !== item || !/^[0-9a-f]{64}$/.test(version.contentHash) ||
    (version.schemaVersion !== 1 && version.schemaVersion !== 2)) throw Error('Invalid outcome context')
  const snapshots = version.schemaVersion === 2 ? version.evidenceSnapshots : [version.evidenceSnapshot]
  if (!Array.isArray(snapshots) || snapshots.length === 0) throw Error('Missing frozen sources')
  return { schemaVersion: version.schemaVersion, context: { clientId: client, itemId: item, versionId,
    contentHash: version.contentHash, sourceRefs: snapshots.map(frozenRef) } }
}

/** A local read fence only. Viewer identity is never added to a URL or treated as a capability. */
export function selectedOutcomeReadKey(expected: SelectedOutcomeExpectation, viewerKey: string, refreshKey: number, retry: number): string {
  if (typeof viewerKey !== 'string' || !viewerKey.trim() ||
    !Number.isSafeInteger(refreshKey) || refreshKey < 0 || !Number.isSafeInteger(retry) || retry < 0) throw Error('Invalid outcome read fence')
  const context = expected.context
  return JSON.stringify([context.clientId, context.itemId, context.versionId, context.contentHash, expected.schemaVersion,
    context.sourceRefs.map((ref, index) => ref ? [index, ref.kind, ref.id, ref.checkKey] : [index, null]), viewerKey, refreshKey, retry])
}

export function parseSelectedOutcome(value: unknown, expected: SelectedOutcomeExpectation): SelectedOutcomeResponse {
  if (expected.schemaVersion === 2) return parseMultiSourceOutcomeResponse(value, expected.context)
  if (expected.schemaVersion !== 1) throw Error('Invalid outcome schema')
  const parsed = parseOutcomeResponse(value), context = expected.context
  if (parsed.clientId !== context.clientId || parsed.itemId !== context.itemId || parsed.versionId !== context.versionId ||
    parsed.contentHash !== context.contentHash) throw Error('Outcome does not match the selected version')
  // V1's existing null-baseline states remain admitted by its own narrow decoder.
  return parsed
}
