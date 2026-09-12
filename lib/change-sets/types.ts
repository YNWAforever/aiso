import type { WorkItem } from '@/lib/work-items/schema'

export type ActorSnapshot = {
  profileId: string
  displayName: string | null
  role: 'account_member' | 'account_approver' | 'platform_admin'
}

export type ReviewDecisionInput = {
  decision: 'approved' | 'changes_requested'
  reason: string
  requestId: string
}

export type ApproverAccessInput = {
  profileId: string
  action: 'grant' | 'revoke'
  reason: string
  expectedRevision: number
  requestId: string
}

type ReviewContentBase = {
  workItemId: string
  draftRevision: number
  title: string
  action: string
  notes: string
  locale: 'en' | 'zh-HK'
}

/** A version submitted before multi-source items existed (051). Never written by new code; still read. */
export type ReviewContentV1 = ReviewContentBase & {
  schemaVersion: 1
  evidenceSnapshot: WorkItem['evidenceSnapshot']
}

/**
 * A version submitted with WORK_ITEM_MULTI_SOURCE_V1 on. One entry per LIVE
 * source at freeze time, ordered by opportunity_key -- the same order
 * lib/work-items/sources.ts's listLiveSources and the submit statement's
 * SQL aggregate both use, so the hash is stable across requests.
 */
export type ReviewContentV2 = ReviewContentBase & {
  schemaVersion: 2
  evidenceSnapshots: WorkItem['evidenceSnapshot'][]
}

/**
 * A discriminated union, not a single evolving shape. lib/delivery/export.ts
 * (out of scope for this work, never touched) already refuses anything but
 * schemaVersion 1 with its own `if (version.schemaVersion !== 1) invalid()`
 * guard -- TypeScript's control-flow narrowing on that exact check is what
 * keeps that file type-checking against this union with zero edits to it.
 */
export type ReviewContent = ReviewContentV1 | ReviewContentV2

export type ValidationResult = {
  policyVersion: 'change-set-review.v1'
  checks: Array<{
    code: 'text' | 'locale' | 'evidence' | 'content_size'
    status: 'pass'
  }>
}

export type FrozenReviewV1 = { content: ReviewContentV1; contentHash: string; validation: ValidationResult }
export type FrozenReviewV2 = { content: ReviewContentV2; contentHash: string; validation: ValidationResult }

/**
 * A union, matching ReviewContent, but freezeReview and freezeMultiSourceReview
 * each return their OWN narrow variant (FrozenReviewV1 / FrozenReviewV2), not
 * this union -- so the ~10 existing callers of freezeReview (lib/delivery/export.ts,
 * every change-set/delivery/outcomes fixture) keep accessing `.content.evidenceSnapshot`
 * without any narrowing of their own. Only code that can genuinely receive
 * either variant (submitVersion's flag-gated result, versionDTO's schemaVersion
 * branch) needs this wider type.
 */
export type FrozenReview = FrozenReviewV1 | FrozenReviewV2

export type DecisionDTO = {
  decision: ReviewDecisionInput['decision']
  reason: string
  decidedBy: ActorSnapshot
  decidedAt: string
}

export type VersionSummary = {
  /** Mirrors the decoded content's own discriminant -- 2 only once a v2 row exists. */
  schemaVersion: 1 | 2
  id: string
  versionNumber: number
  workItemId: string
  draftRevision: number
  contentHash: string
  submittedBy: ActorSnapshot
  submittedAt: string
  decision: DecisionDTO | null
  capabilities: { canDecide: boolean }
}

export type VersionDetail = VersionSummary & ReviewContent & {
  validation: ValidationResult
}

export type StoreResult<T> =
  | { kind: 'created' | 'replayed'; value: T }
  | { kind: 'not_found' | 'denied' | 'conflict' | 'validation_failed' }
