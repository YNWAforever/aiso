import 'server-only'
import { createHash } from 'node:crypto'
import { freezeReview } from '@/lib/change-sets/validation'
import type { DecisionDTO, VersionDetail } from '@/lib/change-sets/types'
import type { WorkItem } from '@/lib/work-items/schema'
import { fingerprintEvidence } from '@/lib/opportunities/fingerprint'
import { deliveryActor } from './dto'
import { deliveryHash, deliveryId, deliveryTime } from './input'
import { parseReviewDecision } from '@/lib/approvals/input'
import type { ExportArtifact } from './types'

/** Named so an export receipt records which renderer produced its artifact hash. */
export const EXPORT_RENDERER_VERSION = 'delivery-export.v1'
const LIMITATION = 'delivery-export.v1: This is a retained approved review package. Export does not attest delivery, verify publication, or demonstrate measured impact.'
function invalid(): never { throw new Error('DELIVERY_VALIDATION_FAILED') }
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => [key, canonical(entry)]))
  }
  return value
}

export function createDeliveryExport(version: VersionDetail, format: 'json' | 'text'): ExportArtifact {
  let envelope: Record<string, unknown>
  let versionId: string
  try {
    if (format !== 'json' && format !== 'text') invalid()
    if (version.schemaVersion !== 1 || !Number.isSafeInteger(version.versionNumber) || version.versionNumber < 1) invalid()
    versionId = deliveryId(version.id)
    const itemId = deliveryId(version.workItemId)
    if (itemId !== version.workItemId) invalid()
    const frozen = freezeReview({ id: itemId, revision: version.draftRevision, title: version.title, action: version.action,
      notes: version.notes, locale: version.locale, evidenceSnapshot: version.evidenceSnapshot } as WorkItem)
    if (deliveryHash(version.contentHash) !== frozen.contentHash || fingerprintEvidence(version.validation) !== fingerprintEvidence(frozen.validation)) invalid()
    const submittedBy = deliveryActor(version.submittedBy)
    const submittedAt = deliveryTime(version.submittedAt, 6)
    let decision: DecisionDTO | null = null
    if (version.decision !== null) {
      const saved = version.decision
      if (saved.decision !== 'approved' && saved.decision !== 'changes_requested') invalid()
      const decidedBy = deliveryActor(saved.decidedBy)
      if (decidedBy.role !== 'account_approver' || decidedBy.profileId === submittedBy.profileId) invalid()
      // Retained approvals follow C9d's own text contract, not new delivery text rules.
      const { reason } = parseReviewDecision({ decision: saved.decision, reason: saved.reason, requestId: versionId })
      if (reason !== saved.reason) invalid()
      decision = { decision: saved.decision, reason, decidedBy, decidedAt: deliveryTime(saved.decidedAt, 6) }
    }
    envelope = { schemaVersion: 'delivery-export.v1', id: versionId, versionNumber: version.versionNumber,
      contentHash: frozen.contentHash, content: frozen.content, validation: frozen.validation, submittedBy, submittedAt, decision,
      limitations: [LIMITATION] }
  } catch { invalid() }
  if ((envelope.decision as DecisionDTO | null)?.decision !== 'approved') throw new Error('DELIVERY_NOT_APPROVED')
  const sorted = canonical(envelope)
  const json = JSON.stringify(sorted)
  const exportHash = createHash('sha256').update(json, 'utf8').digest('hex')
  const decision = envelope.decision as DecisionDTO
  const body = format === 'json' ? json : [
    'Approved review package', `Version ID: ${versionId}`, `Version number: ${envelope.versionNumber}`,
    `Content hash: ${envelope.contentHash}`, `Submitted at: ${envelope.submittedAt}`,
    `Approved at: ${decision.decidedAt}`, `Export hash: ${exportHash}`,
    'The export hash identifies the canonical JSON envelope, not these text bytes.', LIMITATION,
    '', 'Complete canonical review envelope:', JSON.stringify(sorted, null, 2), '',
  ].join('\n')
  return { body, exportHash, contentType: format === 'json' ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    filename: `delivery-${versionId}.${format === 'json' ? 'json' : 'txt'}` }
}
