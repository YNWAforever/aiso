import { approvedVersion } from '../delivery/fixtures'
import { approvedMultiSourceVersion, editSpecs } from '../delivery/multi-source-fixtures'
import { freezeMultiSourceReview } from '@/lib/change-sets/validation'
import type { VersionDetail } from '@/lib/change-sets/types'
import type { WorkItem } from '@/lib/work-items/schema'
export const version = approvedVersion()
export const clientId = '123e4567-e89b-42d3-a456-426614174004'
export const draft: WorkItem = { id: version.workItemId, clientId, status: 'draft', revision: 1,
  title: version.title, action: version.action, notes: version.notes, locale: version.locale,
  evidenceSnapshot: version.evidenceSnapshot, createdAt: version.submittedAt, updatedAt: version.submittedAt }
export const older = { ...version, id: '123e4567-e89b-42d3-a456-426614174005' }
export const fixtureProps = { clientId, workItemId: draft.id, initialDraft: draft,
  initial: { versions: [version, older], latestVersionId: version.id, nextCursor: null }, initialVersion: version }
const pendingVersion = { ...version, decision: null, capabilities: { canDecide: true } }
export const pendingProps = { ...fixtureProps,
  initial: { ...fixtureProps.initial, versions: [pendingVersion, older] }, initialVersion: pendingVersion }

function smeDeliveryProps(saved: VersionDetail) {
  return { clientId, workItemId: saved.workItemId,
    initialDraft: { ...draft, id: saved.workItemId, title: saved.title, action: saved.action, notes: saved.notes, locale: saved.locale, revision: saved.draftRevision },
    initial: { versions: [saved], latestVersionId: saved.id, nextCursor: null }, initialVersion: saved, smeCopilot: true }
}
export const smeProps = smeDeliveryProps(version)
export const multiVersion = approvedMultiSourceVersion()
export const smeV2Props = smeDeliveryProps(multiVersion)
export const developerVersion = approvedMultiSourceVersion(editSpecs[0])
export const smeDeveloperProps = smeDeliveryProps(developerVersion)
const newerDraft = { ...draft, revision: 2, title: 'Newer saved version' }
const newerFrozen = freezeMultiSourceReview(newerDraft, multiVersion.evidenceSnapshots)
const newerVersion: VersionDetail = { ...multiVersion, ...newerFrozen.content,
  id: '123e4567-e89b-42d3-a456-426614174006', versionNumber: 2,
  contentHash: newerFrozen.contentHash, validation: newerFrozen.validation, decision: null, capabilities: { canDecide: false } }
export const smeHistoricalProps = { ...smeV2Props, initialDraft: newerDraft,
  initial: { versions: [multiVersion, newerVersion], latestVersionId: newerVersion.id, nextCursor: null } }
