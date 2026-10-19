'use client'
import {WorkOperationsPanel} from './WorkOperationsPanel'
import { VerificationPreview } from './VerificationPreview'
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { parseDraftEdit } from '@/lib/work-items/edit-input'
import type { WorkItem } from '@/lib/work-items/schema'
import type {
  WorkVerificationBaseline,
  WorkVerificationObservation,
} from '@/lib/work-items/verification'
import { EvidenceDetails } from '@/components/opportunities/EvidenceDetails'
import { useAuthRateLimit } from '@/components/auth/useAuthRateLimit'
export function DraftEditor({
  clientId,
  item,
  onSaved,
  onDirtyChange,
  scanId,
  verificationObservations = [],
}: {
  clientId: string
  item: WorkItem
  onSaved: (item: WorkItem) => void
  onDirtyChange?: (dirty: boolean) => void
  scanId?: string
  verificationObservations?: WorkVerificationObservation[]
}) {
  const lang = useLocale()
  const fieldId = useId()
  const t = useTranslations('opportunities'),
    [saved, setSaved] = useState(item)
  const [title, setTitle] = useState(item.title),
    [action, setAction] = useState(item.action),
    [notes, setNotes] = useState(item.notes)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [status, setStatus] = useState('')
  const [preparationDirty, setPreparationDirty] = useState(false)
  const [operations, setOperations] = useState<{
    operationStatus: 'todo' | 'in_progress' | 'done'
    updatedAt: string
    workNotes: string
    dirty: boolean
  }>({ operationStatus: 'todo', updatedAt: '', workNotes: '', dirty: false })
  const lock = useRef(false)
  const { captureAuthLimit, clearAuthLimit, authWaiting, authNotice } = useAuthRateLimit()
  const onOperationChange = useCallback((value: typeof operations) => setOperations(value), [])
  const endpoint = `/api/clients/${encodeURIComponent(clientId)}/work-items/${encodeURIComponent(item.id)}`
  function accept(next: WorkItem) {
    setSaved(next)
    setTitle(next.title)
    setAction(next.action)
    setNotes(next.notes)
    onSaved(next)
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (lock.current || authWaiting) return
    let input
    try {
      input = parseDraftEdit({
        title,
        action,
        notes,
        expectedRevision: saved.revision,
      })
    } catch {
      setError('invalidEdit')
      return
    }
    lock.current = true
    setBusy(true)
    setError('')
    setStatus('')
    try {
      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(15_000),
      })
      if (await captureAuthLimit(response)) return
      const data = await response.json()
      if (!response.ok) {
        setError(
          response.status === 409
            ? 'editConflict'
            : response.status === 400
              ? 'invalidEdit'
              : 'editError',
        )
        return
      }
      if (!data.item || data.item.id !== item.id || data.item.clientId !== clientId ||
        !Number.isSafeInteger(data.item.revision) || data.item.revision < saved.revision) throw new Error()
      accept(data.item)
      clearAuthLimit()
      setStatus(t('changesSaved'))
    } catch {
      setError('editError')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  async function reload() {
    if (lock.current || authWaiting) return false
    lock.current = true
    setBusy(true)
    setStatus('')
    try {
      const response = await fetch(endpoint, { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
      if (await captureAuthLimit(response)) return false
      if (!response.ok) throw new Error()
      const next = (await response.json()).item
      if (!next || next.id !== item.id || next.clientId !== clientId) throw new Error()
      accept(next)
      clearAuthLimit()
      setError('')
      setStatus(t('reloaded'))
      return true
    } catch {
      setStatus(t('reloadError'))
      return false
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const dirty =
    title !== saved.title || action !== saved.action || notes !== saved.notes
  useEffect(() => { onDirtyChange?.(dirty || busy || preparationDirty) }, [dirty, busy, preparationDirty, onDirtyChange])
  useEffect(() => {
    if (!dirty && !preparationDirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, preparationDirty])
  const field =
    'w-full rounded-lg border border-border bg-background p-3 text-foreground'
  const button =
    'min-h-11 rounded-lg border border-border px-4 py-2 font-semibold disabled:opacity-50'
  return (
    <section
      aria-label={t('savedDraft')}
      className="min-w-0 space-y-5 rounded-xl border border-border bg-card p-4 sm:p-6"
    >
      <h2 className="text-xl font-semibold">{t('savedDraft')}</h2>
      <p>{t('draftOnly')}</p>
      <ReportProvenancePanel clientId={clientId} lang={lang} item={saved} />
      <p aria-live="polite">{t(busy ? 'saving' : dirty ? 'unsavedChanges' : 'savedRevision', { revision: saved.revision })}</p>
      <WorkOperationsPanel clientId={clientId} itemId={item.id} revision={saved.revision} mode="prepare"
        onDirtyChange={setPreparationDirty} onReloadDraft={reload}
        onOperationChange={onOperationChange}
        onRevision={revision=>{const next={...saved,revision};setSaved(next);onSaved(next)}}/>
      {operations.operationStatus === 'done' && !operations.dirty && operations.updatedAt && (
        <VerificationPreview
          baseline={verificationBaseline(saved)}
          reportedAt={operations.updatedAt}
          observations={verificationObservations}
        />
      )}
      {dirty || busy || preparationDirty ? (
        <p>{t('saveBeforeVersions')}</p>
      ) : (
        <a
          className="inline-flex min-h-11 items-center underline"
          href={`/${lang}/dashboard/${encodeURIComponent(clientId)}/work-items/${encodeURIComponent(saved.id)}/versions${scanId ? `?scanId=${encodeURIComponent(scanId)}` : ''}`}
        >
          {t('versionHistory')}
        </a>
      )}
      <p>
        {t('draftLanguage')}:{' '}
        {saved.locale === 'en' ? 'English' : '繁體中文（香港）'}
      </p>
      <p className="text-sm">
        {t('createdAt')}: {saved.createdAt} · {t('updatedAt')}:{' '}
        {saved.updatedAt}
      </p>
      <form onSubmit={save} className="space-y-4" aria-busy={busy}>
        <div className="space-y-2">
          <label className="block" htmlFor={fieldId + '-title'}>
            {t('titleField')}
          </label>
          <input
            className={field}
            id={fieldId + '-title'}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            disabled={busy}
          />
        </div>
        <div className="space-y-2">
          <label className="block" htmlFor={fieldId + '-action'}>
            {t('action')}
          </label>
          <textarea
            className={field}
            rows={5}
            id={fieldId + '-action'}
            value={action}
            onChange={(e) => setAction(e.target.value)}
            required
            disabled={busy}
          />
        </div>
        <div className="space-y-2">
          <label className="block" htmlFor={fieldId + '-notes'}>
            {t('notes')}
          </label>
          <textarea
            className={field}
            rows={5}
            id={fieldId + '-notes'}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={busy}
          />
          <p className="text-xs leading-5 text-muted-foreground">{t('notesHelp')}</p>
        </div>
        <p className="text-sm">{t('fieldLimits')}</p>
        {error && <p role="alert">{t(error)}</p>}
        {authNotice}
        <div className="flex flex-wrap gap-3">
          <button
            className={`${button} bg-primary text-primary-foreground`}
            disabled={busy || authWaiting}
            type="submit"
          >
            {busy ? t('saving') : t('saveChanges')}
          </button>
          {error === 'editConflict' && (
            <button
              type="button"
              disabled={busy || authWaiting}
              className={button}
              onClick={reload}
            >
              {t('reloadDraft')}
            </button>
          )}
        </div>
        <p role="status" aria-label={t('draftSaveStatus')} aria-live="polite">
          {status}
        </p>
      </form>
      <section className="space-y-2 rounded-lg border border-border p-4">
        <h3 className="font-semibold">{t('manualApplyTitle')}</h3>
        <p>{t('manualApplySteps')}</p>
      </section>
      <section className="space-y-3 border-t border-border pt-4">
        <h3 className="font-semibold">{t('savedEvidence')}</h3>
        <p>{t('snapshotNotice')}</p>
        <p className="whitespace-pre-wrap break-words">
          {saved.evidenceSnapshot.initialTitle}
        </p>
        <p className="whitespace-pre-wrap break-words">
          {saved.evidenceSnapshot.initialAction}
        </p>
        <EvidenceDetails
          evidence={saved.evidenceSnapshot.evidence}
          limitations={saved.evidenceSnapshot.limitations}
        />
      </section>
    </section>
  )
}

function verificationBaseline(item: WorkItem): WorkVerificationBaseline {
  const evidence = item.evidenceSnapshot.evidence
  return evidence.kind === 'scan-check'
    ? {
        source: `scan-check:${evidence.checkKey}`,
        observedAt: evidence.recordedAt ?? evidence.collectedAt,
        target: evidence.evaluated.origin,
        issuePresent: true,
      }
    : {
        source: `pulse-metric:${evidence.id}`,
        observedAt: evidence.recordedAt,
        target: null,
        issuePresent: true,
      }
}

function ReportProvenancePanel({
  clientId,
  lang,
  item,
}: {
  clientId: string
  lang: string
  item: WorkItem
}) {
  const t = useTranslations('opportunities')
  const report = item.evidenceSnapshot.reportProvenance
  const [freshness, setFreshness] = useState<{
    state: 'checking' | 'current' | 'newer' | 'unavailable'
    latestVersionNumber: number | null
  }>({ state: 'checking', latestVersionNumber: null })

  useEffect(() => {
    if (!report) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 15_000)
    let active = true
    fetch(`/api/clients/${encodeURIComponent(clientId)}/reports`, {
      cache: 'no-store',
      signal: controller.signal,
    }).then(async response => {
      if (!response.ok) throw new Error()
      const body = await response.json() as { reports?: unknown }
      if (!Array.isArray(body.reports)) throw new Error()
      const row = body.reports.find((value): value is { id: string; latestVersionNumber: number } =>
        Boolean(value && typeof value === 'object'
          && (value as { id?: unknown }).id === report.reportId
          && Number.isSafeInteger((value as { latestVersionNumber?: unknown }).latestVersionNumber)))
      if (!row) throw new Error()
      if (active) setFreshness({
        state: row.latestVersionNumber > report.reportVersionNumber ? 'newer' : 'current',
        latestVersionNumber: row.latestVersionNumber,
      })
    }).catch(() => {
      if (active) setFreshness({ state: 'unavailable', latestVersionNumber: null })
    }).finally(() => window.clearTimeout(timer))
    return () => {
      active = false
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [clientId, report])

  if (!report) return null
  return (
    <section className="space-y-2 rounded-lg border border-border bg-muted/20 p-4" aria-label={t('reportSourceTitle')}>
      <h3 className="font-semibold">{t('reportSourceTitle')}</h3>
      <p data-report-provenance-version={report.reportVersionNumber}>
        {t('reportSourceVersion', { version: report.reportVersionNumber })}
      </p>
      <p className="font-semibold">{report.findingTitle}</p>
      <p className="whitespace-pre-wrap break-words text-sm">{report.findingRationale}</p>
      <p className="text-sm">{t('reportSourcePriority')}: {report.expectedImpact}</p>
      <p className="break-all text-sm">{t('reportSourceTarget')}: {report.targetOrigin ?? t('findingsTargetMissing')}</p>
      <p className="text-sm">{t('reportSourceCitation')}: {report.findingKey}</p>
      {freshness.state === 'newer' && (
        <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            <p>{t('reportSourceNewer', {
              latest: freshness.latestVersionNumber ?? report.reportVersionNumber,
              original: report.reportVersionNumber,
            })}</p>
          <a className="mt-2 inline-flex min-h-11 items-center underline" href={`/${lang}/dashboard/${encodeURIComponent(clientId)}/reports/${encodeURIComponent(report.reportId)}`}>
            {t('reportSourceReview')}
          </a>
        </div>
      )}
      {freshness.state === 'unavailable' && <p className="text-sm">{t('reportSourceFreshnessUnknown')}</p>}
      <a className="inline-flex min-h-11 items-center underline" href={`/${lang}/dashboard/${encodeURIComponent(clientId)}/reports/${encodeURIComponent(report.reportId)}`}>
        {t('reportSourceOpen')}
      </a>
      <p className="text-xs text-muted-foreground">{t('reportSourceFrozen')}</p>
    </section>
  )
}
