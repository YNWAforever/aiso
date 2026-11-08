'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { CalendarRange, ExternalLink } from 'lucide-react'

import { CopyButton } from '@/components/ui/copy-button'
import { Card, CardContent } from '@/components/ui/card'
import { ReportStatusBadge } from './ReportStatusBadge'
import type { MonthlyReportListItem } from '@/lib/monthly-report/store'

/**
 * The monthly reports of one brand on the reports page, newest month first.
 * Every row is a saved monthly version; publishing and stopping a share stay on
 * the report page, so this list is discovery and status, not a second editor.
 */
export function MonthlyReportsList({ lang, clientId, rows }: {
  lang: string
  clientId: string
  rows: (MonthlyReportListItem & { signedUrl: string | null })[]
}) {
  const t = useTranslations('reports')
  const month = (key: string) => new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(`${key}-01T00:00:00Z`))
  const reportHref = (key: string) => `/${lang}/dashboard/${clientId}/month/report?m=${encodeURIComponent(key)}`

  if (rows.length === 0) {
    return <Card><CardContent className="p-8 text-center">
      <CalendarRange className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
      <h2 className="mt-4 text-lg font-semibold">{t('monthly_empty_title')}</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">{t('monthly_empty_body')}</p>
    </CardContent></Card>
  }

  return (
    <ul className="space-y-3">
      {rows.map(row => {
        return <li key={row.reportId}>
          <Card><CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold">{month(row.month)}</h2>
                <ReportStatusBadge report={{ status: row.status, latestVersionNumber: row.versionNumber,
                  publishedVersionNumber: row.publishedVersionNumber }} />
              </div>
              <p className="text-xs text-muted-foreground">
                {t('monthly_version', { n: row.versionNumber })}
                {row.publishedAt ? ` · ${t('monthly_published', { date: new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeZone: 'Asia/Hong_Kong' }).format(new Date(row.publishedAt)) })}` : ''}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Signed server-side; the list never builds a share URL it cannot sign. */}
              {row.signedUrl ? <CopyButton value={row.signedUrl} label={t('copy_link')} /> : null}
              <Link href={reportHref(row.month)} className="inline-flex min-h-11 items-center gap-1 rounded-md border border-border px-3 text-sm font-semibold hover:bg-muted">
                {t('open_report')}
                <ExternalLink className="size-4" aria-hidden="true" />
              </Link>
            </div>
          </CardContent></Card>
        </li>
      })}
    </ul>
  )
}
