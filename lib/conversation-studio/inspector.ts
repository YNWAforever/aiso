import 'server-only'
import { listClientSources } from '@/lib/sources/service'
import type { SourcePage } from '@/lib/sources/pagination'
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
