'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clipboard,
  ExternalLink,
  Link2,
  Loader2,
  RotateCw,
  Sparkles,
  Unlink,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ClientReportSnapshotV1, ReportStatus } from '@/lib/reports/types'
import { ReportPreview } from './ReportPreview'
import { ReportStatusBadge } from './ReportStatusBadge'

export interface ReportWorkspaceReport {
  id: string
  status: ReportStatus
  latestVersionNumber: number | null
  publishedVersionNumber: number | null
  publishedAt?: string | null
  firstViewedAt?: string | null
  lastViewedAt?: string | null
  viewCount?: number | null
  ctaClickCount?: number | null
  signedUrl?: string
}

type BuilderStep = 'compose' | 'review' | 'publish'
type NoticeKind = 'idle' | 'loading' | 'success' | 'warning' | 'error'
type ReportResponse = {
  report?: ReportWorkspaceReport
  signedUrl?: string
  summary?: string
  error?: string
}

export function hasUnsavedReportChanges(savedSummary: string, currentSummary: string): boolean {
  return savedSummary.trim() !== currentSummary.trim()
}

export function reportPublishConfirmation(
  report: Pick<ReportWorkspaceReport, 'latestVersionNumber' | 'publishedVersionNumber'> | null,
): 'first' | 'update' {
  return report?.publishedVersionNumber ? 'update' : 'first'
}

async function responseBody(response: Response): Promise<ReportResponse> {
  try {
    return await response.json() as ReportResponse
  } catch {
    return {}
  }
}

function withSummary(snapshot: ClientReportSnapshotV1, executiveSummary: string): ClientReportSnapshotV1 {
  return { ...snapshot, executiveSummary }
}

