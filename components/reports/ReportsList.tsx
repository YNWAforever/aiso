'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import {
  Clipboard,
  ExternalLink,
  FilePenLine,
  RotateCw,
  Unlink,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { ReportStatus } from '@/lib/reports/types'
import { ReportStatusBadge } from './ReportStatusBadge'

export interface ReportsListItem {
  id: string
  status: ReportStatus
  latestVersionNumber: number | null
  publishedVersionNumber: number | null
  publishedAt: string | null
  firstViewedAt: string | null
  lastViewedAt: string | null
  viewCount: number | null
  ctaClickCount: number | null
  metricsUnavailable?: boolean
  signedUrl?: string
}

function updateItem(items: ReportsListItem[], next: ReportsListItem): ReportsListItem[] {
  return items.map(item => item.id === next.id ? { ...item, ...next } : item)
}

export function ReportsList({
  lang,
  clientId,
  clientName,
  domain,
  reports: initialReports,
}: {
  lang: string
  clientId: string
  clientName: string
  domain: string
  reports: ReportsListItem[]
}) {
  const t = useTranslations('reports')
  const [reports, setReports] = useState(initialReports)
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const dateFormatter = new Intl.DateTimeFormat(lang, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  const formatDate = (value: string | null) =>
    value ? dateFormatter.format(new Date(value)) : t('not_yet')
  const metric = (value: number | null, unavailable?: boolean) =>
    unavailable || value === null ? t('unavailable') : new Intl.NumberFormat(lang).format(value)

  async function copyLink(report: ReportsListItem) {
    if (!report.signedUrl) return
    try {
      await navigator.clipboard.writeText(report.signedUrl)
      setNotice(t('link_copied'))
    } catch {
      setNotice(t('copy_error'))
    }
  }

  function openReport(report: ReportsListItem) {
    if (report.signedUrl) window.open(report.signedUrl, '_blank', 'noopener,noreferrer')
  }

  async function lifecycle(report: ReportsListItem, action: 'rotate-link' | 'revoke') {
    const confirmed = action === 'rotate-link'
      ? confirm(t('confirm_rotate'))
      : confirm(t('confirm_revoke'))
    if (!confirmed) return
    setPending(`${report.id}:${action}`)
    setNotice(action === 'rotate-link' ? t('rotating') : t('revoking'))
    try {
      const response = await fetch(`/api/client-reports/${encodeURIComponent(report.id)}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const body = await response.json() as {
        report?: ReportsListItem
        signedUrl?: string
      }
      if (!response.ok || !body.report) throw new Error('request failed')
      setReports(current => updateItem(current, {
        ...report,
        ...body.report,
        signedUrl: action === 'rotate-link' ? body.signedUrl : undefined,
      }))
      setNotice(action === 'rotate-link' ? t('rotated_success') : t('revoked_success'))
    } catch {
      setNotice(action === 'rotate-link' ? t('rotate_error') : t('revoke_error'))
    } finally {
      setPending(null)
    }
  }

  if (!reports.length) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <h2 className="text-lg font-semibold">{t('empty_title')}</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">{t('empty_body')}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div aria-live="polite" className="min-h-6 text-sm">{notice}</div>
      <ul className="grid gap-4">
        {reports.map(report => (
          <li key={report.id}>
            <Card>
              <CardContent className="p-5 sm:p-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="font-semibold">{clientName}</h2>
                      <ReportStatusBadge report={report} />
                    </div>
                    <p className="mt-1 break-all text-sm text-muted-foreground">{domain}</p>
                    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
                      <span>{t('latest_version', { version: report.latestVersionNumber ?? t('unavailable') })}</span>
                      <span>{t('published_version', { version: report.publishedVersionNumber ?? t('not_yet') })}</span>
                      <span>{t('published_date', { date: formatDate(report.publishedAt) })}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {report.signedUrl && (
                      <>
                        <Button type="button" variant="outline" className="min-h-11" onClick={() => openReport(report)}>
                          <ExternalLink aria-hidden="true" />
                          {t('open_report')}
                        </Button>
                        <Button type="button" variant="outline" className="min-h-11" onClick={() => copyLink(report)}>
                          <Clipboard aria-hidden="true" />
                          {t('copy_link')}
                        </Button>
                      </>
                    )}
                    <Button asChild variant="outline" className="min-h-11">
                      <Link href={`/${lang}/dashboard/${clientId}/reports/${report.id}`}>
                        <FilePenLine aria-hidden="true" />
                        {t('edit_report')}
                      </Link>
                    </Button>
                  </div>
                </div>

                <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-5 sm:grid-cols-4">
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground">{t('views')}</dt>
                    <dd className="mt-1 font-semibold tabular-nums">{metric(report.viewCount, report.metricsUnavailable)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground">{t('cta_clicks')}</dt>
                    <dd className="mt-1 font-semibold tabular-nums">{metric(report.ctaClickCount, report.metricsUnavailable)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground">{t('first_view')}</dt>
                    <dd className="mt-1 text-sm">{report.metricsUnavailable ? t('unavailable') : formatDate(report.firstViewedAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground">{t('last_view')}</dt>
                    <dd className="mt-1 text-sm">{report.metricsUnavailable ? t('unavailable') : formatDate(report.lastViewedAt)}</dd>
                  </div>
                </dl>

                {report.status === 'published' && (
                  <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-5">
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11"
                      onClick={() => lifecycle(report, 'rotate-link')}
                      disabled={pending !== null}
                    >
                      <RotateCw aria-hidden="true" />
                      {t('rotate_link')}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      className="min-h-11"
                      onClick={() => lifecycle(report, 'revoke')}
                      disabled={pending !== null}
                    >
                      <Unlink aria-hidden="true" />
                      {t('revoke_report')}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  )
}
