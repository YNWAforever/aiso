import 'server-only'

import { appOrigin } from '@/lib/app-origin'
import { consumeFromNeon, defaultRateLimitRuntime, deriveRateLimitKey, resolveRateLimitSecret } from '@/lib/security/durable-rate-limit'
import { resolveCommercialEntitlement, type CommercialAccount } from '@/lib/tier'
import { buildReviewUrl, reviewTokenHash, verifyReviewToken } from './review-token'
import {
  loadMonthlyReviewTarget, readMonthlyReviews, recordMonthlyReviewDecision,
  type MonthlyReview,
} from './store'

/**
 * Phase 3 (advisory) service. A client's decision is recorded per report version
 * and shown to the agency; by product decision (2026-11-09) it does NOT gate
 * publishing. The submission path is public but token-authenticated: the signed
 * review link is the only credential, and it is bound to the report's current
 * version.
 */

export const REVIEW_DECISIONS = ['approved', 'changes_requested'] as const
export type ReviewDecision = typeof REVIEW_DECISIONS[number]

const SLUG_PATTERN = /^[A-Za-z0-9_-]{32}$/
const TOKEN_MAX = 160
const NAME_MAX = 120
const COMMENT_MAX = 2000

/** Review submissions per token per hour. A decision is final, so this is abuse control, not UX. */
const REVIEW_LIMIT = 10
const REVIEW_WINDOW_SECONDS = 3600

export type ReviewSubmitResult =
  | { state: 'recorded'; decision: ReviewDecision; decidedAt: string }
  | { state: 'invalid' }
  | { state: 'not_found' }
  | { state: 'already'; decision: ReviewDecision }
  | { state: 'rate_limited'; retryAt: number }

type ParsedSubmission = { slug: string; review: string; decision: ReviewDecision; reviewerName: string | null; comment: string | null }

function parseSubmission(body: unknown): ParsedSubmission | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const input = body as Record<string, unknown>
  const { slug, review, decision } = input
  if (typeof slug !== 'string' || !SLUG_PATTERN.test(slug)) return null
  if (typeof review !== 'string' || review.length === 0 || review.length > TOKEN_MAX) return null
  if (typeof decision !== 'string' || !(REVIEW_DECISIONS as readonly string[]).includes(decision)) return null

  const rawName = input.reviewerName
  if (rawName !== undefined && rawName !== null && typeof rawName !== 'string') return null
  const reviewerName = typeof rawName === 'string' ? rawName.trim() : null
  if (reviewerName !== null && (reviewerName.length < 1 || reviewerName.length > NAME_MAX)) return null

  const rawComment = input.comment
  if (rawComment !== undefined && rawComment !== null && typeof rawComment !== 'string') return null
  const comment = typeof rawComment === 'string' ? rawComment.trim() : null
  if (comment !== null && (comment.length < 1 || comment.length > COMMENT_MAX)) return null
  // A rejection with no reason is the least actionable event in the flow.
  if (decision === 'changes_requested' && !comment) return null

  return { slug, review, decision: decision as ReviewDecision, reviewerName, comment }
}

/** Consumes the token's hourly allowance. The key-domain string is permanent (HMAC input). */
function consumeReviewAllowance(tokenHash: string) {
  const key = deriveRateLimitKey('aiso:monthly-review:v1', `token:${tokenHash}`, resolveRateLimitSecret(defaultRateLimitRuntime()))
  return consumeFromNeon(key, REVIEW_WINDOW_SECONDS, REVIEW_LIMIT)
}

export async function submitMonthlyReview(body: unknown, now: Date = new Date()): Promise<ReviewSubmitResult> {
  const submission = parseSubmission(body)
  if (!submission) return { state: 'invalid' }

  const tokenHash = reviewTokenHash(submission.review)
  const limit = await consumeReviewAllowance(tokenHash)
  if (!limit.allowed) return { state: 'rate_limited', retryAt: limit.resetAt }

  const target = await loadMonthlyReviewTarget(submission.slug)
  if (!target) return { state: 'not_found' }
  if (!verifyReviewToken({ reportId: target.reportId, versionId: target.versionId, token: submission.review, now })) return { state: 'not_found' }
  if (!resolveCommercialEntitlement(target.account as CommercialAccount).features.client_reports_online) return { state: 'not_found' }

  const recorded = await recordMonthlyReviewDecision({
    slug: submission.slug,
    versionId: target.versionId,
    decision: submission.decision,
    reviewerName: submission.reviewerName,
    comment: submission.comment,
    tokenHash,
  })
  if (recorded.state === 'recorded') return { state: 'recorded', decision: submission.decision, decidedAt: recorded.decidedAt }
  if (recorded.state === 'already') return { state: 'already', decision: submission.decision }
  return { state: 'not_found' }
}

/** The review link an operator copies: bound to the report's current version. */
export function monthlyReviewLink(input: {
  locale: 'en' | 'zh-HK'; publicSlug: string; reportId: string; versionId: string
}): string {
  return buildReviewUrl(appOrigin(), input)
}

export type ReviewState = Readonly<{
  /** Decision on the version an operator would publish now. */
  current: MonthlyReview | null
  /** The most recent decision, when it was made on an earlier version. */
  earlier: MonthlyReview | null
}>

/**
 * Dashboard view of a report's decisions. A decision on an older version is
 * never presented as approval of the current one — that distinction is the whole
 * point of recording it per version.
 */
export async function readReviewState(input: {
  accountId: string; clientId: string; reportId: string; latestVersionId: string
}): Promise<ReviewState> {
  const reviews = await readMonthlyReviews(input.accountId, input.clientId, input.reportId)
  const current = reviews.find(review => review.versionId === input.latestVersionId) ?? null
  const earlier = current ? null : (reviews[0] ?? null)
  return { current, earlier }
}
