import Link from 'next/link'
import { needsAttention, type QueueRow } from '@/lib/brand-month/queue-rules'

export type MonthQueueCopy = {
  title: string; brand: string; approvals: string; editsUnverified: string; sends: string; pulse: string; searchConsole: string; monthRecord: string
  overdue: string; notEnabled: string; notConnected: string; stale: string; recorded: string; notRecorded: string; none: string; allClear: string
  empty: string
}

/**
 * The cross-brand queue: brands that need something first, in the order the
 * store returned them; then the rest. A cell names its state instead of
 * leaving a blank, and every brand links to its month page.
 */
export function MonthQueue({ lang, rows, monthHref, copy, sendCap }: {
  lang: 'en' | 'zh-HK'; rows: QueueRow[]; monthHref: (clientId: string) => string; copy: MonthQueueCopy; sendCap: number
}) {
  const number = new Intl.NumberFormat(lang)
  const day = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', timeZone: 'Asia/Hong_Kong' })
  const ordered = [...rows.filter(needsAttention), ...rows.filter(r => !needsAttention(r))]
  const flag = (on: boolean, text: string) => <span className={on ? 'font-medium text-tone-warning-fg' : 'text-muted-foreground'}>{text}</span>
  // An empty account would otherwise show a table header above nothing at all.
  if (rows.length === 0) return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">{copy.title}</h1>
      <p className="text-sm text-muted-foreground">{copy.empty}</p>
    </main>
  )
  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">{copy.title}</h1>
      {rows.length && !rows.some(needsAttention) ? <p role="status" className="text-sm text-muted-foreground">{copy.allClear}</p> : null}
      <div className="relative overflow-x-auto rounded-lg border border-border" tabIndex={0} role="region" aria-label={copy.title}>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-border text-left text-muted-foreground">
            {[copy.brand, copy.approvals, copy.editsUnverified, copy.sends, copy.pulse, copy.searchConsole, copy.monthRecord].map(h =>
              <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}
          </tr></thead>
          <tbody>
            {ordered.map(r => (
              <tr key={r.clientId} className="border-b border-border last:border-0">
                <th scope="row" className="px-3 py-2 text-left font-medium">
                  <Link href={monthHref(r.clientId)} className="underline-offset-2 hover:underline">{r.brandName}</Link>
                </th>
                <td className="px-3 py-2 tabular-nums">{flag(r.approvalsWaiting > 0, number.format(r.approvalsWaiting))}</td>
                <td className="px-3 py-2 tabular-nums">{flag(r.editsUnverified > 0, number.format(r.editsUnverified))}</td>
                <td className="px-3 py-2 tabular-nums">{flag(r.nearCap, `${number.format(r.monthSends)} / ${number.format(sendCap)}`)}</td>
                <td className="px-3 py-2">{r.activeQuestions === 0 ? flag(false, copy.notEnabled)
                  : r.pulseOverdue ? flag(true, copy.overdue)
                  : flag(false, r.lastPulseWeek ? day.format(new Date(`${r.lastPulseWeek}T00:00:00+08:00`)) : copy.none)}</td>
                <td className="px-3 py-2">{r.searchConsole === 'not_connected' ? flag(false, copy.notConnected)
                  : r.searchConsole === 'stale' ? flag(true, copy.stale)
                  : flag(false, r.lastSync ? day.format(new Date(r.lastSync)) : copy.none)}</td>
                <td className="px-3 py-2">{flag(r.snapshotsPending, r.snapshotsPending ? copy.notRecorded : copy.recorded)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  )
}
