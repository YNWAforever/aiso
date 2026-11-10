'use client'

import { useTranslations } from 'next-intl'
import { CircleAlert, CircleCheck, LoaderCircle } from 'lucide-react'
import { traceSteps, type TraceStepKey } from '@/lib/conversation-studio/trace'
import type { StudioReceipt, StudioReceiptKind } from '@/lib/conversation-studio/receipts'

type Props = Parameters<typeof traceSteps>[0] & {
  /** Server-composed provenance, once this turn has been saved. */
  receipts?: StudioReceipt[] | null
}

// Reuse each source's own plan-generic title, so the trace never names a vendor
// the rest of the answer does not.
const titleKey: Record<TraceStepKey, string> = {
  saved: 'savedDataLabel', attached: 'attach.badge', gsc: 'gsc.title', dfs: 'dfs.title', firecrawl: 'firecrawl.title', live: 'live.title',
}
const receiptKey: Record<StudioReceiptKind, string> = {
  'pulse-week': 'receipts.pulseWeek',
  'pulse-observations': 'receipts.observations',
  scan: 'receipts.scan',
  opportunities: 'receipts.opportunities',
  compose: 'receipts.composeLabel',
}
const icons = { done: CircleCheck, pending: LoaderCircle, unavailable: CircleAlert }

/** Studio redesign R1 trace: which evidence this turn read, and how each read ended. */
export function StudioTurnTrace(turn: Props) {
  const t = useTranslations('conversationStudio')
  const steps = traceSteps(turn)
  const pending = steps.some(step => step.status === 'pending')
  const receipts = turn.receipts ?? []
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
    {receipts.length > 0 && <div className="space-y-1">
      <p className="as-small font-semibold">{t('receipts.title')}</p>
      <ul className="as-trace-steps">
        {receipts.map(receipt => <li key={receipt.kind} data-receipt={receipt.kind}>
          {receipt.kind === 'compose'
            ? <span className="as-muted as-small">{t('receipts.digest', { digest: receipt.digest.slice(0, 8) })}</span>
            : <>
              <span>{receipt.kind === 'pulse-week' && receipt.id ? t('receipts.pulseWeek', { id: receipt.id }) : t(receiptKey[receipt.kind])}</span>
              <span className="as-muted as-small">{t('receipts.count', { count: receipt.records })}</span>
              {receipt.truncated && <span className="as-muted as-small">{t('receipts.truncated')}</span>}
            </>}
        </li>)}
      </ul>
    </div>}
  </details>
}
