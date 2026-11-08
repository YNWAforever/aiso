import Link from 'next/link'
import { FileText } from 'lucide-react'

/**
 * The brand dashboard's one-line entry to the current month's deliverable:
 * month, version, status, and a link to the report page. Server-rendered; the
 * page supplies the already-translated strings, as the rest of the dashboard
 * shell does.
 */
export function MonthlyReportEntry({ lang, clientId, monthKey, monthLabel, title, versionLabel, statusLabel, openLabel }: {
  lang: string
  clientId: string
  monthKey: string
  monthLabel: string
  title: string
  versionLabel: string
  statusLabel: string
  openLabel: string
}) {
  return (
    <Link
      href={`/${lang}/dashboard/${clientId}/month/report?m=${encodeURIComponent(monthKey)}`}
      className="flex min-h-11 items-center justify-between gap-4 rounded-xl border border-dash-border bg-dash-surface px-4 py-3 text-sm transition-colors hover:bg-dash-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex min-w-0 items-center gap-2">
        <FileText aria-hidden="true" className="size-4 shrink-0 text-dash-muted" />
        <span className="min-w-0">
          <span className="block font-semibold text-dash-text">{title}</span>
          <span className="block text-xs text-dash-muted">{monthLabel} · {versionLabel} · {statusLabel}</span>
        </span>
      </span>
      <span className="shrink-0 font-semibold text-primary">{openLabel}</span>
    </Link>
  )
}
