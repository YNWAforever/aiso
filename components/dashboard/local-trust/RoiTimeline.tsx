import type { LocalTrustSnapshot } from '@/lib/types'

/**
 * A scenario, labelled as one.
 *
 * The figure below is `round(enquiries × leadValue × closeRate)` over two numbers
 * the owner typed into their own profile. It is a correct answer to "what would
 * one or two extra enquiries be worth at my assumptions", and a false answer to
 * "what did my Local Trust Score earn me" — and the second is what this panel
 * used to assert, titled "ROI Proof Timeline" and rendered directly beneath that
 * score.
 *
 * The estimator's enquiry range is [1, 2] for every non-zero score, so the money
 * does not move with the score at all. Printing that range in the basis line is
 * deliberate: it makes the constant visible to the reader instead of leaving a
 * heading to imply a relationship the arithmetic does not contain.
 *
 * The limitation sits in the same block as the number on purpose, so the two
 * cannot be screenshotted apart.
 */

type Copy = {
  title: string
  empty: string
  scoreLabel: string
  estimateLabel: string
  noEstimate: string
  /** Template. `{low}`, `{high}`, `{leadValue}`, `{closeRate}`. */
  basis: string
  limitation: string
}

const defaultCopy: Copy = {
  title: 'Enquiry value scenario',
  empty: 'Run a scan to start your first enquiry value scenario.',
  scoreLabel: 'Local Trust Score',
  estimateLabel: 'Estimated',
  noEstimate: 'Add average lead value and close rate to estimate enquiry value.',
  basis: 'Scenario: {low}–{high} extra enquiries at the average lead value ({leadValue}) and close rate ({closeRate}) you entered.',
  limitation:
    'Estimated, not observed. This is arithmetic over the figures you entered. AISO has not measured any enquiry, sale or revenue, and a technical or visibility improvement is not proven search or revenue uplift.',
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

/**
 * The assumptions come from `numeric` columns, which the driver hands back as
 * strings when nothing coerces them. `Intl` would print "8000.00" verbatim or
 * throw, so every value is forced through Number() here as well as at the store
 * boundary — what the owner reads must not depend on which caller got there first.
 */
function formatAmount(value: unknown, currency: string, locale: string) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return String(value ?? '')
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
}

function formatRate(value: unknown, locale: string) {
  const rate = Number(value)
  if (!Number.isFinite(rate)) return String(value ?? '')
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(rate)
}

/** Plain `{name}` substitution: each snapshot carries its own assumptions, so the copy cannot be pre-interpolated. */
function fill(template: string, values: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole)
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
                <div className="mt-3 space-y-2">
                  <p className="text-xs leading-relaxed text-dash-muted">
                    <span className="font-semibold text-dash-text">{labels.estimateLabel}: </span>
                    {formatMoney(snapshot.roi_estimate.low, snapshot.roi_estimate.high, snapshot.roi_estimate.currency, locale)}
                  </p>
                  <p className="text-[11px] leading-relaxed text-dash-muted">
                    {fill(labels.basis, {
                      low: String(snapshot.roi_estimate.assumptions.estimatedExtraEnquiriesLow),
                      high: String(snapshot.roi_estimate.assumptions.estimatedExtraEnquiriesHigh),
                      leadValue: formatAmount(
                        snapshot.roi_estimate.assumptions.averageLeadValue,
                        snapshot.roi_estimate.currency,
                        locale,
                      ),
                      closeRate: formatRate(snapshot.roi_estimate.assumptions.closeRate, locale),
                    })}
                  </p>
                  <p className="text-[11px] leading-relaxed text-dash-muted">{labels.limitation}</p>
                </div>
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
