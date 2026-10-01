'use client'
import { useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { parseAttributionResponse, type AttributionTargetView, type AttributionView } from '@/lib/attribution/dto'
import type { EnquiryResult, Figure, TargetStatus } from '@/lib/attribution/types'

/**
 * Measured change beside a delivered version's technical outcomes (spec 6).
 *
 * It reports what moved, never why: every comparable row carries the standing
 * caption, and no string here says the delivery caused anything. Numbers arrive
 * unrounded from lib/attribution/compare.ts and are rounded here, once, by
 * Intl.NumberFormat, so float noise such as 0.19999999999999998 never reaches
 * the page. The presentational pieces take a plain `t` so they render without a
 * provider; the block alone reads the locale and the catalogue.
 */

type T = (key: string, values?: Record<string, string | number>) => string
type Source = 'search' | 'enquiries'
type Kind = 'count' | 'ctr' | 'position'

export type FigureRow = { key: string; label: string; kind: Kind; figure: Figure }

/** Catalogue key per status. `comparable` has none: it shows figures, not a sentence. */
export const STATUS_COPY: Record<Exclude<TargetStatus, 'comparable'>, string> = {
  withdrawn: 'statusWithdrawn',
  not_supported: 'statusNotSupported',
  not_measured: 'statusNotMeasured',
  unavailable: 'statusUnavailable',
  not_ready: 'statusNotReady',
  insufficient_history: 'statusInsufficientHistory',
}

/** Catalogue key per `unavailable` reason (enquiries add `not_enabled`). */
export const REASON_COPY: Record<string, string> = {
  not_bound: 'reasonNotBound',
  rebound: 'reasonRebound',
  sync_failing: 'reasonSyncFailing',
  not_enabled: 'reasonNotEnabled',
}

const SOURCE_COPY: Record<Source, string> = { search: 'sourceSearch', enquiries: 'sourceEnquiries' }
const DASH = '–'

const number = (locale: string, options: Intl.NumberFormatOptions) => new Intl.NumberFormat(locale, options)

type Shown = { change: string | null; before: string | null; after: string | null }

function show(figure: Figure, kind: Kind, locale: string, t: T): Shown {
  const apply = (v: number | null, f: (n: number) => string) => (v === null ? null : f(v))
  if (kind === 'ctr') {
    // CTR is a 0-1 fraction and so is its change: percent for the values,
    // percentage points for the difference.
    const pct = number(locale, { style: 'percent', maximumFractionDigits: 2 })
    const points = number(locale, { maximumFractionDigits: 2, signDisplay: 'exceptZero' })
    return {
      before: apply(figure.before, v => pct.format(v)),
      after: apply(figure.after, v => pct.format(v)),
      change: apply(figure.change, v => t('unitPoints', { value: points.format(v * 100) })),
    }
  }
  if (kind === 'position') {
    const place = number(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    const delta = number(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' })
    return {
      before: apply(figure.before, v => place.format(v)),
      after: apply(figure.after, v => place.format(v)),
      change: apply(figure.change, v => t('unitPlaces', { value: delta.format(v) })),
    }
  }
  const plain = number(locale, { maximumFractionDigits: 0 })
  const delta = number(locale, { maximumFractionDigits: 0, signDisplay: 'exceptZero' })
  return {
    before: apply(figure.before, v => plain.format(v)),
    after: apply(figure.after, v => plain.format(v)),
    change: apply(figure.change, v => delta.format(v)),
  }
}

/** The change as a figure and, when there is one, a relative change: `+5 (+50%)`, `+40 (new)`. */
function changeText(figure: Figure, shown: Shown, locale: string, t: T): string {
  let relative: string | null = null
  if (figure.changePct === 'new') relative = t('changeNew')
  else if (typeof figure.changePct === 'number') {
    relative = number(locale, { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format(figure.changePct)
  }
  if (shown.change === null) return relative ?? DASH
  return relative === null ? shown.change : `${shown.change} (${relative})`
}

export function TargetStatusNotice({
  status, reason, readyOn, missingFrom, missingTo, source, t,
}: {
  status: TargetStatus
  reason?: string
  readyOn?: string
  missingFrom?: string
  missingTo?: string
  source: Source
  t: T
}) {
  if (status === 'comparable') return null
  let text: string
  if (status === 'unavailable') {
    const key = reason ? REASON_COPY[reason] : undefined
    text = key ? t(key, { source: t(SOURCE_COPY[source]) }) : t(STATUS_COPY.unavailable)
  } else if (status === 'not_ready') {
    text = t(STATUS_COPY.not_ready, { date: readyOn ?? DASH })
  } else if (status === 'insufficient_history') {
    text = t(STATUS_COPY.insufficient_history, { from: missingFrom ?? DASH, to: missingTo ?? DASH })
  } else {
    text = t(STATUS_COPY[status])
  }
  return <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm">{text}</p>
}

export function FigureTable({ title, rows, t, locale }: { title: string; rows: FigureRow[]; t: T; locale: string }) {
  return (
    <div className="min-w-0 space-y-2">
      <h4 className="font-semibold">{title}</h4>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th scope="col" className="py-1 pr-3 font-semibold">{t('colMeasure')}</th>
              <th scope="col" className="py-1 pr-3 text-right font-semibold">{t('colBefore')}</th>
              <th scope="col" className="py-1 pr-3 text-right font-semibold">{t('colAfter')}</th>
              <th scope="col" className="py-1 text-right font-semibold">{t('colChange')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const shown = show(row.figure, row.kind, locale, t)
              return (
                <tr key={row.key} className="border-t border-border">
                  <th scope="row" className="py-1 pr-3 text-left font-normal">{row.label}</th>
                  <td className="py-1 pr-3 text-right">{shown.before ?? DASH}</td>
                  <td className="py-1 pr-3 text-right">{shown.after ?? DASH}</td>
                  <td className="py-1 text-right">{changeText(row.figure, shown, locale, t)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function searchRows(search: NonNullable<AttributionTargetView['search']>, t: T): FigureRow[] {
  return [
    { key: 'clicks', label: t('metricClicks'), kind: 'count', figure: search.clicks },
    { key: 'impressions', label: t('metricImpressions'), kind: 'count', figure: search.impressions },
    { key: 'ctr', label: t('metricCtr'), kind: 'ctr', figure: search.ctr },
    { key: 'position', label: t('metricPosition'), kind: 'position', figure: search.position },
  ]
}

function enquiryRows(enquiries: EnquiryResult, t: T): FigureRow[] {
  const rows: Array<[string, string, Figure | undefined]> = [
    ['total', 'enquiriesTotal', enquiries.total],
    ['organic_search', 'enquiriesOrganic', enquiries.organic_search],
    ['ai_assistant', 'enquiriesAi', enquiries.ai_assistant],
    ['other', 'enquiriesOther', enquiries.other],
  ]
  return rows.flatMap(([key, label, figure]) => (figure ? [{ key, label: t(label), kind: 'count' as const, figure }] : []))
}

export function TargetRow({ target, t, locale }: { target: AttributionTargetView; t: T; locale: string }) {
  const searchShown = target.status === 'comparable' && target.search
  const enquiries = target.enquiries
  const enquiriesShown = enquiries?.status === 'comparable'
  return (
    <article className="min-w-0 space-y-3 break-words rounded-lg border border-border p-3">
      {target.scope === 'site' && <h3 className="font-semibold">{t('scopeSite')}</h3>}
      {target.scope === 'page' && (
        <h3 className="font-semibold">
          {target.asset?.label || t('scopePage')}
          {target.asset?.url && <span className="block break-all text-sm font-normal text-muted-foreground">{target.asset.url}</span>}
        </h3>
      )}
      <TargetStatusNotice
        status={target.status}
        reason={target.reason}
        readyOn={target.readyOn}
        missingFrom={target.missingFrom}
        missingTo={target.missingTo}
        source="search"
        t={t}
      />
      {searchShown && target.search && (
        <FigureTable title={t('searchTitle')} rows={searchRows(target.search, t)} t={t} locale={locale} />
      )}
      {enquiries && (
        enquiriesShown
          ? (
            <div className="space-y-2">
              <FigureTable title={t('enquiriesTitle')} rows={enquiryRows(enquiries, t)} t={t} locale={locale} />
              {enquiries.withheld === true && <p className="text-sm text-muted-foreground">{t('enquiriesWithheld')}</p>}
            </div>
          )
          : (
            <div className="space-y-2">
              <h4 className="font-semibold">{t('enquiriesTitle')}</h4>
              <TargetStatusNotice
                status={enquiries.status}
                reason={enquiries.reason}
                readyOn={enquiries.readyOn}
                missingFrom={enquiries.missingFrom}
                missingTo={enquiries.missingTo}
                source="enquiries"
                t={t}
              />
            </div>
          )
      )}
      {(searchShown || enquiriesShown) && <p className="text-sm text-muted-foreground">{t('measuredCaption')}</p>}
    </article>
  )
}

type ReadState = { key: string; value: AttributionView | null; error: boolean; loading: boolean }

export function MeasuredChangeBlock({
  clientId, itemId, versionId, refreshKey,
}: { clientId: string; itemId: string; versionId: string; refreshKey: number }) {
  const translate = useTranslations('attribution')
  const t: T = (key, values) => translate(key as never, values as never)
  const locale = useLocale()
  const [retry, setRetry] = useState(0)
  const [read, setRead] = useState<ReadState | null>(null)
  const generation = useRef(0)
  const key = JSON.stringify([clientId, itemId, versionId, refreshKey, retry])
  // Hide old results during render, before the effect's cleanup runs.
  const current = read?.key === key ? read : null
  const loading = !current || current.loading

  useEffect(() => {
    const controller = new AbortController()
    const requests = generation
    const token = ++requests.current
    const active = () => !controller.signal.aborted && token === requests.current
    async function load() {
      if (!active()) return
      setRead({ key, value: null, error: false, loading: true })
      try {
        const response = await fetch(
          '/api/clients/' + encodeURIComponent(clientId) + '/work-items/' + encodeURIComponent(itemId) +
            '/versions/' + encodeURIComponent(versionId) + '/attribution',
          { cache: 'no-store', signal: controller.signal },
        )
        if (!response.ok) throw Error('unavailable')
        const value = parseAttributionResponse(await response.json())
        if (active()) setRead({ key, value, error: false, loading: false })
      } catch {
        // Every failure reads the same: the cause stays out of the page.
        if (active()) setRead({ key, value: null, error: true, loading: false })
      }
    }
    const start = setTimeout(() => { void load() }, 0)
    return () => { clearTimeout(start); controller.abort(); requests.current++ }
  }, [clientId, itemId, versionId, refreshKey, retry, key])

  const value = current?.value ?? null
  return (
    <section className="min-w-0 space-y-4 rounded-xl border border-border p-4 break-words" aria-label={t('measuredTitle')} aria-busy={loading}>
      <h2 className="text-xl font-semibold">{t('measuredTitle')}</h2>
      <button type="button" className="min-h-11 rounded border border-border px-4 py-2 font-semibold" onClick={() => setRetry(n => n + 1)}>
        {current?.error ? t('measuredRetry') : t('measuredRefresh')}
      </button>
      <p aria-live="polite" aria-atomic="true">{loading ? t('measuredLoading') : current?.error ? '' : t('measuredLoaded')}</p>
      {current?.error && <p role="alert">{t('measuredUnavailable')}</p>}
      {value && value.targets.length === 0 && <p>{t('measuredNotDelivered')}</p>}
      {value && value.targets.length > 0 && (
        <div className="space-y-3">
          {value.deliveredOn && value.windows && (
            <p className="text-sm">
              {t('measuredWindows', {
                delivered: value.deliveredOn,
                beforeFrom: value.windows.before.from,
                beforeTo: value.windows.before.to,
                afterFrom: value.windows.after.from,
                afterTo: value.windows.after.to,
              })}
            </p>
          )}
          {value.targets.map((target, index) => (
            <TargetRow key={(target.asset?.id ?? target.scope ?? 'none') + ':' + index} target={target} t={t} locale={locale} />
          ))}
        </div>
      )}
    </section>
  )
}
