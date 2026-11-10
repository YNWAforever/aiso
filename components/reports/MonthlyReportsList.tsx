'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { CalendarRange, ExternalLink } from 'lucide-react'

import { CopyButton } from '@/components/ui/copy-button'
import { Card, CardContent } from '@/components/ui/card'
import { ReportStatusBadge } from './ReportStatusBadge'
import type { MonthlyReportListItem } from '@/lib/monthly-report/store'

type MonthlyRow = MonthlyReportListItem & { signedUrl: string | null; canPublish: boolean }

/** The share actions this row offers: publish the latest draft, or withdraw a live share. */
export function monthlyRowActions(row: Pick<MonthlyRow, 'status' | 'versionNumber' | 'publishedVersionNumber'>, canPublish: boolean): ('publish' | 'revoke')[] {
  const latestIsPublished = row.status === 'published' && row.publishedVersionNumber === row.versionNumber
  return [
    ...(canPublish && !latestIsPublished ? ['publish' as const] : []),
    // A past month still offers withdraw: a live link has no age limit and must stay revocable.
    ...(row.status === 'published' ? ['revoke' as const] : []),
  ]
}

/**
 * The monthly reports of one brand on the reports page, newest month first.
 * Each row is a saved monthly version with the actions the report page also
 * offers — publish the latest version, stop sharing a live one — so an operator
 * can manage the deliverable without opening every month. The report page keeps
 * the full editor and the preview.
 */
export function MonthlyReportsList({ lang, clientId, rows }: {
  lang: string
  clientId: string
  rows: MonthlyRow[]
}) {
  const t = useTranslations('reports')
  const router = useRouter()
  const [busyReportId, setBusyReportId] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const month = (key: string) => new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(`${key}-01T00:00:00Z`))
  const reportHref = (key: string) => `/${lang}/dashboard/${clientId}/month/report?m=${encodeURIComponent(key)}`

  const run = async (row: MonthlyRow, action: 'publish' | 'revoke') => {
    setBusyReportId(row.reportId)
    setFailed(false)
    try {
      const res = await fetch(`/api/clients/${clientId}/months/${row.month}/report/${action}`, {
        method: 'POST',
        ...(action === 'publish'
          ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ versionId: row.versionId }) }
          : {}),
      })
      if (!res.ok) throw new Error('monthly report action failed')
      // The row's status and share link are server-rendered, so re-read them
      // rather than claiming a state the page cannot show.
      router.refresh()
    } catch {
      setFailed(true)
    } finally {
      setBusyReportId(null)
    }
  }

  if (rows.length === 0) {
    return <Card><CardContent className="p-8 text-center">
      <CalendarRange className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
      <h2 className="mt-4 text-lg font-semibold">{t('monthly_empty_title')}</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">{t('monthly_empty_body')}</p>
    </CardContent></Card>
  }

  return <>
    {failed ? <p role="alert" className="mb-3 text-sm text-tone-danger-fg">{t('monthly_action_failed')}</p> : null}
    <ul className="space-y-3">
      {rows.map(row => {
        const busy = busyReportId === row.reportId
        const actions = monthlyRowActions(row, row.canPublish)
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
              {actions.map(action => (
                <button
                  key={action}
                  type="button"
                  disabled={busyReportId !== null}
                  aria-busy={busy || undefined}
                  onClick={() => void run(row, action)}
                  className={`inline-flex min-h-11 items-center rounded-md px-3 text-sm font-semibold disabled:opacity-60 ${action === 'publish'
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'border border-border hover:bg-muted'}`}
                >
                  {busy
                    ? (action === 'publish' ? t('monthly_publishing') : t('monthly_revoking'))
                    : (action === 'publish' ? t('monthly_publish') : t('monthly_revoke'))}
                </button>
              ))}
              <Link href={reportHref(row.month)} className="inline-flex min-h-11 items-center gap-1 rounded-md border border-border px-3 text-sm font-semibold hover:bg-muted">
                {t('open_report')}
                <ExternalLink className="size-4" aria-hidden="true" />
              </Link>
            </div>
          </CardContent></Card>
        </li>
      })}
    </ul>
  </>
}
