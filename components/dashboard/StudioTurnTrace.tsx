'use client'

import { useTranslations } from 'next-intl'
import { CircleAlert, CircleCheck, LoaderCircle } from 'lucide-react'
import { traceSteps, type TraceStepKey } from '@/lib/conversation-studio/trace'

type Props = Parameters<typeof traceSteps>[0]

// Reuse each source's own plan-generic title, so the trace never names a vendor
// the rest of the answer does not.
const titleKey: Record<TraceStepKey, string> = {
  saved: 'savedDataLabel', attached: 'attach.badge', gsc: 'gsc.title', dfs: 'dfs.title', firecrawl: 'firecrawl.title', live: 'live.title',
}
const icons = { done: CircleCheck, pending: LoaderCircle, unavailable: CircleAlert }

/** Studio redesign R1 trace: which evidence this turn read, and how each read ended. */
export function StudioTurnTrace(turn: Props) {
  const t = useTranslations('conversationStudio')
  const steps = traceSteps(turn)
  const pending = steps.some(step => step.status === 'pending')
  return <details className="as-trace">
    <summary>{t(pending ? 'trace.summaryRunning' : 'trace.summary', { count: steps.length })}</summary>
    <ol className="as-trace-steps">
      {steps.map(({ key, status }) => {
        const Icon = icons[status]
        return <li key={key} data-status={status}>
          <Icon className={`size-4 shrink-0${status === 'pending' ? ' motion-safe:animate-spin' : ''}`} aria-hidden="true" />
          <span>{t(titleKey[key])}</span>
          <span className="as-muted as-small">{t(`trace.${status}`)}</span>
          {key === 'attached' && turn.attached && <span className="as-muted as-small [overflow-wrap:anywhere]">{turn.attached.label}</span>}
        </li>
      })}
    </ol>
  </details>
}
