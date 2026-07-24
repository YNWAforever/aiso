'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
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
import {
  dashboardReportAssetUrls,
  parseAiSummaryResponse,
  parseReportLifecycleResponse,
  parseReportSaveResponse,
  type ReportReviewArtifact,
  type ReportSaveResponse,
  type ReportWorkspaceReport,
} from '@/lib/reports/client-dto'
import { installReportNavigationBlocker } from '@/lib/reports/navigation-blocker'
import type { ClientReportSnapshotV1 } from '@/lib/reports/types'
import { ReportPreview } from './ReportPreview'
import { ReportStatusBadge } from './ReportStatusBadge'

export type { ReportWorkspaceReport } from '@/lib/reports/client-dto'
export { installReportNavigationBlocker } from '@/lib/reports/navigation-blocker'

type BuilderStep = 'compose' | 'review' | 'publish'
type NoticeKind = 'idle' | 'loading' | 'success' | 'warning' | 'error'

export function hasUnsavedReportChanges(savedSummary: string, currentSummary: string): boolean {
  return savedSummary !== currentSummary
}

export function reportPublishConfirmation(
  report: Pick<ReportWorkspaceReport, 'latestVersionNumber' | 'publishedVersionNumber'> | null,
): 'first' | 'update' {
  return report?.publishedVersionNumber ? 'update' : 'first'
}

