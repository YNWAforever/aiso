import { MonthlyReportView, type MonthlyReportCopy } from './MonthlyReportView'
import type { PublicMonthlyReport as Report } from '@/lib/monthly-report/public'

/**
 * The client-facing monthly report behind a share link: the agency's name and
 * colour, the brand and month, then the report itself. Only the public copy
 * (lib/monthly-report/public.ts) reaches this component.
 */
export function PublicMonthlyReport({ report, publishedAt, title, publishedLabel, copy }: {
  report: Report; publishedAt: string; title: string; publishedLabel: string; copy: MonthlyReportCopy
}) {
  const lang = report.locale
  const month = new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${report.month}-01T00:00:00Z`))
  const published = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Hong_Kong' }).format(new Date(publishedAt))
  return (
    <article lang={lang} className="mx-auto w-full max-w-3xl space-y-6">
      <header className="space-y-2 border-b-4 pb-4" style={{ borderColor: /^#[0-9A-Fa-f]{6}$/.test(report.branding.primaryColor) ? report.branding.primaryColor : undefined }}>
        <p className="text-sm font-medium text-muted-foreground">{report.branding.agencyName}</p>
        <h1 className="text-2xl font-bold tracking-tight">{report.client.name} · {title}</h1>
        <p className="text-sm text-muted-foreground">{month} · {publishedLabel} <time dateTime={publishedAt}>{published}</time></p>
      </header>
      <MonthlyReportView snapshot={report} lang={lang} copy={copy} />
      <footer className="border-t border-border pt-4 text-xs text-muted-foreground">{report.branding.attribution}</footer>
    </article>
  )
}
