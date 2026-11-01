import 'server-only'
import { listClientSources } from '@/lib/sources/service'
import { listAgentUsableSources, type SourceScope } from '@/lib/sources/store'
import type { SourcePage } from '@/lib/sources/pagination'
import type { StudioAttachCandidate } from './live-types'
import type { StudioInspectorReads } from './types'

/** The sources service rechecks session ownership. Project metadata only; never prompt text. */
export async function loadStudioDocuments(clientId: string): Promise<StudioInspectorReads['documents']> {
  const response = await listClientSources(clientId)
  if (!response.ok) return null
  const page = await response.json() as SourcePage
  return {
    items: page.items.flatMap(source => source.revokedAt === null && source.current?.approvedAt ? [{
      id: source.id, label: source.label, versionId: source.current.id,
      versionNumber: source.current.versionNumber, approvedAt: source.current.approvedAt,
      importedAt: source.current.importedAt,
    }] : []),
    truncated: page.nextCursor !== null,
  }
}

/**
 * Candidates the operator may attach: the same approved ∧ agent-use-allowed ∧
 * non-revoked predicates as LIVE resolution. Only ids and version metadata leave
 * the server; entry bodies stay in the database until Send.
 */
export async function loadStudioAttachCandidates(scope: SourceScope): Promise<StudioAttachCandidate[]> {
  const sources = await listAgentUsableSources(scope)
  return sources.flatMap(source => source.current ? [{
    id: source.id,
    label: source.label,
    versionNumber: source.current.versionNumber,
    contentHash: source.current.contentHash,
  }] : [])
}