async function responseBody(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

export function shouldApplyAiSummary(input: {
  startingSummary: string
  currentSummary: string
  startingRevision: number
  currentRevision: number
}): boolean {
  return input.startingRevision === input.currentRevision
    && input.startingSummary === input.currentSummary
}

export function ReportBuilder({
  lang,
  clientId,
  scanId,
  initialReport,
  initialSnapshot,
  initialReviewArtifact = null,
}: {
  lang: 'en' | 'zh-HK'
  clientId: string
  scanId: string
  initialReport: ReportWorkspaceReport | null
  initialSnapshot: ClientReportSnapshotV1
  initialReviewArtifact?: ReportReviewArtifact | null
}) {
  const t = useTranslations('reports')
  const [step, setStep] = useState<BuilderStep>('compose')
  const [report, setReport] = useState(initialReport)
  const [summary, setSummary] = useState(initialSnapshot.executiveSummary)
  const [savedSummary, setSavedSummary] = useState(initialSnapshot.executiveSummary)
  const [savedArtifact, setSavedArtifact] = useState<ReportReviewArtifact | null>(initialReviewArtifact)
  const [reviewedArtifact, setReviewedArtifact] = useState<ReportReviewArtifact | null>(null)
  const [shareUrl, setShareUrl] = useState(initialReport?.signedUrl ?? '')
  const [notice, setNotice] = useState<{ kind: NoticeKind; text: string }>({ kind: 'idle', text: '' })
  const [pending, setPending] = useState<string | null>(null)
  const summaryRef = useRef(initialSnapshot.executiveSummary)
  const revisionRef = useRef(0)
  const allowUnloadRef = useRef(false)
  const dirty = hasUnsavedReportChanges(savedSummary, summary)

  useEffect(() => {
    let rearmUnloadGuardTimeout: number | null = null
    const restoreUnloadGuard = () => {
      if (rearmUnloadGuardTimeout !== null) {
        window.clearTimeout(rearmUnloadGuardTimeout)
        rearmUnloadGuardTimeout = null
      }
      allowUnloadRef.current = false
    }
    const prepareFailOpen = () => {
      allowUnloadRef.current = true
      rearmUnloadGuardTimeout = window.setTimeout(() => {
        rearmUnloadGuardTimeout = null
        allowUnloadRef.current = false
      }, 1_000)
      return restoreUnloadGuard
    }
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty || allowUnloadRef.current) return
      event.preventDefault()
      event.returnValue = t('unsaved_warning')
    }
    const guardSameAppNavigation = (event: MouseEvent) => {
      if (!dirty
        || event.defaultPrevented
        || event.button !== 0
        || event.metaKey
        || event.ctrlKey
        || event.shiftKey
        || event.altKey) return
      const target = event.target instanceof Element ? event.target : null
      const anchor = target?.closest<HTMLAnchorElement>('a[href]')
      if (!anchor
        || anchor.dataset.reportGuarded === 'true'
        || anchor.target === '_blank'
        || anchor.hasAttribute('download')) return
      const destination = new URL(anchor.href, window.location.href)
      if (destination.origin !== window.location.origin
        || destination.href === window.location.href
        || window.confirm(t('unsaved_warning'))) return
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('beforeunload', warn)
    const removeReportNavigationBlocker = installReportNavigationBlocker({
      browser: window,
      shouldBlock: () => dirty,
      confirmLeave: () => window.confirm(t('unsaved_warning')),
      prepareFailOpen,
    })
    document.addEventListener('click', guardSameAppNavigation, true)
    return () => {
      window.removeEventListener('beforeunload', warn)
      removeReportNavigationBlocker()
      document.removeEventListener('click', guardSameAppNavigation, true)
      restoreUnloadGuard()
    }
  }, [dirty, t])

  function updateSummary(value: string) {
    summaryRef.current = value
    revisionRef.current += 1
    setSummary(value)
    setReviewedArtifact(null)
  }

  function returnToCompose() {
    setReviewedArtifact(null)
    setStep('compose')
  }

  function guardBackToReports(event: { preventDefault(): void }) {
    if (dirty && !window.confirm(t('unsaved_warning'))) event.preventDefault()
  }

  async function saveDraft(): Promise<ReportSaveResponse | null> {
    if (!dirty && report && savedArtifact) {
      return { report, reviewArtifact: savedArtifact }
    }
    const requestSummary = summaryRef.current
    const startingRevision = revisionRef.current
    setPending('save')
    setNotice({ kind: 'loading', text: t('saving') })
    const url = report
      ? `/api/client-reports/${encodeURIComponent(report.id)}/versions`
      : `/api/clients/${encodeURIComponent(clientId)}/reports`
    const body = report
      ? { locale: lang, executiveSummary: requestSummary }
      : { scanId, locale: lang, executiveSummary: requestSummary }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = parseReportSaveResponse(await responseBody(response))
      if (!response.ok || !data) throw new Error('Invalid report save response')
      setReport(data.report)
      setSavedArtifact(data.reviewArtifact)
      setSavedSummary(data.reviewArtifact.snapshot.executiveSummary)
      if (data.report.signedUrl) setShareUrl(data.report.signedUrl)
      if (shouldApplyAiSummary({
        startingSummary: requestSummary,
        currentSummary: summaryRef.current,
        startingRevision,
        currentRevision: revisionRef.current,
      })) {
        summaryRef.current = data.reviewArtifact.snapshot.executiveSummary
        setSummary(data.reviewArtifact.snapshot.executiveSummary)
      }
      setNotice({ kind: 'success', text: t('saved') })
      return data
    } catch {
      setNotice({ kind: 'error', text: t('save_error') })
      return null
    } finally {
      setPending(null)
    }
  }

  async function polishWithAi() {
    const startingSummary = summaryRef.current
    const startingRevision = revisionRef.current
    let target = report
    if (!target || dirty || !savedArtifact) {
      const saved = await saveDraft()
      target = saved?.report ?? null
    }
    if (!target) return

    setPending('ai')
    setNotice({ kind: 'loading', text: t('ai_loading') })
    try {
      const response = await fetch(`/api/client-reports/${encodeURIComponent(target.id)}/ai-summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const data = parseAiSummaryResponse(await responseBody(response))
      if (!response.ok || !data) throw new Error('Invalid AI summary response')
      if (!shouldApplyAiSummary({
        startingSummary,
        currentSummary: summaryRef.current,
        startingRevision,
        currentRevision: revisionRef.current,
      })) {
        setNotice({ kind: 'warning', text: t('ai_preserved') })
        return
      }
      updateSummary(data.summary)
      setNotice({ kind: 'success', text: t('ai_ready') })
    } catch {
      setNotice({ kind: 'warning', text: t('ai_fallback') })
    } finally {
      setPending(null)
    }
  }

  async function reviewReport() {
    const saved = dirty || !report || !savedArtifact
      ? await saveDraft()
      : { report, reviewArtifact: savedArtifact }
    if (!saved) return
    if (summaryRef.current !== saved.reviewArtifact.snapshot.executiveSummary) {
      setNotice({ kind: 'warning', text: t('save_again') })
      return
    }
    setReviewedArtifact(saved.reviewArtifact)
    setStep('review')
  }

  async function publishReport() {
    if (!report
      || !reviewedArtifact
      || report.latestVersionNumber !== reviewedArtifact.versionNumber) {
      setReviewedArtifact(null)
      setNotice({ kind: 'warning', text: t('save_again') })
      setStep('compose')
      return
    }
    const confirmation = reportPublishConfirmation(report)
    const confirmed = confirmation === 'first'
      ? window.confirm(t('confirm_first_publish'))
      : window.confirm(t('confirm_publish_update'))
    if (!confirmed) return

    setPending('publish')
    setNotice({ kind: 'loading', text: t('publishing') })
    try {
      const response = await fetch(`/api/client-reports/${encodeURIComponent(report.id)}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewedVersionId: reviewedArtifact.versionId }),
      })
      const data = parseReportLifecycleResponse(await responseBody(response), true)
      if (!response.ok || !data?.signedUrl) throw new Error('Invalid publish response')
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
    if (!report || !window.confirm(t('confirm_rotate'))) return
    setPending('rotate')
    setNotice({ kind: 'loading', text: t('rotating') })
    try {
      const response = await fetch(`/api/client-reports/${encodeURIComponent(report.id)}/rotate-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const data = parseReportLifecycleResponse(await responseBody(response), true)
      if (!response.ok || !data?.signedUrl) throw new Error('Invalid rotate response')
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
    if (!report || !window.confirm(t('confirm_revoke'))) return
    setPending('revoke')
    setNotice({ kind: 'loading', text: t('revoking') })
    try {
      const response = await fetch(`/api/client-reports/${encodeURIComponent(report.id)}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const data = parseReportLifecycleResponse(await responseBody(response), false)
      if (!response.ok || !data) throw new Error('Invalid revoke response')
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
  const previewAssets = report && reviewedArtifact
    ? dashboardReportAssetUrls(report.id, reviewedArtifact.versionId)
    : null

  return (
    <div className="space-y-6">
      <Link
        href={`/${lang}/dashboard/${encodeURIComponent(clientId)}/reports`}
        data-report-guarded="true"
        onNavigate={guardBackToReports}
        className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft aria-hidden="true" />
        {t('back_to_reports')}
      </Link>

      <nav aria-label={t('progress_label')} className="overflow-x-auto">
        <ol className="grid min-w-[32rem] grid-cols-3 gap-2">
          {steps.map((item, index) => {
            const isDisabled = item.key === 'publish' && (step === 'compose' || !reviewedArtifact)
            return (
              <li key={item.key}>
                <button
                  type="button"
                  onClick={() => {
                    if (item.key === 'compose') returnToCompose()
                    else if (item.key === 'review') {
                      if (step === 'compose') void reviewReport()
                      else setStep('review')
                    } else if (step === 'review' && reviewedArtifact) setStep('publish')
                  }}
                  aria-current={step === item.key ? 'step' : undefined}
                  aria-disabled={isDisabled || undefined}
                  disabled={isDisabled}
                  className="min-h-11 w-full rounded-lg border border-border px-4 py-2 text-left text-sm font-semibold transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="mr-2 text-muted-foreground">{index + 1}</span>
                  {item.label}
                </button>
              </li>
            )
          })}
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
                onChange={event => updateSummary(event.target.value)}
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
                <Button type="button" variant="outline" className="min-h-11" onClick={saveDraft} disabled={pending !== null || (!dirty && report !== null && savedArtifact !== null)}>
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

      {step === 'review' && reviewedArtifact && (
        <div className="space-y-5">
          <ReportPreview
            snapshot={reviewedArtifact.snapshot}
            logoProxyUrl={previewAssets?.logoProxyUrl}
            contactProxyUrl={previewAssets?.contactProxyUrl}
          />
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
            <Button type="button" variant="outline" className="min-h-11" onClick={returnToCompose}>
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

      {step === 'publish' && reviewedArtifact && (
        <Card>
          <CardHeader>
            <CardTitle>{t('publish_title')}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {report?.publishedVersionNumber ? t('publish_update_body') : t('publish_first_body')}
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            <Button type="button" className="min-h-11" onClick={publishReport} disabled={pending !== null || !reviewedArtifact}>
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
