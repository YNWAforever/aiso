import { useTranslations } from 'next-intl'
import { digest, executionKey, presentSummaryReceipt, readSummaryReceipt } from '@/lib/n8n/schema'

/** Read-only server projection of the already-owned scan; rendering cannot generate or retry work. */
export function SavedScanSummary({ value }: { value: unknown }) {
  const t = useTranslations('savedScanSummary')
  const receipt = readSummaryReceipt(value)
  if (!receipt) return null
  const view = presentSummaryReceipt(receipt)
  const summary = receipt.summary
  const saved = view.state === 'succeeded'
    && typeof summary?.text === 'string' && summary.text.trim().length >= 10 && summary.text.length <= 6000
    && summary.hash === digest(summary.text.trim()) && summary.provider?.httpStatus === 200
    && executionKey.test(receipt.executionId ?? '') && executionKey.test(receipt.workflowId ?? '')
  const statuses = {
    queued: 'pending', running: 'running', failed: 'failed',
    dispatch_failed: 'failed', outcome_unknown: 'unconfirmed',
  } as const
  const status = saved ? 'saved' : statuses[view.state as keyof typeof statuses] ?? 'unavailable'
  const body = {
    saved: 'source', pending: 'pending_body', running: 'running_body',
    failed: 'failed_body', unconfirmed: 'unconfirmed_body', unavailable: 'unavailable_body',
  } as const

  return (
    <section aria-label={t('title')} data-testid="saved-scan-summary"
      className="rounded-xl border border-dash-border bg-dash-surface p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-dash-text">{t('title')}</h2>
        <span role="status" className={`text-xs ${saved ? 'text-dash-success' : 'text-dash-muted'}`}>
          {t(status)}
        </span>
      </div>
      {saved && <p className="whitespace-pre-line break-words text-sm leading-relaxed text-dash-text">{summary!.text.trim()}</p>}
      <p className={`${saved ? 'mt-3 ' : ''}text-xs leading-relaxed text-dash-muted`}>{t(body[status])}</p>
    </section>
  )
}
