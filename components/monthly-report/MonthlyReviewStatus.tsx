'use client'

import { CopyButton } from '@/components/ui/copy-button'

/**
 * The dashboard's client-review block: the review link to copy, the recorded
 * decision (or that none exists), and the client's comment. Advisory by product
 * decision — publishing is never gated on this, and the copy says so.
 */
export function MonthlyReviewStatus({ copy, reviewUrl, statusLine, comment }: {
  copy: { title: string; intro: string; copyLink: string; commentHeading: string }
  reviewUrl: string
  statusLine: string
  comment: string | null
}) {
  return (
    <section className="space-y-3 rounded-lg border border-border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{copy.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{copy.intro}</p>
        </div>
        <CopyButton value={reviewUrl} label={copy.copyLink} />
      </div>
      <p className="text-sm font-medium" role="status">{statusLine}</p>
      {comment ? <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{copy.commentHeading}</p>
        <p className="whitespace-pre-line text-sm text-muted-foreground">{comment}</p>
      </div> : null}
    </section>
  )
}
