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
export type OutcomeWindow = {
  day: 7 | 28 | 56; startsAt: string; endsAt: string;
  timeState: 'not-due' | 'awaiting-evidence' | 'missing-evidence' | 'observation-available';
  evidenceState: EvidenceState; provisional: boolean; selected: SafeEvidence | null; reasons: string[];
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
