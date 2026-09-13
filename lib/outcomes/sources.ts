import 'server-only'
import { validIds, versionDTO } from '@/lib/change-sets/store'
import { deliveryEventDTO } from '@/lib/delivery/dto'
import { compareScanEvidence, readScanEvidence } from '@/lib/scan-evidence'
import type { ScanSuggestionEvidence } from '@/lib/opportunities/types'
import type { OutcomeInput, SafeEvidence } from './types'
import { OUTCOME_CANDIDATE_LIMIT, OUTCOME_REASON_CODES } from './types'
import { utcMicros } from './time'

function invalid(): never { throw new Error('OUTCOMES_UNAVAILABLE') }
function record(value: unknown): Record<string, unknown> {
 if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
 return value as Record<string, unknown>
}
function id(value: unknown): string {
 if (typeof value !== 'string' || !validIds(value)) invalid()
 return value.toLowerCase()
}
function time(value: unknown): string {
 if (typeof value !== 'string') invalid()
 utcMicros(value)
 return value
}
function nullableTime(value: unknown): string | null { return value === null ? null : time(value) }
function scanReasons(baseline: ScanSuggestionEvidence, envelope: NonNullable<ReturnType<typeof readScanEvidence>>): string[] {
 // The frozen baseline contains one check, not a full envelope. Never reconstruct it.
 // Self-comparison delegates current schema-wide limitations to the existing contract.
 const comparison = compareScanEvidence(envelope, envelope)
 const reasons = [...envelope.limitations.filter(reason => (OUTCOME_REASON_CODES as readonly string[]).includes(reason))]
 if (comparison.reason) reasons.push(comparison.reason)
 if (baseline.comparisonSignature !== envelope.comparisonSignature) reasons.push('different-methods-or-scope')
 if (baseline.check.collection !== 'complete') reasons.push('incomplete-collection')
 return [...new Set(reasons)]
}
/** Private SQL envelope -> safe policy input. Malformed primary state throws; malformed sources remain unavailable. */
export function projectOutcomeSnapshot(value: unknown): OutcomeInput {
 const row = record(value), rawVersion = record(row.version)
 if (row.member !== true || row.owned !== true) invalid()
 const version = versionDTO(rawVersion)
 // Multi-source versions (051, schemaVersion 2) are not yet supported here --
 // mirrors lib/delivery/export.ts's own `schemaVersion !== 1` guard, and for
 // the same reason: refuse explicitly rather than crash on
 // version.evidenceSnapshot being undefined once a v2 row can exist.
 if (version.schemaVersion !== 1) invalid()
 const accountId = id(rawVersion.account_id), clientId = id(rawVersion.client_id)
 const evaluatedAt = time(row.evaluated_at), now = utcMicros(evaluatedAt)
 if (!Array.isArray(row.events)) invalid()
 const eventIds = new Set<string>()
 const events = row.events.map(raw => {
  const r = record(raw), event = deliveryEventDTO(r)
  if (id(r.account_id) !== accountId || id(r.client_id) !== clientId || id(r.work_item_id) !== version.workItemId ||
      event.versionId !== version.id || event.contentHash !== version.contentHash || eventIds.has(event.eventId) || utcMicros(event.recordedAt) > now) invalid()
  eventIds.add(event.eventId)
  if (event.kind === 'attest') {
   const decision = record(rawVersion.decision_record)
   if (version.decision?.decision !== 'approved' || r.approval_decision !== 'approved' || id(r.approval_decision_id) !== id(decision.id) ||
       utcMicros(event.deliveredAt) > utcMicros(event.recordedAt) || utcMicros(event.deliveredAt) < utcMicros(time(decision.decided_at))) invalid()
  } else if (r.approval_decision_id !== null || r.approval_decision !== null) invalid()
  return event
 })
 const attestations = events.filter(e => e.kind === 'attest')
 const withdrawn = new Set<string>()
 for (const event of events) if (event.kind === 'withdraw') {
  const target = attestations.find(e => e.eventId === event.targetAttestationId)
  if (!target || withdrawn.has(target.eventId) || utcMicros(event.recordedAt) < utcMicros(target.recordedAt)) invalid()
  withdrawn.add(target.eventId)
 }
 const active = attestations.filter(e => !withdrawn.has(e.eventId))
 if (active.length > 1) invalid()
 const snapshot = version.evidenceSnapshot.evidence
 const baseline: SafeEvidence = snapshot.kind === 'pulse-metric'
  ? { source: { kind: snapshot.kind, id: snapshot.id, checkKey: null }, recordedAt: nullableTime(snapshot.recordedAt), collectedAt: null,
      verdict: snapshot.result, reasons: ['collection-time-unknown','pulse-provenance-incomplete'] }
  : { source: { kind: snapshot.kind, id: snapshot.scanId, checkKey: snapshot.checkKey }, recordedAt: nullableTime(snapshot.recordedAt),
      collectedAt: nullableTime(snapshot.collectedAt), verdict: snapshot.check.assessment, reasons: [...new Set(['final-path-identity-withheld', ...snapshot.limitations.filter(reason => (OUTCOME_REASON_CODES as readonly string[]).includes(reason))])] }
 const result: OutcomeInput = {
  clientId, itemId: version.workItemId, versionId: version.id, contentHash: version.contentHash, evaluatedAt,
  anchorState: active.length ? 'active' : attestations.length ? 'withdrawn' : 'no-delivery',
  anchor: active[0] ? {id:active[0].eventId,deliveredAt:active[0].deliveredAt,recordedAt:active[0].recordedAt} : null,
  baseline, candidates: [], sourceState: 'ok', truncated: false,
 }
 const sources = snapshot.kind === 'pulse-metric' ? row.pulse : row.scans
 if (!Array.isArray(sources)) { result.sourceState = 'unavailable'; return result }
 result.truncated = sources.length > OUTCOME_CANDIDATE_LIMIT
 for (const raw of sources.slice(0, OUTCOME_CANDIDATE_LIMIT)) {
  let safe: SafeEvidence | null = null
  try {
   const candidate = record(raw)
   safe = {source:{kind:snapshot.kind,id:id(candidate.id),checkKey:baseline.source.checkKey},recordedAt:null,collectedAt:null,verdict:null,reasons:[]}
   safe.recordedAt = nullableTime(candidate.created_at)
   if (snapshot.kind === 'pulse-metric') {
    if (candidate.question !== snapshot.question || candidate.platform !== snapshot.platform ||
        (snapshot.promptId !== null && candidate.prompt_id !== snapshot.promptId)) {
     safe = null; invalid()
    }
    if (typeof candidate.has_answer !== 'boolean' || (candidate.brand_mentioned !== null && typeof candidate.brand_mentioned !== 'boolean')) invalid()
    safe.verdict = candidate.has_answer && typeof candidate.brand_mentioned === 'boolean' ? 'success' : 'incomplete'
    safe.reasons = ['collection-time-unknown','pulse-provenance-incomplete']
   } else {
    const envelope = readScanEvidence(candidate.envelope)
    if (!envelope) invalid()
    safe.collectedAt = nullableTime(envelope.collectedAt)
    safe.verdict = envelope.checks[snapshot.checkKey].assessment
    safe.reasons = scanReasons(snapshot, envelope)
   }
  } catch {
   result.sourceState = 'unavailable'
   if (safe) { safe.collectedAt = null; safe.verdict = null; safe.reasons = ['source-malformed'] }
  }
  if (safe) result.candidates.push(safe)
 }
 return result
}
