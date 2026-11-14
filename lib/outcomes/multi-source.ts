import type { OutcomeInput, OutcomeResponse, SourceRef } from './types'
import { OUTCOME_CANDIDATE_LIMIT, OUTCOME_DIAGNOSTIC_LIMIT, OUTCOME_REASON_CODES } from './types'
import { evaluateOutcomes } from './evaluate'
import { parseOutcomeResponse } from './dto'

type CommonOutcome = Pick<OutcomeInput, 'clientId' | 'itemId' | 'versionId' | 'contentHash' | 'evaluatedAt' | 'anchorState' | 'anchor'>
export type MultiSourceOutcomeSourceInput = Pick<OutcomeInput, 'baseline' | 'candidates' | 'sourceState' | 'truncated'> & { sourceIndex: number }
export type MultiSourceOutcomeInput = CommonOutcome & { schemaVersion: 2; sources: MultiSourceOutcomeSourceInput[] }
export type StoredOutcomeInput = OutcomeInput | MultiSourceOutcomeInput
export type MultiSourceOutcomeSourceResult = Pick<OutcomeResponse, 'baseline' | 'windows' | 'diagnostics' | 'truncated' | 'reasons'> & { sourceIndex: number }
export type MultiSourceOutcomeResponse = CommonOutcome & {
  schemaVersion: 2
  policyVersion: 'stored-outcomes.v2'
  sources: MultiSourceOutcomeSourceResult[]
}
export type MultiSourceOutcomeContext = Pick<OutcomeInput, 'clientId' | 'itemId' | 'versionId' | 'contentHash'> & {
  sourceRefs: readonly (SourceRef | null)[]
}
export const MULTI_SOURCE_OUTCOME_POLICY = 'stored-outcomes.v2' as const
export const OUTCOME_DIAGNOSTIC_LIMIT_REASON = 'diagnostic-limit-exceeded' as const

/** The expected source order comes from the validated frozen input, never the reply. */
export function multiSourceOutcomeContext(input: MultiSourceOutcomeInput): MultiSourceOutcomeContext {
  return {
    clientId: input.clientId, itemId: input.itemId, versionId: input.versionId, contentHash: input.contentHash,
    sourceRefs: input.sources.map(source => source.baseline ? { ...source.baseline.source } : null),
  }
}
function common(input: CommonOutcome): CommonOutcome {
  return { clientId: input.clientId, itemId: input.itemId, versionId: input.versionId, contentHash: input.contentHash,
    evaluatedAt: input.evaluatedAt, anchorState: input.anchorState, anchor: input.anchor }
}
function unique(values: string[]): string[] { return [...new Set(values)] }
function wireReasons(values: string[], candidatesLimited: boolean, diagnosticsLimited: boolean): string[] {
  return unique(values.flatMap(reason => reason === 'candidate-limit-exceeded'
    ? [...(candidatesLimited ? [reason] : []), ...(diagnosticsLimited ? [OUTCOME_DIAGNOSTIC_LIMIT_REASON] : [])]
    : [reason]))
}
function sourceResult(value: OutcomeResponse, sourceIndex: number, candidatesLimited: boolean, diagnosticsLimited: boolean): MultiSourceOutcomeSourceResult {
  return { sourceIndex, baseline: value.baseline, windows: value.windows.map(window => ({ ...window,
    reasons: wireReasons(window.reasons, candidatesLimited, diagnosticsLimited) })),
  diagnostics: value.diagnostics, truncated: value.truncated,
  reasons: wireReasons(value.reasons, candidatesLimited, diagnosticsLimited) }
}

function diagnosticAllocation(lengths: readonly number[]): number[] {
  const retained = lengths.map(() => 0)
  let budget = OUTCOME_DIAGNOSTIC_LIMIT
  // Round-robin positions keep late frozen sources visible; duplicate entries consume their own occurrences.
  for (let position = 0; budget > 0; position++) {
    let found = false
    for (let index = 0; index < lengths.length && budget > 0; index++) {
      if (position >= lengths[index]) continue
      retained[index]++; budget--; found = true
    }
    if (!found) break
  }
  return retained
}