export function ReportBuilder({
  lang,
  clientId,
  scanId,
  initialReport,
  initialSnapshot,
}: {
  lang: 'en' | 'zh-HK'
  clientId: string
  scanId: string
  initialReport: ReportWorkspaceReport | null
  initialSnapshot: ClientReportSnapshotV1
}) {
  const t = useTranslations('reports')
  const [step, setStep] = useState<BuilderStep>('compose')
  const [report, setReport] = useState(initialReport)
  const [summary, setSummary] = useState(initialSnapshot.executiveSummary)
  const [savedSummary, setSavedSummary] = useState(initialSnapshot.executiveSummary)
  const [shareUrl, setShareUrl] = useState(initialReport?.signedUrl ?? '')
  const [notice, setNotice] = useState<{ kind: NoticeKind; text: string }>({ kind: 'idle', text: '' })
  const [pending, setPending] = useState<string | null>(null)
  const dirty = hasUnsavedReportChanges(savedSummary, summary)
  const preview = withSummary(initialSnapshot, summary)

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return
      event.preventDefault()
      event.returnValue = t('unsaved_warning')
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, t])

  async function saveDraft(): Promise<ReportWorkspaceReport | null> {
    if (!dirty && report) return report
    setPending('save')
    setNotice({ kind: 'loading', text: t('saving') })
    const url = report
      ? `/api/client-reports/${encodeURIComponent(report.id)}/versions`
      : `/api/clients/${encodeURIComponent(clientId)}/reports`
    const body = report
      ? { locale: lang, executiveSummary: summary }
      : { scanId, locale: lang, executiveSummary: summary }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await responseBody(response)
      if (!response.ok || !data.report) throw new Error(data.error)
      setReport(data.report)
      setSavedSummary(summary.trim())
      if (data.report.signedUrl) setShareUrl(data.report.signedUrl)
      setNotice({ kind: 'success', text: t('saved') })
      return data.report
    } catch {
      setNotice({ kind: 'error', text: t('save_error') })
      return null
    } finally {
      setPending(null)
    }
  }

  async function polishWithAi() {
    let target = report
    if (!target || dirty) target = await saveDraft()
    if (!target) return

    setPending('ai')
    setNotice({ kind: 'loading', text: t('ai_loading') })
    try {
      const response = await fetch(`/api/client-reports/${encodeURIComponent(target.id)}/ai-summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const data = await responseBody(response)
      if (!response.ok || typeof data.summary !== 'string') throw new Error(data.error)
      setSummary(data.summary)
      setNotice({ kind: 'success', text: t('ai_ready') })
    } catch {
      setNotice({ kind: 'warning', text: t('ai_fallback') })
    } finally {
      setPending(null)
    }
  }

  async function reviewReport() {
    const saved = dirty || !report ? await saveDraft() : report
    if (saved) setStep('review')
  }

  async function publishReport() {
    const saved = dirty || !report ? await saveDraft() : report
    if (!saved) return
    const confirmation = reportPublishConfirmation(saved)
    const confirmed = confirmation === 'first'
      ? confirm(t('confirm_first_publish'))
      : confirm(t('confirm_publish_update'))
    if (!confirmed) return

    setPending('publish')
    setNotice({ kind: 'loading', text: t('publishing') })
    try {
      const response = await fetch(`/api/client-reports/${encodeURIComponent(saved.id)}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const data = await responseBody(response)
      if (!response.ok || !data.report || !data.signedUrl) throw new Error(data.error)
      setReport(data.report)
      setShareUrl(data.signedUrl)
      setNotice({ kind: 'success', text: t('published_success') })
    } catch {
      setNotice({ kind: 'error', text: t('publish_error') })
    } finally {
      setPending(null)
    }
  }

  async function copyLink() {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setNotice({ kind: 'success', text: t('link_copied') })
    } catch {
      setNotice({ kind: 'error', text: t('copy_error') })
    }
  }

  function openLink() {
    if (shareUrl) window.open(shareUrl, '_blank', 'noopener,noreferrer')
  }

  async function rotateLink() {
    if (!report || !confirm(t('confirm_rotate'))) return
    setPending('rotate')
    setNotice({ kind: 'loading', text: t('rotating') })
    try {
      const response = await fetch(`/api/client-reports/${encodeURIComponent(report.id)}/rotate-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const data = await responseBody(response)
      if (!response.ok || !data.report || !data.signedUrl) throw new Error(data.error)
      setReport(data.report)
      setShareUrl(data.signedUrl)
      setNotice({ kind: 'success', text: t('rotated_success') })
    } catch {
      setNotice({ kind: 'error', text: t('rotate_error') })
    } finally {
      setPending(null)
    }
  }

  async function revokeReport() {
    if (!report || !confirm(t('confirm_revoke'))) return
    setPending('revoke')
    setNotice({ kind: 'loading', text: t('revoking') })
    try {
      const response = await fetch(`/api/client-reports/${encodeURIComponent(report.id)}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const data = await responseBody(response)
      if (!response.ok || !data.report) throw new Error(data.error)
      setReport(data.report)
      setShareUrl('')
      setNotice({ kind: 'success', text: t('revoked_success') })
    } catch {
      setNotice({ kind: 'error', text: t('revoke_error') })
    } finally {
      setPending(null)
    }
  }

  const steps: Array<{ key: BuilderStep; label: string }> = [
    { key: 'compose', label: t('step_compose') },
    { key: 'review', label: t('step_review') },
    { key: 'publish', label: t('step_publish') },
  ]

  return (
    <div className="space-y-6">
      <nav aria-label={t('progress_label')} className="overflow-x-auto">
        <ol className="grid min-w-[32rem] grid-cols-3 gap-2">
          {steps.map((item, index) => (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => setStep(item.key)}
                aria-current={step === item.key ? 'step' : undefined}
                className="min-h-11 w-full rounded-lg border border-border px-4 py-2 text-left text-sm font-semibold transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="mr-2 text-muted-foreground">{index + 1}</span>
                {item.label}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div aria-live="polite" className="min-h-6 text-sm" data-notice-kind={notice.kind}>
        {notice.text}
      </div>

      {step === 'compose' && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>{t('compose_title')}</CardTitle>
              {report && <ReportStatusBadge report={report} />}
            </div>
            <p className="text-sm text-muted-foreground">
              {t('scan_identity', { client: initialSnapshot.client.name, domain: initialSnapshot.client.domain })}
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('agency_branding')}</p>
              <p className="mt-2 font-medium">{initialSnapshot.branding.agencyName}</p>
              <p className="text-sm text-muted-foreground">{initialSnapshot.branding.attribution}</p>
            </div>

            <div>
              <label htmlFor="report-executive-summary" className="text-sm font-semibold">
                {t('executive_summary')}
              </label>
              <p id="report-summary-help" className="mt-1 text-sm text-muted-foreground">
                {t('summary_help')}
              </p>
              <textarea
                id="report-executive-summary"
                value={summary}
                onChange={event => setSummary(event.target.value)}
                aria-describedby="report-summary-help"
                minLength={40}
                maxLength={1200}
                className="mt-3 min-h-40 w-full resize-y rounded-lg border border-border bg-background px-3 py-3 text-base leading-6 text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <div className="mt-3 flex flex-wrap gap-3">
                <Button type="button" variant="secondary" className="min-h-11" onClick={polishWithAi} disabled={pending !== null}>
                  {pending === 'ai' ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
                  {pending === 'ai' ? t('ai_loading') : t('polish_ai')}
                </Button>
                <Button type="button" variant="outline" className="min-h-11" onClick={saveDraft} disabled={pending !== null || (!dirty && report !== null)}>
                  {pending === 'save' ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Check aria-hidden="true" />}
                  {pending === 'save' ? t('saving') : t('save_draft')}
                </Button>
              </div>
            </div>

            <div className="flex justify-end">
              <Button type="button" className="min-h-11" onClick={reviewReport} disabled={pending !== null}>
                {t('review_report')}
                <ArrowRight aria-hidden="true" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'review' && (
        <div className="space-y-5">
          <ReportPreview snapshot={preview} />
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setStep('compose')}>
              <ArrowLeft aria-hidden="true" />
              {t('back_to_compose')}
            </Button>
            <Button type="button" className="min-h-11" onClick={() => setStep('publish')}>
              {t('continue_publish')}
              <ArrowRight aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}

      {step === 'publish' && (
        <Card>
          <CardHeader>
            <CardTitle>{t('publish_title')}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {report?.publishedVersionNumber ? t('publish_update_body') : t('publish_first_body')}
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            <Button type="button" className="min-h-11" onClick={publishReport} disabled={pending !== null}>
              {pending === 'publish' ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Link2 aria-hidden="true" />}
              {pending === 'publish' ? t('publishing') : report?.publishedVersionNumber ? t('publish_update') : t('publish_first')}
            </Button>

            {shareUrl && (
              <div className="rounded-xl border border-border bg-muted/20 p-4">
                <p className="break-all text-sm text-muted-foreground">{shareUrl}</p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Button type="button" variant="outline" className="min-h-11" onClick={copyLink}>
                    <Clipboard aria-hidden="true" />
                    {t('copy_link')}
                  </Button>
                  <Button type="button" variant="outline" className="min-h-11" onClick={openLink}>
                    <ExternalLink aria-hidden="true" />
                    {t('open_link')}
                  </Button>
                </div>
              </div>
            )}

            {report?.status === 'published' && (
              <div className="flex flex-wrap gap-3 border-t border-border pt-5">
                <Button type="button" variant="outline" className="min-h-11" onClick={rotateLink} disabled={pending !== null}>
                  <RotateCw aria-hidden="true" />
                  {t('rotate_link')}
                </Button>
                <Button type="button" variant="destructive" className="min-h-11" onClick={revokeReport} disabled={pending !== null}>
                  <Unlink aria-hidden="true" />
                  {t('revoke_report')}
                </Button>
              </div>
            )}

            <Button type="button" variant="outline" className="min-h-11" onClick={() => setStep('review')}>
              <ArrowLeft aria-hidden="true" />
              {t('back_to_review')}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
