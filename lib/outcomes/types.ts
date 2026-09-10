export type OutcomeScope = { accountId: string; actorId: string; clientId: string; itemId: string; versionId: string }
export type EvidenceState = 'available' | 'timing-unknown' | 'invalid-baseline' | 'not-comparable' | 'evidence-limited' | 'unavailable'
export type SourceRef = { kind: 'pulse-metric' | 'scan-check'; id: string; checkKey: string | null }
export type SafeEvidence = { source: SourceRef; recordedAt: string | null; collectedAt: string | null; verdict: string | null; reasons: string[] }
export type Anchor = { id: string; deliveredAt: string; recordedAt: string }
export type OutcomeInput = {
  clientId: string; itemId: string; versionId: string; contentHash: string; evaluatedAt: string;
  anchorState: 'no-delivery' | 'withdrawn' | 'active'; anchor: Anchor | null;
  baseline: SafeEvidence | null; candidates: SafeEvidence[]; sourceState: 'ok' | 'unavailable'; truncated: boolean;
}
/**
 * Underscored, matching `compareScanChecks` in lib/scan-evidence.ts rather than
 * the hyphenated EvidenceState above. The two layers describe the same judgement
 * at different depths — one over a whole envelope, one over a stored window — and
 * giving them one spelling removes a translation table that would otherwise have
 * to be kept correct forever.
 */
export type ComparisonStatus = 'comparable' | 'partially_comparable' | 'not_comparable' | 'insufficient_evidence'
export type ComparisonOutcome = 'improved' | 'unchanged' | 'regressed' | 'not_yet_observed' | 'cannot_determine'

/**
 * What actually changed, and how far it can be trusted. `status` is about the
 * comparison's admissibility — method, target, configuration — and `outcome` is
 * about the verdicts. They are separate because a real movement observed under
 * conditions we cannot fully prove is still worth showing, as long as the caller
 * says which it is.
 */
export type OutcomeComparison = {
  status: ComparisonStatus
  outcome: ComparisonOutcome
  baselineVerdict: string | null
  observedVerdict: string | null
}

export type OutcomeWindow = {
  day: 7 | 28 | 56; startsAt: string; endsAt: string;
  timeState: 'not-due' | 'awaiting-evidence' | 'missing-evidence' | 'observation-available';
  evidenceState: EvidenceState; provisional: boolean; selected: SafeEvidence | null; reasons: string[];
  comparison: OutcomeComparison;
}
export type OutcomeResponse = {
  schemaVersion: 1; policyVersion: 'stored-outcomes.v1'; clientId: string; itemId: string;
  versionId: string; contentHash: string; evaluatedAt: string; anchorState: OutcomeInput['anchorState'];
  anchor: Anchor | null; baseline: SafeEvidence | null; windows: OutcomeWindow[];
  diagnostics: SafeEvidence[]; truncated: boolean; reasons: string[];
}
/** Finite browser-safe vocabulary; every entry needs explicit localized copy. */
export const OUTCOME_REASON_CODES = [
  'point-in-time-read', 'self-reported-delivery', 'no-delivery', 'anchor-withdrawn',
  'baseline-missing', 'baseline-after-delivery', 'collection-time-unknown',
  'source-unavailable', 'candidate-limit-exceeded', 'different-source-subject',
  'no-comparable-adapter', 'final-path-identity-withheld', 'pulse-provenance-incomplete',
  'unknown-evidence', 'different-methods-or-scope', 'incomplete-collection',
  'origin-only-identity', 'no-page-or-provider-excerpts', 'sampled-single-page',
  'scan-record-retention', 'source-malformed', 'unsupported-source',
] as const
export type OutcomeReason = typeof OUTCOME_REASON_CODES[number]
export const OUTCOME_CANDIDATE_LIMIT = 200
export const OUTCOME_DIAGNOSTIC_LIMIT = 400
