import { freezeMultiSourceReview } from '@/lib/change-sets/validation'
import type { VersionDetail } from '@/lib/change-sets/types'
import type { DraftSnapshotV1 } from '@/lib/opportunities/types'
import { deriveSuggestions } from '@/lib/opportunities/rules'
import { buildScanEvidence } from '@/lib/scan-evidence'
import type { EditSpecV1 } from '@/lib/site-edit/edit-spec'
import { approvedVersion, REQUEST_ID } from './fixtures'

/** Real scan serializer/rule output; no invented evidence fields or live reads. */
export function scanSnapshot(): DraftSnapshotV1 {
  const envelope = buildScanEvidence({
    requestedUrl: 'https://example.com/private?q=redacted', evaluatedUrl: 'https://example.com',
    industry: 'technology', region: 'HK', sitemapSource: 'fetched',
    checks: { c1_robots: { assessment: 'warn', collection: 'complete' } },
    observations: [{ check: 'page', collection: 'complete', httpStatus: 200, target: { origin: 'https://example.com' } }],
  })
  const suggestion = deriveSuggestions({ kind: 'scan-check', scanId: REQUEST_ID, recordedAt: null, envelope })[0]
  if (suggestion.evidence.kind !== 'scan-check') throw new Error('expected scan suggestion')
  return { schemaVersion: 1, source: suggestion.source, ruleVersion: suggestion.ruleVersion,
    evidence: suggestion.evidence, limitations: suggestion.limitations,
    titleKey: suggestion.titleKey, actionKey: suggestion.actionKey, args: suggestion.args,
    locale: 'en', initialTitle: 'Review check', initialAction: 'Review the recorded check.' }
}

export function approvedMultiSourceVersion(
  editSpec?: EditSpecV1 | null,
  snapshots: DraftSnapshotV1[] = [scanSnapshot(), approvedVersion().evidenceSnapshot, scanSnapshot()],
): Extract<VersionDetail, { schemaVersion: 2 }> {
  const base = approvedVersion()
  const frozen = freezeMultiSourceReview({ id: base.workItemId, revision: base.draftRevision,
    title: base.title, action: base.action, notes: base.notes, locale: base.locale, editSpec }, snapshots)
  return { ...frozen.content, contentHash: frozen.contentHash, validation: frozen.validation,
    id: base.id, versionNumber: base.versionNumber, submittedBy: base.submittedBy,
    submittedAt: base.submittedAt, decision: base.decision, capabilities: base.capabilities }
}

export const editSpecs: EditSpecV1[] = [
  { schemaVersion: 1, kind: 'jsonld', targetUrl: 'https://example.com/', schemaType: 'Organization', payload: { '@context': 'https://schema.org', '@type': 'Organization', name: '保留 é' } },
  { schemaVersion: 1, kind: 'jsonld_remove', targetUrl: 'https://example.com/', schemaType: 'Organization', payload: { '@context': 'https://schema.org', '@type': 'Organization', name: '保留 é' } },
  { schemaVersion: 1, kind: 'meta', targetUrl: 'https://example.com/', title: '保留 é', description: null },
  { schemaVersion: 1, kind: 'llms_txt', targetUrl: 'https://example.com/llms.txt', content: '# 保留 é\n\nRecorded evidence\n' },
]

/** Frozen insert/read wire shape; JSON roundtrip also models jsonb key reordering. */
export function versionRow(version: VersionDetail): Record<string, unknown> {
  const { id, versionNumber, contentHash, validation, submittedBy, submittedAt, decision, capabilities: _capabilities, ...content } = version
  return { id, work_item_id: version.workItemId, draft_revision: version.draftRevision,
    version_number: versionNumber, content, content_hash: contentHash, validation,
    submitter: submittedBy, submitted_at: submittedAt, can_decide: false,
    decision_record: decision === null ? null : { decision: decision.decision, reason: decision.reason,
      actor: decision.decidedBy, actor_id: decision.decidedBy.profileId, decided_at: decision.decidedAt,
      version_id: id, content_hash: contentHash } }
}
