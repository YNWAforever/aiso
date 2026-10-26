type State = 'regressed' | 'stable' | 'insufficient_evidence' | 'not_comparable'
type Result = { state: State; evidence: Record<string, unknown> }
const base = { method: 'fimmick-outcome-regression.v1', causation: false }
export function compareOutcomeCounts(input: { before: number; after: number; beforeSamples: number; afterSamples: number }, threshold: number, minimum: number): Result {
  const evidence = { ...base, ...input, threshold, minimum }
  if (![input.before, input.after, input.beforeSamples, input.afterSamples].every(Number.isFinite) || input.before <= 0 || input.beforeSamples < minimum || input.afterSamples < minimum) return { state: 'insufficient_evidence', evidence }
  const dropPercent = (input.before - input.after) / input.before * 100
  return { state: dropPercent >= threshold ? 'regressed' : 'stable', evidence: { ...evidence, dropPercent } }
}
type Score = { score: number; url: string; signature: string | null; complete: boolean }
export function compareOutcomeScores(before: Score | null, after: Score | null, threshold: number): Result {
  const evidence = { ...base, before, after, threshold }
  if (!before || !after) return { state: 'insufficient_evidence', evidence }
  if (!before.complete || !after.complete || !before.signature || before.signature !== after.signature || before.url !== after.url) return { state: 'not_comparable', evidence }
  return { state: before.score - after.score >= threshold ? 'regressed' : 'stable', evidence }
}
