'use client'
import {WorkOperationsPanel} from './WorkOperationsPanel'
import { useId, useRef, useState, type FormEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { parseDraftEdit } from '@/lib/work-items/edit-input'
import { EDIT_SPEC_DESCRIPTION_MAX, EDIT_SPEC_SCHEMA_TYPES, EDIT_SPEC_TITLE_MAX, type EditSpecSchemaType } from '@/lib/site-edit/edit-spec'
import { specDirty as isSpecDirty, specFields, specRequest, type SpecFields, type SpecMode } from '@/lib/site-edit/editor'
import type { WorkItem } from '@/lib/work-items/schema'
import { EvidenceDetails } from '@/components/opportunities/EvidenceDetails'
export function DraftEditor({
  clientId,
  item,
  onSaved,
  smeCopilot = false,
}: {
  clientId: string
  item: WorkItem
  onSaved: (item: WorkItem) => void
  smeCopilot?: boolean
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
  // Site-edit S1: one optional edit, saved with the draft and frozen into its review version.
  // A JSON-LD block (S5: or its revert), or — S9 — the page's title and/or meta description.
  const [spec, setSpecState] = useState<SpecFields>(() => specFields(item.editSpec))
  const setSpec = (patch: Partial<SpecFields>) => setSpecState(current => ({ ...current, ...patch }))
  const endpoint = `/api/clients/${encodeURIComponent(clientId)}/work-items/${encodeURIComponent(item.id)}`
  function accept(next: WorkItem) {
    setSaved(next)
    setTitle(next.title)
    setAction(next.action)
    setNotes(next.notes)
    setSpecState(specFields(next.editSpec))
    onSaved(next)
  }
  const specDirty = isSpecDirty(spec, saved.editSpec)
  async function save(event: FormEvent) {
    event.preventDefault()
    if (lock.current) return
    const textInput = { title, action, notes, expectedRevision: saved.revision }
    let input
    try {
      // Text first, so a bad title is reported as a text error even with a spec ticked.
      input = parseDraftEdit(textInput)
    } catch {
      setError('invalidEdit')
      return
    }
    try {
      const editSpec = specRequest(spec, saved.editSpec)
      if (editSpec !== undefined) input = parseDraftEdit({ ...textInput, editSpec })
    } catch {
      setError('invalidEditSpec')
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
      })
      const data = await response.json()
      if (!response.ok) {
        if (data?.error === 'EDIT_SPEC_DOMAIN_UNVERIFIED') return setError('editSpecUnverified')
        if (data?.error === 'EDIT_SPEC_DOMAIN_MISMATCH') return setError('editSpecMismatch')
        if (data?.error === 'EDIT_SPEC_REVERT_UNMATCHED') return setError('editSpecRevertUnmatched')
        setError(
          response.status === 409
            ? 'editConflict'
            : response.status === 400
              ? 'invalidEdit'
              : 'editError',
        )
        return
      }
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
      const response = await fetch(endpoint, { cache: 'no-store' })
      if (!response.ok) throw new Error()
      accept((await response.json()).item)
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
    title !== saved.title || action !== saved.action || notes !== saved.notes || specDirty
  const field =
    'w-full rounded-lg border border-border bg-background p-3 text-foreground'
  const button =
    'min-h-11 rounded-lg border border-border px-4 py-2 font-semibold disabled:opacity-50'
  const reviewNavigation = dirty || busy ? (
    <p>{t('saveBeforeVersions')}</p>
  ) : (
    <a className={smeCopilot ? `${button} inline-flex items-center bg-primary text-primary-foreground` : 'inline-flex min-h-11 items-center underline'}
      href={`/${lang}/dashboard/${encodeURIComponent(clientId)}/work-items/${encodeURIComponent(saved.id)}/versions`}>
      {t(smeCopilot ? 'sme.prepareReview' : 'versionHistory')}
    </a>
  )
  const savedEvidence = <>
    <p>{t('snapshotNotice')}</p>
    <p className="whitespace-pre-wrap break-words">{saved.evidenceSnapshot.initialTitle}</p>
    <p className="whitespace-pre-wrap break-words">{saved.evidenceSnapshot.initialAction}</p>
    <EvidenceDetails evidence={saved.evidenceSnapshot.evidence} limitations={saved.evidenceSnapshot.limitations} />
  </>
  const recordingDetails = <>
    <p>{t('draftLanguage')}: {saved.locale === 'en' ? 'English' : '繁體中文（香港）'}</p>
    <p className="text-sm">{t('createdAt')}: {saved.createdAt} · {t('updatedAt')}: {saved.updatedAt}</p>
  </>
  return (
    <section
      aria-label={t('savedDraft')}
      className="min-w-0 space-y-5 rounded-xl border border-border bg-card p-4 sm:p-6"
    >
      <h2 className="text-xl font-semibold">{t(smeCopilot ? 'sme.editDraft' : 'savedDraft')}</h2>
      <p>{t('draftOnly')}</p>
      {smeCopilot && <div className="space-y-2 text-sm text-muted-foreground">
        <p>{t(saved.evidenceSnapshot.evidence.kind === 'pulse-metric' ? 'pulseUnknowns' : 'redacted')}</p>
        {saved.evidenceSnapshot.evidence.kind === 'scan-check' && saved.evidenceSnapshot.evidence.limited && <p>{t('limitedScan')}</p>}
      </div>}
      {!smeCopilot && <>{reviewNavigation}{recordingDetails}</>}
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
        <details className="space-y-3 rounded-lg border border-border p-3" open={spec.on}>
          <summary className="min-h-11 cursor-pointer font-semibold">{t('editSpecTitle')}</summary>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" checked={spec.on} disabled={busy} onChange={(e) => setSpec({ on: e.target.checked })} />
            {t('editSpecInclude')}
          </label>
          {spec.on && <>
            <div className="space-y-2">
              <label className="block" htmlFor={fieldId + '-spec-mode'}>{t('editSpecMode')}</label>
              <select className={field} id={fieldId + '-spec-mode'} value={spec.mode ?? 'jsonld'} disabled={busy}
                onChange={(e) => setSpec({ mode: e.target.value as SpecMode })}>
                <option value="jsonld">{t('editSpecModeJsonld')}</option>
                <option value="meta">{t('editSpecModeMeta')}</option>
                <option value="llms_txt">{t('editSpecModeLlmsTxt')}</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="block" htmlFor={fieldId + '-spec-url'}>{t('editSpecUrl')}</label>
              <input className={field} id={fieldId + '-spec-url'} type="url" inputMode="url" value={spec.url} disabled={busy}
                onChange={(e) => setSpec({ url: e.target.value })} />
            </div>
            {spec.mode === 'llms_txt' ? <>
              <div className="space-y-2">
                <label className="block" htmlFor={fieldId + '-spec-content'}>{t('editSpecLlmsTxt')}</label>
                <textarea className={`${field} font-mono text-sm`} rows={12} id={fieldId + '-spec-content'} value={spec.content ?? ''}
                  disabled={busy} spellCheck={false} onChange={(e) => setSpec({ content: e.target.value })} />
              </div>
              <p className="text-sm">{t('editSpecLlmsTxtRules')}</p>
            </> : spec.mode === 'meta' ? <>
              <div className="space-y-2">
                <label className="block" htmlFor={fieldId + '-spec-title'}>{t('editSpecPageTitle')}</label>
                <input className={field} id={fieldId + '-spec-title'} value={spec.title ?? ''} maxLength={EDIT_SPEC_TITLE_MAX} disabled={busy}
                  onChange={(e) => setSpec({ title: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="block" htmlFor={fieldId + '-spec-description'}>{t('editSpecDescription')}</label>
                <textarea className={field} rows={3} id={fieldId + '-spec-description'} value={spec.description ?? ''}
                  maxLength={EDIT_SPEC_DESCRIPTION_MAX} disabled={busy} onChange={(e) => setSpec({ description: e.target.value })} />
              </div>
              <p className="text-sm">{t('editSpecMetaRules')}</p>
            </> : <>
              <label className="flex min-h-11 items-center gap-2">
                <input type="checkbox" checked={Boolean(spec.remove)} disabled={busy} onChange={(e) => setSpec({ remove: e.target.checked })} />
                {t('editSpecRemove')}
              </label>
              <div className="space-y-2">
                <label className="block" htmlFor={fieldId + '-spec-type'}>{t('editSpecType')}</label>
                <select className={field} id={fieldId + '-spec-type'} value={spec.type} disabled={busy}
                  onChange={(e) => setSpec({ type: e.target.value as EditSpecSchemaType })}>
                  {EDIT_SPEC_SCHEMA_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="block" htmlFor={fieldId + '-spec-payload'}>{t('editSpecPayload')}</label>
                <textarea className={`${field} font-mono text-sm`} rows={10} id={fieldId + '-spec-payload'} value={spec.payload}
                  disabled={busy} spellCheck={false} onChange={(e) => setSpec({ payload: e.target.value })} />
              </div>
              <p className="text-sm">{t('editSpecRules')}</p>
            </>}
          </>}
        </details>
        {error && <p role="alert">{t(error)}</p>}
        <div className="flex flex-wrap gap-3">
          <button
            className={`${button} ${!smeCopilot || dirty ? 'bg-primary text-primary-foreground' : ''}`}
            disabled={busy || (smeCopilot && !dirty)}
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
      {smeCopilot && <div>{reviewNavigation}</div>}
      <WorkOperationsPanel clientId={clientId} itemId={item.id} revision={saved.revision} onRevision={revision=>{const next={...saved,revision};setSaved(next);onSaved(next)}}/>
      {smeCopilot ? <>
        <details className="space-y-3 border-t border-border pt-4">
          <summary className="min-h-11 cursor-pointer font-semibold">{t('savedEvidence')}</summary>
          {savedEvidence}
        </details>
        <details className="space-y-3 border-t border-border pt-4">
          <summary className="min-h-11 cursor-pointer font-semibold">{t('sme.recordingDetails')}</summary>
          {recordingDetails}
        </details>
      </> : <section className="space-y-3 border-t border-border pt-4">
        <h3 className="font-semibold">{t('savedEvidence')}</h3>
        {savedEvidence}
      </section>}
    </section>
  )
}
