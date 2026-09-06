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

export type ReviewContent = {
  schemaVersion: 1
  workItemId: string
  draftRevision: number
  title: string
  action: string
  notes: string
  locale: 'en' | 'zh-HK'
  evidenceSnapshot: WorkItem['evidenceSnapshot']
}

export type ValidationResult = {
  policyVersion: 'change-set-review.v1'
  checks: Array<{
    code: 'text' | 'locale' | 'evidence' | 'content_size'
    status: 'pass'
  }>
}

export type FrozenReview = {
  content: ReviewContent
  contentHash: string
  validation: ValidationResult
}

export type DecisionDTO = {
  decision: ReviewDecisionInput['decision']
  reason: string
  decidedBy: ActorSnapshot
  decidedAt: string
}

export type VersionSummary = {
  schemaVersion: 1
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
