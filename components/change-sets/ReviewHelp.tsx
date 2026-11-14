'use client'
import { useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { reviewMemberSupport, type ReviewMemberSupport } from '@/lib/change-sets/review-support'

type ReviewHelpProps = {
  clientId: string
  workItemId: string
  versionId: string
  contentHash: string
  viewerProfileId: string
  submittedBy: string
}

export function ReviewHelp(props: ReviewHelpProps) {
  const scope = JSON.stringify([props.clientId, props.workItemId, props.versionId, props.contentHash, props.viewerProfileId, props.submittedBy].map(value => value.toLowerCase()))
  return <ScopedReviewHelp key={scope} {...props} viewerProfileId={props.viewerProfileId.toLowerCase()} submittedBy={props.submittedBy.toLowerCase()} />
}

function ScopedReviewHelp({ viewerProfileId, submittedBy }: ReviewHelpProps) {
  const t = useTranslations('changeSets.reviewHelp'), lang = useLocale()
  const [expanded, setExpanded] = useState(false), [retry, setRetry] = useState(0)
  const [support, setSupport] = useState<ReviewMemberSupport | 'loading'>('loading')
  const generation = useRef(0)
  const pending = useRef<AbortController | null>(null)
  useEffect(() => {
    if (!expanded) return
    const sequence = generation
    const token = ++sequence.current, controller = new AbortController()
    pending.current = controller
    void (async () => {
      let next: ReviewMemberSupport = 'unknown'
      try {
        const response = await fetch('/api/account/members', { cache: 'no-store', signal: controller.signal })
        if (!response.ok) throw Error()
        next = reviewMemberSupport(await response.json(), viewerProfileId, submittedBy)
      } catch { /* A failed member read never becomes an empty approver pool. */ }
      if (sequence.current === token && !controller.signal.aborted) setSupport(next)
    })()
    return () => {
      controller.abort()
      if (sequence.current === token) sequence.current++
    }
  }, [expanded, retry, viewerProfileId, submittedBy])

  function reset() {
    generation.current++
    pending.current?.abort()
    setSupport('loading')
  }
  return <details className="space-y-2" onToggle={event => {
    reset()
    const open = event.currentTarget.open
    setExpanded(open)
    if (open) setRetry(value => value + 1)
  }}>
    <summary className="min-h-11 cursor-pointer py-2 underline">{t('title')}</summary>
    {expanded && <div className="space-y-2">
      <p role="status">{t(support)}</p>
      {support !== 'loading' && <>
        {support === 'unknown' && <button type="button" className="min-h-11 rounded-lg border border-border px-4 py-2 font-semibold" onClick={() => { reset(); setRetry(value => value + 1) }}>{t('retry')}</button>}
        <a className="inline-flex min-h-11 items-center underline" href={`/${lang}/dashboard/settings#members`}>{t('members')}</a>
      </>}
    </div>}
  </details>
}
