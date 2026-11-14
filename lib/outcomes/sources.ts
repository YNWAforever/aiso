import 'server-only'
import { validIds, versionDTO } from '@/lib/change-sets/store'
import { deliveryEventDTO } from '@/lib/delivery/dto'
import { compareScanEvidence, readScanEvidence } from '@/lib/scan-evidence'
import type { DraftEvidence, ScanSuggestionEvidence } from '@/lib/opportunities/types'
import type { OutcomeInput, SafeEvidence } from './types'
import type { MultiSourceOutcomeInput, StoredOutcomeInput } from './multi-source'
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
type RetainedScan = { envelope: NonNullable<ReturnType<typeof readScanEvidence>>; comparison: ReturnType<typeof compareScanEvidence> }
type ScanCache = Map<unknown, RetainedScan | null>
function retainedScan(value: unknown, cache: ScanCache): RetainedScan | null {
 if (cache.has(value)) return cache.get(value) ?? null
 const envelope = readScanEvidence(value)
 const result = envelope ? { envelope, comparison: compareScanEvidence(envelope, envelope) } : null
 cache.set(value, result)
 return result
}
function scanReasons(baseline: ScanSuggestionEvidence, envelope: NonNullable<ReturnType<typeof readScanEvidence>>, comparison = compareScanEvidence(envelope, envelope)): string[] {
 // The frozen baseline contains one check, not a full envelope. Never reconstruct it.
 // Self-comparison delegates current schema-wide limitations to the existing contract.
 const reasons = [...envelope.limitations.filter(reason => (OUTCOME_REASON_CODES as readonly string[]).includes(reason))]
 if (comparison.reason) reasons.push(comparison.reason)
 if (baseline.comparisonSignature !== envelope.comparisonSignature) reasons.push('different-methods-or-scope')
 if (baseline.check.collection !== 'complete') reasons.push('incomplete-collection')
 return [...new Set(reasons)]
}

/** Validate primary state once, independently of observation availability or source count. */
function primary(value: unknown) {
 const row = record(value), rawVersion = record(row.version)
 if (row.member !== true || row.owned !== true) invalid()
 const version = versionDTO(rawVersion)
 // V2 primary calendars remain strict even when no delivery event references them.
 // Leave the historical V1 decoder behavior unchanged.
 if (version.schemaVersion === 2) {
  time(version.submittedAt)
  if (version.decision) {
   time(version.decision.decidedAt)
   id(record(rawVersion.decision_record).id)
  }
 }
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
 const common: Pick<OutcomeInput, 'clientId' | 'itemId' | 'versionId' | 'contentHash' | 'evaluatedAt' | 'anchorState' | 'anchor'> = {
  clientId, itemId: version.workItemId, versionId: version.id, contentHash: version.contentHash, evaluatedAt,
  anchorState: active.length ? 'active' : attestations.length ? 'withdrawn' : 'no-delivery',
  anchor: active[0] ? {id:active[0].eventId,deliveredAt:active[0].deliveredAt,recordedAt:active[0].recordedAt} : null,
 }
 return { row, version, common }
}

/** A frozen baseline is primary data: failures here must never become observation unavailability. */
function frozenBaseline(snapshot: DraftEvidence): SafeEvidence {
 return snapshot.kind === 'pulse-metric'
  ? { source: { kind: snapshot.kind, id: snapshot.id, checkKey: null }, recordedAt: nullableTime(snapshot.recordedAt), collectedAt: null,
      verdict: snapshot.result, reasons: ['collection-time-unknown','pulse-provenance-incomplete'] }
  : { source: { kind: snapshot.kind, id: snapshot.scanId, checkKey: snapshot.checkKey }, recordedAt: nullableTime(snapshot.recordedAt),
      collectedAt: nullableTime(snapshot.collectedAt), verdict: snapshot.check.assessment, reasons: [...new Set(['final-path-identity-withheld', ...snapshot.limitations.filter(reason => (OUTCOME_REASON_CODES as readonly string[]).includes(reason))])] }
}

