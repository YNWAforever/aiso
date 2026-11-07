import type { ReactNode } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import type { MonthActivity, MonthDelivery, MonthSnapshot, SnapshotFigures } from '@/lib/brand-month/store'
import type { SnapshotKind } from '@/lib/brand-month/period'
import { platformName } from '@/lib/brand-month/labels'

export type MonthRecordCopy = {
  title: string; previous: string; next: string; allBrands: string; report?: string
  delivered: string; verifiedLive: string; selfReported: string; none: string
  figures: string; opening: string; closing: string; notRecorded: string; notConnected: string
  scanScore: string; shareOfVoice: string; searchClicks: string; searchImpressions: string
  activity: string; workItemsOpened: string; workItemsDone: string; siteEditsSent: string; receiptsCompleted: string; receiptsRejected: string
}

type Props = {
  lang: 'en' | 'zh-HK'
  brandName: string
  monthLabel: string
  previousHref: string | null
  queueHref?: string
  reportHref?: string
  nextHref: string | null
  snapshots: MonthSnapshot[]
  activity: MonthActivity
  copy: MonthRecordCopy
  /** Shown when a due snapshot is not recorded yet. */
  recordAction?: ReactNode
}

type Cell = { text: string; muted?: boolean }

/**
 * Retainer OS Slice B: one brand's Hong Kong month. Delivery comes first
 * (verified live, then self-reported, never merged), then the opening and
 * closing figures as recorded, then what happened. Every missing value says
 * why (none / not connected / not recorded) instead of showing a zero.
 */
export function MonthRecord({ lang, brandName, monthLabel, previousHref, queueHref, reportHref, nextHref, snapshots, activity, copy, recordAction }: Props) {
  const number = new Intl.NumberFormat(lang)
  const day = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', timeZone: 'Asia/Hong_Kong' })
  const byKind = (kind: SnapshotKind) => snapshots.find(s => s.kind === kind)?.figures ?? null
  const opening = byKind('opening'), closing = byKind('closing')

  const missing = (figures: SnapshotFigures | null): Cell | null => figures ? null : { text: copy.notRecorded, muted: true }
  const scanCell = (f: SnapshotFigures | null): Cell => missing(f) ?? (f!.scan.state === 'ok' && f!.scan.score !== null
    ? { text: number.format(f!.scan.score) } : { text: copy.none, muted: true })
  const sovCell = (f: SnapshotFigures | null, platform: string): Cell => {
    const blank = missing(f); if (blank) return blank
    const row = f!.pulse.state === 'ok' ? f!.pulse.platforms.find(p => p.platform === platform) : undefined
    return row && row.sovScore !== null ? { text: `${number.format(row.sovScore)}%` } : { text: copy.none, muted: true }
  }
  const searchCell = (f: SnapshotFigures | null, field: 'clicks' | 'impressions'): Cell => {
    const blank = missing(f); if (blank) return blank
    if (f!.search.state === 'not_connected') return { text: copy.notConnected, muted: true }
    return f!.search.state === 'ok' ? { text: number.format(f!.search[field]) } : { text: copy.none, muted: true }
  }
  const platforms = [...new Set([opening, closing].flatMap(f => f?.pulse.state === 'ok' ? f.pulse.platforms.map(p => p.platform) : []))].sort()
  const rows: { label: string; cells: [Cell, Cell] }[] = [
    { label: copy.scanScore, cells: [scanCell(opening), scanCell(closing)] },
    ...platforms.map(p => ({ label: `${copy.shareOfVoice} · ${platformName(p)}`, cells: [sovCell(opening, p), sovCell(closing, p)] as [Cell, Cell] })),
    { label: copy.searchClicks, cells: [searchCell(opening, 'clicks'), searchCell(closing, 'clicks')] },
    { label: copy.searchImpressions, cells: [searchCell(opening, 'impressions'), searchCell(closing, 'impressions')] },
  ]

  const deliveries = (title: string, list: MonthDelivery[]) => (
    <section aria-label={title} className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {list.length ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {list.map(d => (
            <li key={d.attestationId} className="flex items-baseline justify-between gap-4 px-3 py-2 text-sm">
              <span className="min-w-0 break-words">{d.title}</span>
              <time dateTime={d.recordedAt} className="shrink-0 text-muted-foreground">{day.format(new Date(d.recordedAt))}</time>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted-foreground">{copy.none}</p>}
    </section>
  )

  const counts: [string, number][] = [
    [copy.workItemsOpened, activity.workItemsOpened], [copy.workItemsDone, activity.workItemsDone],
    [copy.siteEditsSent, activity.siteEditsSent], [copy.receiptsCompleted, activity.receiptsCompleted], [copy.receiptsRejected, activity.receiptsRejected],
  ]

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">{brandName}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{copy.title} · {monthLabel}</h1>
        </div>
        <nav aria-label={copy.title} className="flex flex-wrap gap-2">
          {reportHref && copy.report ? <Link href={reportHref} className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm hover:bg-muted">{copy.report}</Link> : null}
          {queueHref ? <Link href={queueHref} className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm hover:bg-muted">{copy.allBrands}</Link> : null}
          {previousHref ? <Link href={previousHref} className="inline-flex min-h-11 items-center gap-1 rounded-md border border-border px-3 text-sm hover:bg-muted"><ChevronLeft aria-hidden="true" className="size-4" />{copy.previous}</Link> : null}
          {nextHref ? <Link href={nextHref} className="inline-flex min-h-11 items-center gap-1 rounded-md border border-border px-3 text-sm hover:bg-muted">{copy.next}<ChevronRight aria-hidden="true" className="size-4" /></Link> : null}
        </nav>
      </header>

      <Card><CardContent className="space-y-4 p-5">
        <h2 className="text-lg font-semibold">{copy.delivered}</h2>
        {deliveries(copy.verifiedLive, activity.verifiedLive)}
        {deliveries(copy.selfReported, activity.selfReported)}
      </CardContent></Card>

      <Card><CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{copy.figures}</h2>
          {recordAction}
        </div>
        <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label={copy.figures}>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-left text-muted-foreground">
              <th scope="col" className="py-2 pr-4 font-medium"><span className="sr-only">{copy.figures}</span></th>
              <th scope="col" className="py-2 pr-4 font-medium">{copy.opening}</th>
              <th scope="col" className="py-2 font-medium">{copy.closing}</th>
            </tr></thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.label} className="border-b border-border last:border-0">
                  <th scope="row" className="py-2 pr-4 text-left font-normal">{row.label}</th>
                  {row.cells.map((cell, i) => <td key={i} className={`py-2 tabular-nums ${i === 0 ? 'pr-4' : ''} ${cell.muted ? 'text-muted-foreground' : ''}`}>{cell.text}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent></Card>

      <Card><CardContent className="space-y-3 p-5">
        <h2 className="text-lg font-semibold">{copy.activity}</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {counts.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 border-b border-border py-1">
              <dt>{label}</dt><dd className="tabular-nums">{number.format(value)}</dd>
            </div>
          ))}
        </dl>
      </CardContent></Card>
    </main>
  )
}
