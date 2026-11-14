import 'server-only'
import { buildScanEvidence, CHECK_VERSIONS, describeEvidenceUrl } from '@/lib/scan-evidence'
import { projectStoredOutcomeSnapshot } from '@/lib/outcomes/sources'
import { evaluateOutcomes } from '@/lib/outcomes/evaluate'
import { parseOutcomeResponse } from '@/lib/outcomes/dto'
import { evaluateMultiSourceOutcomes, multiSourceOutcomeContext, parseMultiSourceOutcomeResponse } from '@/lib/outcomes/multi-source'
import { utcMicros } from '@/lib/outcomes/time'
import type { JourneyOutcomeSnapshot, JourneyScenario } from './types'
type ProjectionScenario = Pick<JourneyScenario, 'ids' | 'clocks' | 'timeline' | 'kind'>

export function journeyScanEnvelope(at: string | null, assessment: 'warn' | 'pass', complete = true) {
  return buildScanEvidence({ requestedUrl: 'https://harbour-tea.example/products/oolong', evaluatedUrl: 'https://harbour-tea.example/products/oolong',
    industry: 'retail_ecommerce', region: 'HK', sitemapSource: 'unknown', collectedAt: at ?? undefined,
    checks: complete ? Object.fromEntries(Object.keys(CHECK_VERSIONS).map(key => [key, { assessment: key === 'c4_structured_data' ? assessment : 'pass', collection: 'complete' }]))
      : { c4_structured_data: { assessment, collection: 'complete' } },
    observations: [{ check: 'page', observedAt: at ?? undefined, collection: 'complete', httpStatus: 200,
      target: describeEvidenceUrl('https://harbour-tea.example/products/oolong'), signals: { mimeType: 'text/html' } }],
  })
}
const rowId = (index: number) => `d1500000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`

/** Actual private memory state -> the production retained SQL-envelope shape. No DB calls. */
export function createJourneyRawSnapshot(scenario: ProjectionScenario, snapshot: JourneyOutcomeSnapshot) {
  const { scope, version, decisionRowId, events, evaluatedAt, clockKey, observationProfile } = snapshot
  if (scope.accountId !== scenario.ids.accountId || scope.clientId !== scenario.ids.clientId || scope.itemId !== scenario.ids.itemId ||
    version.workItemId !== scope.itemId || evaluatedAt !== scenario.clocks[clockKey] ||
    !['stored', 'unavailable-scan', 'limited-scan', 'diagnostic-heavy'].includes(observationProfile)) throw new Error('Invalid sample projection scope')
  const { id, versionNumber, contentHash, validation, submittedBy, submittedAt, decision, capabilities, ...content } = version
  void capabilities
  if (decision && !decisionRowId) throw new Error('Missing committed sample decision')
  const tenant = { account_id: scope.accountId, client_id: scope.clientId, work_item_id: scope.itemId }
  const decisionRecord = decision ? { ...tenant, id: decisionRowId, version_id: id, content_hash: contentHash,
    decision: decision.decision, reason: decision.reason, actor: decision.decidedBy, actor_id: decision.decidedBy.profileId, decided_at: decision.decidedAt } : null
  const history = events.map(({ event, approvalDecisionId }) => {
    const common = { ...tenant, schema_version: event.schemaVersion, id: event.eventId, version_id: event.versionId,
      content_hash: event.contentHash, actor: event.actor, actor_id: event.actor.profileId, recorded_at: event.recordedAt,
      kind: event.kind, provenance: 'self_reported' }
    if (event.kind === 'attest') {
      if (!approvalDecisionId) throw new Error('Missing committed sample approval binding')
      return { ...common, provenance: event.provenance, approval_decision_id: approvalDecisionId, approval_decision: 'approved', destination: event.destination,
        delivered_at: event.deliveredAt, note: event.note, target_attestation_id: null, target_kind: null, reason: null }
    }
    if (approvalDecisionId !== null) throw new Error('Unexpected withdrawal approval binding')
    return { ...common, approval_decision_id: null, approval_decision: null, destination: null, delivered_at: null, note: null,
      target_attestation_id: event.targetAttestationId, target_kind: 'attest', reason: event.reason }
  })
  const sources = version.schemaVersion === 2 ? version.evidenceSnapshots : [version.evidenceSnapshot]
  const hasScan = sources.some(source => source.evidence.kind === 'scan-check')
  const pulseSubjects = [...new Map(sources.flatMap(source => source.evidence.kind === 'pulse-metric'
    ? [[JSON.stringify([source.evidence.question, source.evidence.platform, source.evidence.promptId]), source.evidence] as const] : [])).values()]
  // Early reads never contain future-retained observations. One union pool per
  // kind is bounded before projection; duplicates never multiply private rows.
  const retained = utcMicros(evaluatedAt) >= utcMicros(scenario.timeline.observationRecordedAt)
  const envelope = retained && hasScan ? observationProfile === 'unavailable-scan' ? { unavailable: true }
    : journeyScanEnvelope(observationProfile === 'diagnostic-heavy' ? null : scenario.timeline.observedAt, 'pass', scenario.kind !== 'v1-scan') : null
  const scans = retained && hasScan ? Array.from({ length: observationProfile === 'limited-scan' ? 201 : observationProfile === 'diagnostic-heavy' ? 200 : 1 }, (_, index) => ({
    id: rowId(index + 1), created_at: scenario.timeline.observationRecordedAt, envelope,
  })) : []
  const pulse = retained && pulseSubjects.length ? Array.from({ length: observationProfile === 'diagnostic-heavy' ? 200 : pulseSubjects.length }, (_, index) => {
    const subject = pulseSubjects[index % pulseSubjects.length]
    return { id: rowId(index + 1001), question: subject.question, platform: subject.platform, prompt_id: subject.promptId,
      created_at: scenario.timeline.observationRecordedAt, has_answer: true, brand_mentioned: false }
  }).slice(0, 201) : []
  return { member: true, owned: true, evaluated_at: evaluatedAt,
    version: { ...tenant, id, version_number: versionNumber, draft_revision: version.draftRevision,
      content, content_hash: contentHash, validation, submitter: submittedBy, submitted_at: submittedAt, decision_record: decisionRecord, can_decide: false },
    events: history, scans, pulse }
}

export function projectJourneyInput(scenario: ProjectionScenario, snapshot: JourneyOutcomeSnapshot) {
  return projectStoredOutcomeSnapshot(createJourneyRawSnapshot(scenario, snapshot))
}
export function projectJourneyOutcomes(scenario: ProjectionScenario, snapshot: JourneyOutcomeSnapshot) {
  const input = projectJourneyInput(scenario, snapshot)
  return 'schemaVersion' in input
    ? parseMultiSourceOutcomeResponse(evaluateMultiSourceOutcomes(input), multiSourceOutcomeContext(input))
    : parseOutcomeResponse(evaluateOutcomes(input))
}
