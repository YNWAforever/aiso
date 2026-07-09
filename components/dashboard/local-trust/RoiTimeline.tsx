import type { LocalTrustSnapshot } from '@/lib/types'

type Copy = {
  title: string
  empty: string
  scoreLabel: string
  estimateLabel: string
  noEstimate: string
}

const defaultCopy: Copy = {
  title: 'ROI Proof Timeline',
  empty: 'Run a scan to start your first ROI timeline.',
  scoreLabel: 'Local Trust Score',
  estimateLabel: 'Directional estimate',
  noEstimate: 'Add average lead value and close rate to estimate enquiry value.',
}

type Props = {
  snapshots: LocalTrustSnapshot[]
  copy?: Partial<Copy>
  locale?: string
}

function formatMonth(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value))
}

function formatMoney(low: number, high: number, currency: string, locale: string) {
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
  return `${currency} ${formatter.format(low)}-${formatter.format(high)}`
}

export function RoiTimeline({ snapshots, copy, locale = 'en-HK' }: Props) {
  const labels = { ...defaultCopy, ...copy }

  return (
    <section className="rounded-xl border border-dash-border bg-dash-surface p-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-dash-muted">{labels.title}</p>
      {snapshots.length === 0 ? (
        <p className="mt-2 text-xs leading-relaxed text-dash-muted">{labels.empty}</p>
      ) : (
        <div className="mt-4 space-y-3">
          {snapshots.map(snapshot => (
            <article key={snapshot.id} className="rounded-lg border border-dash-border bg-dash-elevated p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-dash-text">{formatMonth(snapshot.snapshot_month, locale)}</p>
                  <p className="mt-1 text-[11px] font-semibold uppercase tracking-widest text-dash-muted">
                    {labels.scoreLabel}
                  </p>
                </div>
                <p className="font-mono text-sm font-bold text-dash-accent">{snapshot.local_trust_score}/100</p>
              </div>
              {snapshot.roi_estimate ? (
                <p className="mt-3 text-xs leading-relaxed text-dash-muted">
                  <span className="font-semibold text-dash-text">{labels.estimateLabel}: </span>
                  {formatMoney(snapshot.roi_estimate.low, snapshot.roi_estimate.high, snapshot.roi_estimate.currency, locale)}
                </p>
              ) : (
                <p className="mt-3 text-xs leading-relaxed text-dash-muted">{labels.noEstimate}</p>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
