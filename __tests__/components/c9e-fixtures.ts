import { approvedVersion } from '../delivery/fixtures'
import { approvedMultiSourceVersion, editSpecs } from '../delivery/multi-source-fixtures'
import { freezeMultiSourceReview, freezeReview } from '@/lib/change-sets/validation'
import type { VersionWorkspaceProps } from '@/components/change-sets/VersionWorkspace'
import type { EditSpecV1 } from '@/lib/site-edit/edit-spec'
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

function smeDeliveryProps(saved: VersionDetail, brandId = clientId): VersionWorkspaceProps {
  return { clientId: brandId, workItemId: saved.workItemId,
    initialDraft: { ...draft, clientId: brandId, id: saved.workItemId, title: saved.title, action: saved.action, notes: saved.notes, locale: saved.locale, revision: saved.draftRevision, editSpec: saved.editSpec },
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

/** Every edit, identity and draft field is set BEFORE the real freezer hashes it. */
export function websiteProps({ schema = 1, spec = editSpecs[0], brandId = clientId,
  itemId = draft.id, versionId = version.id, title = 'Approved website edit' }: {
  schema?: 1 | 2; spec?: EditSpecV1; brandId?: string; itemId?: string; versionId?: string; title?: string
} = {}): VersionWorkspaceProps {
  const item: WorkItem = { ...draft, id: itemId, clientId: brandId, title, editSpec: spec }
  const frozen = schema === 1 ? freezeReview(item) : freezeMultiSourceReview(item, multiVersion.evidenceSnapshots)
  const saved: VersionDetail = { ...frozen.content, contentHash: frozen.contentHash, validation: frozen.validation,
    id: versionId, versionNumber: 1, submittedBy: version.submittedBy, submittedAt: version.submittedAt,
    decision: version.decision, capabilities: version.capabilities }
  return smeDeliveryProps(saved, brandId)
}
export const smeWebsiteProps = websiteProps()
export const smeRemovalProps = websiteProps({ spec: editSpecs[1] })
export const smeV2RemovalProps = websiteProps({ schema: 2, spec: editSpecs[1] })
export const smeOtherScopeProps = websiteProps({ brandId: '123e4567-e89b-42d3-a456-426614174011',
  itemId: '123e4567-e89b-42d3-a456-426614174012', versionId: '123e4567-e89b-42d3-a456-426614174013', title: 'Other brand approved edit' })
const websitePending = { ...smeWebsiteProps.initialVersion!, decision: null, capabilities: { canDecide: true } }
export const smeWebsitePendingProps: VersionWorkspaceProps = { ...smeWebsiteProps, initialVersion: websitePending,
  initial: { versions: [websitePending], latestVersionId: websitePending.id, nextCursor: null } }
const preparedDraft = { ...smeWebsiteProps.initialDraft!, revision: 2, title: 'Saved work awaiting preparation' }
export const smeWebsitePrepareProps: VersionWorkspaceProps = { ...smeWebsiteProps, initialDraft: preparedDraft }
const nextWebsite = freezeReview(preparedDraft)
const nextWebsiteVersion: VersionDetail = { ...nextWebsite.content, contentHash: nextWebsite.contentHash, validation: nextWebsite.validation,
  id: newerVersion.id, versionNumber: 2, submittedBy: version.submittedBy, submittedAt: version.submittedAt, decision: null, capabilities: { canDecide: false } }
export const smeWebsiteHistoricalProps: VersionWorkspaceProps = { ...smeWebsiteProps, initialDraft: preparedDraft,
  initial: { versions: [smeWebsiteProps.initialVersion!, nextWebsiteVersion], latestVersionId: nextWebsiteVersion.id, nextCursor: null } }
export const smeSingleV2Props = smeDeliveryProps(approvedMultiSourceVersion(editSpecs[0], [multiVersion.evidenceSnapshots[0]]))
export const hydratedVariants = { smeWebsite: smeWebsiteProps, smeRemoval: smeRemovalProps, smeV2Removal: smeV2RemovalProps, smeSingleV2: smeSingleV2Props,
  smeOtherScope: smeOtherScopeProps, smeWebsitePending: smeWebsitePendingProps, smeWebsitePrepare: smeWebsitePrepareProps,
  smeWebsiteHistorical: smeWebsiteHistoricalProps, legacyWebsite: { ...smeWebsiteProps, smeCopilot: false } }
