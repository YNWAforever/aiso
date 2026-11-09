'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

export type ReviewFormCopy = {
  title: string
  intro: string
  approve: string
  requestChanges: string
  nameLabel: string
  namePlaceholder: string
  commentLabel: string
  commentPlaceholder: string
  commentRequired: string
  submit: string
  submitting: string
  recordedApproved: string
  recordedByApproved: string
  recordedChanges: string
  recordedByChanges: string
  failed: string
  already: string
}

export type ExistingReview = {
  decision: 'approved' | 'changes_requested'
  reviewerName: string | null
  comment: string | null
  decidedAt: string
}

/**
 * The client-facing decision form on a review link (Phase 3, advisory). The
 * decision is recorded for the version the link was minted for; nothing here
 * publishes or changes the report. A recorded decision replaces the form rather
 * than allowing a second answer.
 */
export function MonthlyReviewForm({ slug, token, locale, existing, copy }: {
  slug: string
  token: string
  locale: 'en' | 'zh-HK'
  existing: ExistingReview | null
  copy: ReviewFormCopy
}) {
  const [decision, setDecision] = useState<'approved' | 'changes_requested' | null>(null)
  const [name, setName] = useState('')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [recorded, setRecorded] = useState<ExistingReview | null>(existing)
  const [error, setError] = useState<string | null>(null)

  const when = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'Asia/Hong_Kong' }).format(new Date(value))
  const recordedLine = (review: ExistingReview) => {
    const date = when(review.decidedAt)
    const base = review.decision === 'approved'
      ? (review.reviewerName ? copy.recordedByApproved : copy.recordedApproved)
      : (review.reviewerName ? copy.recordedByChanges : copy.recordedChanges)
    return base.replace('{date}', date).replace('{name}', review.reviewerName ?? '')
  }

  if (recorded) {
    return (
      <section className="rounded-xl border border-border bg-card p-5" aria-live="polite">
        <h2 className="text-lg font-semibold">{copy.title}</h2>
        <p role="status" className="mt-2 text-sm font-medium">{recordedLine(recorded)}</p>
        {recorded.comment ? <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{recorded.comment}</p> : null}
      </section>
    )
  }

  async function submit() {
    if (!decision) return
    setBusy(true); setError(null)
    try {
      const response = await fetch('/api/public/monthly-reports/review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug, review: token, decision,
          ...(name.trim() ? { reviewerName: name.trim() } : {}),
          ...(comment.trim() ? { comment: comment.trim() } : {}),
        }),
      })
      if (response.status === 409) { setError(copy.already); return }
      if (!response.ok) { setError(copy.failed); return }
      const body = await response.json().catch(() => ({})) as { decision?: unknown; decidedAt?: unknown }
      setRecorded({
        decision: body.decision === 'changes_requested' ? 'changes_requested' : (decision as 'approved' | 'changes_requested'),
        reviewerName: name.trim() || null,
        comment: comment.trim() || null,
        decidedAt: typeof body.decidedAt === 'string' ? body.decidedAt : new Date().toISOString(),
      })
    } catch { setError(copy.failed) } finally { setBusy(false) }
  }

  const needsComment = decision === 'changes_requested' && !comment.trim()
  return (
    <form className="space-y-4 rounded-xl border border-border bg-card p-5" onSubmit={event => { event.preventDefault(); void submit() }}>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{copy.title}</h2>
        <p className="text-sm text-muted-foreground">{copy.intro}</p>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-labelledby="review-decision-label">
        <span id="review-decision-label" className="sr-only">{copy.title}</span>
        {(['approved', 'changes_requested'] as const).map(option => (
          <Button key={option} type="button" variant={decision === option ? 'default' : 'outline'} className="min-h-11"
            aria-pressed={decision === option} onClick={() => setDecision(option)}>
            {option === 'approved' ? copy.approve : copy.requestChanges}
          </Button>
        ))}
      </div>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">{copy.nameLabel}</span>
        <input className="block min-h-11 w-full rounded-md border border-border bg-background px-3" maxLength={120}
          value={name} onChange={event => setName(event.target.value)} placeholder={copy.namePlaceholder} />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">{copy.commentLabel}{decision === 'changes_requested' ? ' *' : ''}</span>
        <textarea className="block min-h-24 w-full rounded-md border border-border bg-background p-3" maxLength={2000}
          value={comment} onChange={event => setComment(event.target.value)} placeholder={copy.commentPlaceholder} />
      </label>
      {decision === 'changes_requested' && !comment.trim() ? <p role="status" className="text-sm text-muted-foreground">{copy.commentRequired}</p> : null}
      {error ? <p role="alert" className="text-sm text-tone-danger-fg">{error}</p> : null}
      <Button type="submit" className="min-h-11" disabled={busy || !decision || needsComment} aria-busy={busy}>
        {busy ? copy.submitting : copy.submit}
      </Button>
    </form>
  )
}