/** Per-source V1 policy, with one serialized diagnostic budget for the complete frozen package. */
export function evaluateMultiSourceOutcomes(input: MultiSourceOutcomeInput): MultiSourceOutcomeResponse {
  if (input.schemaVersion !== 2 || !input.sources.length || input.sources.some((source, index) => source.sourceIndex !== index)) reject()
  const ids = { 'scan-check': new Set<string>(), 'pulse-metric': new Set<string>() }
  const limitedKinds = new Set<SourceRef['kind']>()
  for (const source of input.sources) {
    if (source.truncated && source.baseline) limitedKinds.add(source.baseline.source.kind)
    for (const candidate of source.candidates) ids[candidate.source.kind].add(candidate.source.id)
  }
  for (const kind of ['scan-check', 'pulse-metric'] as const) if (ids[kind].size > OUTCOME_CANDIDATE_LIMIT) limitedKinds.add(kind)
  const evaluated = input.sources.map(source => evaluateOutcomes({ ...common(input), ...source,
    truncated: source.truncated || (source.baseline !== null && limitedKinds.has(source.baseline.source.kind)) }))
  const retained = diagnosticAllocation(evaluated.map(value => value.diagnostics.length))
  const sources = evaluated.map((value, index) => {
    const diagnosticsLimited = retained[index] < value.diagnostics.length
    if (!diagnosticsLimited) return sourceResult(value, index, value.truncated, false)
    const original = input.sources[index]
    const limited = evaluateOutcomes({ ...common(input), baseline: original.baseline,
      candidates: value.diagnostics.slice(0, retained[index]), sourceState: original.sourceState, truncated: true })
    return sourceResult(limited, index, value.truncated, true)
  })
  return { ...common(input), schemaVersion: 2, policyVersion: MULTI_SOURCE_OUTCOME_POLICY, sources }
}

function reject(): never { throw new TypeError('Invalid multi-source outcome response') }
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return reject()
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== keys.length || keys.some(key => !Object.hasOwn(record, key))) return reject()
  return record
}
function reasonList(value: unknown): string[] {
  const allowed: readonly string[] = [...OUTCOME_REASON_CODES, OUTCOME_DIAGNOSTIC_LIMIT_REASON]
  if (!Array.isArray(value) || value.length > allowed.length || value.some(reason => typeof reason !== 'string' || !allowed.includes(reason))) return reject()
  const reasons = value as string[]
  if (new Set(reasons).size !== reasons.length) return reject()
  return reasons
}
function legacyReasons(value: unknown): string[] {
  return unique(reasonList(value).map(reason => reason === OUTCOME_DIAGNOSTIC_LIMIT_REASON ? 'candidate-limit-exceeded' : reason))
}
function legacyBaseline(value: unknown): { value: unknown; id: string | null } {
  if (value === null) return { value: null, id: null }
  const baseline = object(value, ['source', 'recordedAt', 'collectedAt', 'verdict', 'reasons'])
  const source = object(baseline.source, ['kind', 'id', 'checkKey'])
  const id = source.id
  if (typeof id !== 'string' || !id.length || Array.from(id).length > 36 || id !== id.normalize('NFC').trim()) return reject()
  // Frozen historical IDs are opaque. The V1 policy never uses the baseline ID;
  // its stricter wire grammar is applied to a validation-only placeholder instead.
  return { id, value: { ...baseline, source: { ...source, id: 'baseline' } } }
}
function matchesRef(actual: SourceRef | null, expected: SourceRef | null): boolean {
  return actual === null || expected === null ? actual === expected
    : actual.kind === expected.kind && actual.id === expected.id && actual.checkKey === expected.checkKey
}

