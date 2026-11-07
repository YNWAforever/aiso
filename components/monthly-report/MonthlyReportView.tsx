import type { MonthlyReportSnapshotV2, MonthlyDeliveredItem } from '@/lib/monthly-report/snapshot'

export type MonthlyReportCopy = {
  delivered: string; verifiedLive: string; selfReported: string; none: string
  visibility: string; visibilityPending: string
  search: string; before: string; endOfMonth: string; clicks: string; impressions: string; notConnected: string; notRecorded: string
  nextMonth: string
}

/**
 * The monthly deliverables report, in the brief's fixed order: delivered
 * (verified live, then self-reported), visibility, search demand, next month.
 * Renders only what the frozen snapshot holds; a missing figure says why.
 */
export function MonthlyReportView({ snapshot, lang, copy }: {
  snapshot: Pick<MonthlyReportSnapshotV2, 'executiveSummary' | 'delivered' | 'search' | 'nextMonth'>; lang: 'en' | 'zh-HK'; copy: MonthlyReportCopy
}) {
  const number = new Intl.NumberFormat(lang)
  const day = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', timeZone: 'Asia/Hong_Kong' })
  const dateOnly = (d: string) => day.format(new Date(`${d}T00:00:00+08:00`))
  const list = (title: string, items: MonthlyDeliveredItem[]) => (
    <section aria-label={title} className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {items.length ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {items.map(d => (
            <li key={`${d.versionId}-${d.recordedAt}`} className="flex items-baseline justify-between gap-4 px-3 py-2 text-sm">
              <span className="min-w-0 break-words">{d.title}</span>
              <time dateTime={d.recordedAt} className="shrink-0 text-muted-foreground">{day.format(new Date(d.recordedAt))}</time>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted-foreground">{copy.none}</p>}
    </section>
  )
  const searchRow = (label: string, f: MonthlyReportSnapshotV2['search']['opening']) => {
    const cells = f.state === 'ok' ? [number.format(f.clicks), number.format(f.impressions)]
      : f.state === 'not_connected' ? [copy.notConnected, copy.notConnected]
      : f.state === 'not_recorded' ? [copy.notRecorded, copy.notRecorded] : [copy.none, copy.none]
    const muted = f.state !== 'ok'
    const range = f.state === 'ok' || f.state === 'none' ? ` · ${dateOnly(f.from)} – ${dateOnly(f.through)}` : ''
    return (
      <tr className="border-b border-border last:border-0">
        <th scope="row" className="py-2 pr-4 text-left font-normal">{label}{range}</th>
        {cells.map((c, i) => <td key={i} className={`py-2 pr-4 tabular-nums ${muted ? 'text-muted-foreground' : ''}`}>{c}</td>)}
      </tr>
    )
  }
  return (
    <article className="space-y-6">
      <p className="whitespace-pre-line text-sm leading-6">{snapshot.executiveSummary}</p>
      <section className="space-y-4 rounded-lg border border-border p-5">
        <h2 className="text-lg font-semibold">{copy.delivered}</h2>
        {list(copy.verifiedLive, snapshot.delivered.verifiedLive)}
        {list(copy.selfReported, snapshot.delivered.selfReported)}
      </section>
      <section className="space-y-2 rounded-lg border border-border p-5">
        <h2 className="text-lg font-semibold">{copy.visibility}</h2>
        <p className="text-sm text-muted-foreground">{copy.visibilityPending}</p>
      </section>
      <section className="space-y-3 rounded-lg border border-border p-5">
        <h2 className="text-lg font-semibold">{copy.search}</h2>
        <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label={copy.search}>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-left text-muted-foreground">
              <th scope="col" className="py-2 pr-4 font-medium"><span className="sr-only">{copy.search}</span></th>
              <th scope="col" className="py-2 pr-4 font-medium">{copy.clicks}</th>
              <th scope="col" className="py-2 pr-4 font-medium">{copy.impressions}</th>
            </tr></thead>
            <tbody>{searchRow(copy.before, snapshot.search.opening)}{searchRow(copy.endOfMonth, snapshot.search.closing)}</tbody>
          </table>
        </div>
      </section>
      <section className="space-y-2 rounded-lg border border-border p-5">
        <h2 className="text-lg font-semibold">{copy.nextMonth}</h2>
        {snapshot.nextMonth.openWorkItems.length
          ? <ul className="list-disc space-y-1 pl-5 text-sm">{snapshot.nextMonth.openWorkItems.map((w, i) => <li key={i}>{w.title}</li>)}</ul>
          : <p className="text-sm text-muted-foreground">{copy.none}</p>}
      </section>
    </article>
  )
}
