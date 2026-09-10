import type { Anchor, OutcomeComparison, OutcomeResponse, OutcomeWindow, SafeEvidence, SourceRef } from './types'
import { OUTCOME_DIAGNOSTIC_LIMIT, OUTCOME_REASON_CODES } from './types'
import { evaluateOutcomes } from './evaluate'
import { utcMicros } from './time'

function reject(): never { throw new TypeError('Invalid outcome response') }
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return reject()
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== keys.length || keys.some(key => !Object.hasOwn(record, key))) return reject()
  return record
}
function text(value: unknown, max = 128): string {
  if (typeof value !== 'string' || !value.length || value.length > max || !/^[a-zA-Z0-9_-]+$/.test(value)) return reject()
  return value
}
function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) return reject()
  return value as T
}
function bool(value: unknown): boolean { return typeof value === 'boolean' ? value : reject() }
function timestamp(value: unknown): string {
  if (typeof value !== 'string') return reject()
  utcMicros(value)
  return value
}
function nullableTime(value: unknown): string | null { return value === null ? null : timestamp(value) }
function list<T>(value: unknown, max: number, parse: (v: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > max) return reject()
  return value.map(parse)
}
function reasons(value: unknown): string[] {
  const result = list(value, OUTCOME_REASON_CODES.length, v => choice(v, OUTCOME_REASON_CODES))
  if (new Set(result).size !== result.length) return reject()
  return result
}
const checkKeys = ['c1_robots','c2_llms_txt','c3_bot_access','c4_structured_data','c5_extractability','c6_llms_full_txt','c7_mcp_card','c8_sitemap','c9_meta_desc','c10_headings','c11_faq','c12_canonical','c13_render','c14_internal_links','c15_entity','c16_freshness','c17_citation_density','c18_factual_density','c19_topical_authority','c20_chunkability'] as const
function evidence(value: unknown): SafeEvidence {
  const data = object(value, ['source','recordedAt','collectedAt','verdict','reasons'])
  const ref = object(data.source, ['kind','id','checkKey'])
  const kind = choice(ref.kind, ['pulse-metric','scan-check'] as const)
  const source: SourceRef = { kind, id: text(ref.id), checkKey: kind === 'scan-check' ? choice(ref.checkKey, checkKeys) : ref.checkKey === null ? null : reject() }
  const collectedAt = nullableTime(data.collectedAt)
  // Existing Pulse has no trustworthy collection-time contract.
  if (kind === 'pulse-metric' && collectedAt !== null) return reject()
  return { source, recordedAt: nullableTime(data.recordedAt), collectedAt, verdict: data.verdict === null ? null : choice(data.verdict, VERDICTS), reasons: reasons(data.reasons) }
}
const VERDICTS = ['pass','warn','fail','not-applicable','not-verifiable','success','incomplete'] as const

/** Browser-facing, so the vocabulary is closed on the way in as well as out. */
function comparison(value: unknown): OutcomeComparison {
  const data = object(value, ['status','outcome','baselineVerdict','observedVerdict'])
  return {
    status: choice(data.status, ['comparable','partially_comparable','not_comparable','insufficient_evidence'] as const),
    outcome: choice(data.outcome, ['improved','unchanged','regressed','not_yet_observed','cannot_determine'] as const),
    baselineVerdict: data.baselineVerdict === null ? null : choice(data.baselineVerdict, VERDICTS),
    observedVerdict: data.observedVerdict === null ? null : choice(data.observedVerdict, VERDICTS),
  }
}
function anchor(value: unknown): Anchor | null {
  if (value === null) return null
  const data = object(value, ['id','deliveredAt','recordedAt'])
  return { id: text(data.id), deliveredAt: timestamp(data.deliveredAt), recordedAt: timestamp(data.recordedAt) }
}
function window(value: unknown): OutcomeWindow {
  const data = object(value, ['day','startsAt','endsAt','timeState','evidenceState','provisional','selected','reasons','comparison'])
  if (data.day !== 7 && data.day !== 28 && data.day !== 56) return reject()
  return { day: data.day, startsAt: timestamp(data.startsAt), endsAt: timestamp(data.endsAt),
    timeState: choice(data.timeState, ['not-due','awaiting-evidence','missing-evidence','observation-available'] as const),
    evidenceState: choice(data.evidenceState, ['available','timing-unknown','invalid-baseline','not-comparable','evidence-limited','unavailable'] as const),
    provisional: bool(data.provisional), selected: data.selected === null ? null : evidence(data.selected), reasons: reasons(data.reasons),
    comparison: comparison(data.comparison) }
}
function sameReasons(a: string[], b: string[]): boolean { return a.length === b.length && a.every(reason => b.includes(reason)) }

/** Browser safe; shape validation precedes policy consistency checks. Never infers an adapter. */
export function parseOutcomeResponse(value: unknown): OutcomeResponse {
  const data = object(value, ['schemaVersion','policyVersion','clientId','itemId','versionId','contentHash','evaluatedAt','anchorState','anchor','baseline','windows','diagnostics','truncated','reasons'])
  if (data.schemaVersion !== 1 || data.policyVersion !== 'stored-outcomes.v1') return reject()
  const contentHash = text(data.contentHash, 64)
  if (!/^[a-f0-9]{64}$/.test(contentHash)) return reject()
  const result: OutcomeResponse = {
    schemaVersion: 1, policyVersion: 'stored-outcomes.v1', clientId: text(data.clientId), itemId: text(data.itemId),
    versionId: text(data.versionId), contentHash, evaluatedAt: timestamp(data.evaluatedAt),
    anchorState: choice(data.anchorState, ['active','withdrawn','no-delivery'] as const), anchor: anchor(data.anchor),
    baseline: data.baseline === null ? null : evidence(data.baseline), windows: list(data.windows, 3, window),
    diagnostics: list(data.diagnostics, OUTCOME_DIAGNOSTIC_LIMIT, evidence), truncated: bool(data.truncated), reasons: reasons(data.reasons),
  }
  if ((result.anchorState === 'active') !== (result.anchor !== null)) return reject()
  if (result.anchor && (utcMicros(result.anchor.deliveredAt) > utcMicros(result.evaluatedAt) || utcMicros(result.anchor.recordedAt) > utcMicros(result.evaluatedAt))) return reject()
  const expected = evaluateOutcomes({
    ...result, candidates: [...result.diagnostics, ...result.windows.flatMap(w => w.selected ? [w.selected] : [])],
    sourceState: result.reasons.includes('source-unavailable') ? 'unavailable' : 'ok',
  })
  const diagnosticIds = result.diagnostics.map(row => JSON.stringify(row.source))
  if (new Set(diagnosticIds).size !== diagnosticIds.length || JSON.stringify(result.diagnostics) !== JSON.stringify(expected.diagnostics)) return reject()
  if (result.windows.length !== expected.windows.length || !sameReasons(result.reasons, expected.reasons)) return reject()
  for (let i = 0; i < result.windows.length; i++) {
    const actual = result.windows[i], correct = expected.windows[i]
    if (actual.day !== correct.day || utcMicros(actual.startsAt) !== utcMicros(correct.startsAt) || utcMicros(actual.endsAt) !== utcMicros(correct.endsAt) ||
      actual.timeState !== correct.timeState || actual.evidenceState !== correct.evidenceState || actual.provisional !== correct.provisional ||
      JSON.stringify(actual.selected) !== JSON.stringify(correct.selected) || !sameReasons(actual.reasons, correct.reasons) ||
      JSON.stringify(actual.comparison) !== JSON.stringify(correct.comparison)) return reject()
  }
  return result
}
