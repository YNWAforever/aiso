import { CORE_PTS, EXT_PTS, GEO_PTS } from '@/lib/scoring'
import type { CollectionState, EvidenceCheckKey } from '@/lib/scan-evidence'
import { projectFactualDensityChecks } from '@/lib/factual-density-evidence'

const vocabulary = { ...CORE_PTS, ...EXT_PTS, ...GEO_PTS }
export type RankedCheck = { checkKey: EvidenceCheckKey; assessment: 'fail' | 'warn' }
export type CheckPriorityState = 'ready' | 'all-clear' | 'insufficient-evidence' | 'not-applicable'
type RecordInput = Record<string, unknown>
const collectionStates = ['complete', 'partial', 'blocked', 'failed', 'unsupported', 'unknown']

/** Client-safe pure resolver. Severity is a rule; scoring weights are not priorities. */
export function resolveCheckPriorities(checks: RecordInput) {
  const ranked: RankedCheck[] = []
  const needsEvidence: { checkKey: EvidenceCheckKey; collection: CollectionState }[] = []
  const counts = { pass: 0, warn: 0, fail: 0, unknown: 0, notApplicable: 0, total: 0 }
  for (const [key, raw] of Object.entries(projectFactualDensityChecks(checks))) {
    if (!Object.hasOwn(vocabulary, key)) continue
    counts.total++
    const check = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as RecordInput : {}
    const collection = collectionStates.includes(String(check.collection)) ? check.collection as CollectionState : 'unknown'
    if (check.applicability === 'not-applicable' && check.assessment === 'not-applicable') { counts.notApplicable++; continue }
    if (collection !== 'complete' || check.applicability !== 'applicable' || !['pass', 'warn', 'fail'].includes(String(check.assessment))) {
      counts.unknown++; needsEvidence.push({ checkKey: key as EvidenceCheckKey, collection }); continue
    }
    const assessment = check.assessment as 'pass' | 'warn' | 'fail'
    counts[assessment]++
    if (assessment !== 'pass') ranked.push({ checkKey: key as EvidenceCheckKey, assessment })
  }
  ranked.sort((a, b) => (a.assessment === 'fail' ? 0 : 1) - (b.assessment === 'fail' ? 0 : 1) || a.checkKey.localeCompare(b.checkKey))
  needsEvidence.sort((a, b) => a.checkKey.localeCompare(b.checkKey))
  const state: CheckPriorityState = ranked.length ? 'ready' : counts.unknown || !counts.total ? 'insufficient-evidence'
    : counts.notApplicable === counts.total ? 'not-applicable' : 'all-clear'
  return { state, ranked, needsEvidence, counts }
}
export const rankActionableChecks = (checks: RecordInput): RankedCheck[] => resolveCheckPriorities(checks).ranked