function observations(snapshot: DraftEvidence, baseline: SafeEvidence, sources: unknown, scanCache?: ScanCache): Pick<OutcomeInput, 'candidates' | 'sourceState' | 'truncated'> {
 const result: Pick<OutcomeInput, 'candidates' | 'sourceState' | 'truncated'> = { candidates: [], sourceState: 'ok', truncated: false }
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
    const cached = scanCache ? retainedScan(candidate.envelope, scanCache) : null
    const envelope = scanCache ? cached?.envelope : readScanEvidence(candidate.envelope)
    if (!envelope) invalid()
    safe.collectedAt = nullableTime(envelope.collectedAt)
    safe.verdict = envelope.checks[snapshot.checkKey].assessment
    safe.reasons = scanReasons(snapshot, envelope, cached?.comparison)
   }
  } catch {
   result.sourceState = 'unavailable'
   if (safe) { safe.collectedAt = null; safe.verdict = null; safe.reasons = ['source-malformed'] }
  }
  if (safe) result.candidates.push(safe)
 }
 return result
}

function singleSource(input: ReturnType<typeof primary>): OutcomeInput {
 const { row, version, common } = input
 // This legacy entrypoint stays narrow; only the stored dispatcher admits V2.
 if (version.schemaVersion !== 1) invalid()
 const snapshot = version.evidenceSnapshot.evidence
 const baseline = frozenBaseline(snapshot)
 return { ...common, baseline, ...observations(snapshot, baseline, snapshot.kind === 'pulse-metric' ? row.pulse : row.scans) }
}

/** Partition the shared bounded union before sameOutcomeSubject can see any Pulse row. */
function pulsePartitions(snapshots: DraftEvidence[], sources: unknown) {
 const rows: unknown[][] = snapshots.map(() => [])
 let unavailable = !Array.isArray(sources)
 const truncated = Array.isArray(sources) && sources.length > OUTCOME_CANDIDATE_LIMIT
 if (Array.isArray(sources)) for (const raw of sources.slice(0, OUTCOME_CANDIDATE_LIMIT)) {
  try {
   const candidate = record(raw)
   if (typeof candidate.question !== 'string' || typeof candidate.platform !== 'string' ||
       (candidate.prompt_id !== null && typeof candidate.prompt_id !== 'string')) invalid()
   let matched = false
   snapshots.forEach((snapshot, index) => {
    if (snapshot.kind === 'pulse-metric' && candidate.question === snapshot.question && candidate.platform === snapshot.platform &&
        (snapshot.promptId === null || candidate.prompt_id === snapshot.promptId)) {
     rows[index].push(raw)
     matched = true
    }
   })
   // A SQL union row with no addressable frozen subject cannot justify empty success.
   if (!matched) unavailable = true
  } catch { unavailable = true }
 }
 return { rows, unavailable, truncated }
}

function multiSource(input: ReturnType<typeof primary>): MultiSourceOutcomeInput {
 const { row, version, common } = input
 if (version.schemaVersion !== 2) invalid()
 const snapshots = version.evidenceSnapshots.map(snapshot => snapshot.evidence)
 // The whole package (including baseline calendars) must validate before local candidate catches.
 const baselines = snapshots.map(frozenBaseline)
 const pulse = pulsePartitions(snapshots, row.pulse)
 // V2-only, read-local: reuse envelope validation, never a source-specific verdict/reason.
 const scanCache: ScanCache = new Map()
 return {
  ...common, schemaVersion: 2,
  sources: snapshots.map((snapshot, sourceIndex) => {
   const baseline = baselines[sourceIndex]
   const projected = observations(snapshot, baseline, snapshot.kind === 'pulse-metric' ? pulse.rows[sourceIndex] : row.scans, scanCache)
   if (snapshot.kind === 'pulse-metric') {
    projected.truncated = pulse.truncated
    if (pulse.unavailable) projected.sourceState = 'unavailable'
   }
   return { sourceIndex, baseline, ...projected }
  }),
 }
}

/** Legacy private SQL envelope -> V1 policy input. Never silently projects V2 to V1. */
export function projectOutcomeSnapshot(value: unknown): OutcomeInput {
 return singleSource(primary(value))
}

export function projectMultiSourceOutcomeSnapshot(value: unknown): MultiSourceOutcomeInput {
 return multiSource(primary(value))
}

/** One validated primary snapshot, then an explicit frozen-schema dispatch. */
export function projectStoredOutcomeSnapshot(value: unknown): StoredOutcomeInput {
 const input = primary(value)
 return input.version.schemaVersion === 1 ? singleSource(input) : multiSource(input)
}
