import { approvedVersion } from '../delivery/fixtures'
import type { WorkItem } from '@/lib/work-items/schema'
export const version = approvedVersion()
export const clientId = '123e4567-e89b-42d3-a456-426614174004'
export const draft: WorkItem = { id: version.workItemId, clientId, status: 'draft', revision: 1,
  title: version.title, action: version.action, notes: version.notes, locale: version.locale,
  evidenceSnapshot: version.evidenceSnapshot, createdAt: version.submittedAt, updatedAt: version.submittedAt }
export const older = { ...version, id: '123e4567-e89b-42d3-a456-426614174005' }
export const fixtureProps = { clientId, workItemId: draft.id, initialDraft: draft,
  initial: { versions: [version, older], latestVersionId: version.id, nextCursor: null }, initialVersion: version }
export const pendingProps = { ...fixtureProps, initialVersion: { ...version, decision: null, capabilities: { canDecide: true } } }