/** Closed V2 vocabulary and V1 policy consistency, bound to independently trusted frozen ordinals. */
export function parseMultiSourceOutcomeResponse(value: unknown, expected: MultiSourceOutcomeContext): MultiSourceOutcomeResponse {
  const data = object(value, ['schemaVersion', 'policyVersion', 'clientId', 'itemId', 'versionId', 'contentHash', 'evaluatedAt', 'anchorState', 'anchor', 'sources'])
  if (data.schemaVersion !== 2 || data.policyVersion !== MULTI_SOURCE_OUTCOME_POLICY || !expected || !Array.isArray(expected.sourceRefs)
    || !Array.isArray(data.sources) || !data.sources.length || data.sources.length !== expected.sourceRefs.length) return reject()
  for (const key of ['clientId', 'itemId', 'versionId', 'contentHash'] as const) if (data[key] !== expected[key]) return reject()
  const sources: MultiSourceOutcomeSourceResult[] = []
  const kinds = new Map<SourceRef['kind'], boolean>()
  const observedIds = { 'scan-check': new Set<string>(), 'pulse-metric': new Set<string>() }
  let validatedCommon: CommonOutcome | null = null
  let diagnostics = 0, diagnosticsLimited = false
  for (let index = 0; index < data.sources.length; index++) {
    const row = object(data.sources[index], ['sourceIndex', 'baseline', 'windows', 'diagnostics', 'truncated', 'reasons'])
    if (row.sourceIndex !== index || !Array.isArray(row.windows) || row.windows.length > 3) return reject()
    const reasons = reasonList(row.reasons)
    const candidateLimit = reasons.includes('candidate-limit-exceeded'), diagnosticLimit = reasons.includes(OUTCOME_DIAGNOSTIC_LIMIT_REASON)
    if (row.truncated !== (candidateLimit || diagnosticLimit)) return reject()
    const baseline = legacyBaseline(row.baseline)
    const parsed = parseOutcomeResponse({ schemaVersion: 1, policyVersion: 'stored-outcomes.v1',
      clientId: data.clientId, itemId: data.itemId, versionId: data.versionId, contentHash: data.contentHash,
      evaluatedAt: data.evaluatedAt, anchorState: data.anchorState, anchor: data.anchor,
      baseline: baseline.value, windows: row.windows.map(value => {
        const window = object(value, ['day', 'startsAt', 'endsAt', 'timeState', 'evidenceState', 'provisional', 'selected', 'reasons', 'comparison'])
        return { ...window, reasons: legacyReasons(window.reasons) }
      }), diagnostics: row.diagnostics, truncated: row.truncated, reasons: legacyReasons(reasons) })
    if (parsed.baseline && baseline.id !== null) parsed.baseline = { ...parsed.baseline, source: { ...parsed.baseline.source, id: baseline.id } }
    const reference = expected.sourceRefs[index]
    if (reference === undefined || !matchesRef(parsed.baseline?.source ?? null, reference)) return reject()
    if (parsed.baseline) {
      const kind = parsed.baseline.source.kind
      if (kinds.has(kind) && kinds.get(kind) !== candidateLimit) return reject()
      kinds.set(kind, candidateLimit)
    }
    const result = sourceResult(parsed, index, candidateLimit, diagnosticLimit)
    // Mapping both limitations to V1 must not allow a fabricated V2-only window reason.
    if (JSON.stringify(result.reasons.slice().sort()) !== JSON.stringify(reasons.slice().sort())) return reject()
    for (let position = 0; position < result.windows.length; position++) {
      const actual = reasonList((row.windows[position] as Record<string, unknown>).reasons)
      if (JSON.stringify(result.windows[position].reasons.slice().sort()) !== JSON.stringify(actual.slice().sort())) return reject()
    }
    for (const observation of [...result.diagnostics, ...result.windows.flatMap(window => window.selected ? [window.selected] : [])]) {
      observedIds[observation.source.kind].add(observation.source.id)
    }
    sources.push(result); diagnostics += result.diagnostics.length; diagnosticsLimited ||= diagnosticLimit
    validatedCommon = common(parsed)
  }
  if (diagnostics > OUTCOME_DIAGNOSTIC_LIMIT || (diagnosticsLimited && diagnostics !== OUTCOME_DIAGNOSTIC_LIMIT) || !validatedCommon) return reject()
  for (const kind of ['scan-check', 'pulse-metric'] as const) {
    if (observedIds[kind].size > OUTCOME_CANDIDATE_LIMIT && kinds.get(kind) !== true) return reject()
  }
  // A limited entry had at least one omitted diagnostic. These minimum original lengths
  // must reproduce the retained counts under the same deterministic allocation.
  const minimumLengths = sources.map(source => source.diagnostics.length + Number(source.reasons.includes(OUTCOME_DIAGNOSTIC_LIMIT_REASON)))
  if (minimumLengths.some(length => length > OUTCOME_DIAGNOSTIC_LIMIT)
    || diagnosticAllocation(minimumLengths).some((count, index) => count !== sources[index].diagnostics.length)) return reject()
  return { ...validatedCommon, schemaVersion: 2, policyVersion: MULTI_SOURCE_OUTCOME_POLICY, sources }
}
