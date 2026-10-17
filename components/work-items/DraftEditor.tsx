'use client'
import {WorkOperationsPanel} from './WorkOperationsPanel'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { parseDraftEdit } from '@/lib/work-items/edit-input'
import type { WorkItem } from '@/lib/work-items/schema'
import { EvidenceDetails } from '@/components/opportunities/EvidenceDetails'
export function DraftEditor({
  clientId,
  item,
  onSaved,
  onDirtyChange,
  scanId,
}: {
  clientId: string
  item: WorkItem
  onSaved: (item: WorkItem) => void
  onDirtyChange?: (dirty: boolean) => void
  scanId?: string
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
  const lock = useRef(false)
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
    if (lock.current) return
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
      setStatus(t('changesSaved'))
    } catch {
      setError('editError')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  async function reload() {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setStatus('')
    try {
      const response = await fetch(endpoint, { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
      if (!response.ok) throw new Error()
      const next = (await response.json()).item
      if (!next || next.id !== item.id || next.clientId !== clientId) throw new Error()
      accept(next)
      setError('')
      setStatus(t('reloaded'))
    } catch {
      setStatus(t('reloadError'))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const dirty =
    title !== saved.title || action !== saved.action || notes !== saved.notes
  useEffect(() => { onDirtyChange?.(dirty || busy) }, [dirty, busy, onDirtyChange])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
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
      <p aria-live="polite">{t(busy ? 'saving' : dirty ? 'unsavedChanges' : 'savedRevision', { revision: saved.revision })}</p>
      {dirty || busy ? (
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
        </div>
        <p className="text-sm">{t('fieldLimits')}</p>
        {error && <p role="alert">{t(error)}</p>}
        <div className="flex flex-wrap gap-3">
          <button
            className={`${button} bg-primary text-primary-foreground`}
            disabled={busy}
            type="submit"
          >
            {busy ? t('saving') : t('saveChanges')}
          </button>
          {error === 'editConflict' && (
            <button
              type="button"
              disabled={busy}
              className={button}
              onClick={reload}
            >
              {t('reloadDraft')}
            </button>
          )}
        </div>
        <p role="status" aria-live="polite">
          {status}
        </p>
      </form>
      <section className="space-y-2 rounded-lg border border-border p-4">
        <h3 className="font-semibold">{t('manualApplyTitle')}</h3>
        <p>{t('manualApplySteps')}</p>
      </section>
      <WorkOperationsPanel clientId={clientId} itemId={item.id} revision={saved.revision} onRevision={revision=>{const next={...saved,revision};setSaved(next);onSaved(next)}}/>
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
