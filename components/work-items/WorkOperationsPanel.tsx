'use client'
import { useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { parseWorkOperations, type WorkOperations } from '@/lib/work-items/operations-input'

type Plan = WorkOperations & {
  owners: { id: string; display_name: string | null }[]
  groupScope: { context?: { runId: string } } | null
  evidence: unknown[]
}
const operationFields = (plan: Plan) => JSON.stringify([
  plan.targetUrl, plan.ownerId, plan.dueAt, plan.acceptanceCriteria, plan.operationStatus,
])

export function WorkOperationsPanel({
  clientId, itemId, revision, onRevision, onDirtyChange, onReloadDraft, mode = 'details',
}: {
  clientId: string
  itemId: string
  revision: number
  onRevision?: (revision: number) => void
  onDirtyChange?: (dirty: boolean) => void
  onReloadDraft?: () => Promise<boolean>
  mode?: 'details' | 'prepare' | 'review'
}) {
  const t = useTranslations('opportunities'), lang = useLocale()
  const [open, setOpen] = useState(false), [reload, setReload] = useState(0)
  const [plan, setPlan] = useState<Plan | null>(null), [error, setError] = useState('')
  const [readError, setReadError] = useState(false), [status, setStatus] = useState('')
  const [savedSignature, setSavedSignature] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [retest, setRetest] = useState<{ id: string; week: string } | null>(null)
  const [comparison, setComparison] = useState<{ comparable: boolean; delta: number | null; reasons: string[] } | null>(null)
  const pending = useRef(false), intent = useRef<{ key: string; value: string } | null>(null)
  const persisted = useRef<string | null>(null), planRef = useRef<Plan | null>(null)
  const endpoint = `/api/clients/${encodeURIComponent(clientId)}/work-items/${encodeURIComponent(itemId)}/operations`
  const preparing = mode !== 'details', readOnly = mode === 'review'
  const dirty = Boolean(plan && savedSignature && operationFields(plan) !== operationFields(JSON.parse(savedSignature)))
  useEffect(() => { planRef.current = plan }, [plan])
  useEffect(() => { onDirtyChange?.(dirty || busy) }, [dirty, busy, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])
  useEffect(() => {
    if (!preparing && !open) return
    const controller = new AbortController()
    fetch(endpoint, { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
      .then(async response => {
        if (!response.ok) throw new Error()
        const saved = await response.json() as Plan
        parseWorkOperations(saved)
        if (!Array.isArray(saved.owners) || !Array.isArray(saved.evidence)) throw new Error()
        if (controller.signal.aborted) return
        setReadError(false)
        const previous = persisted.current, current = planRef.current
        const unsaved = current && previous && operationFields(current) !== operationFields(JSON.parse(previous))
        if (unsaved && operationFields(JSON.parse(previous)) !== operationFields(saved)) {
          setError(t('operationsConflict'))
          return
        }
        setPlan(unsaved ? { ...current, expectedRevision: saved.expectedRevision } : saved)
        persisted.current = JSON.stringify(saved)
        setSavedSignature(JSON.stringify(saved))
        try {
          const previousRun = localStorage.getItem(`aiso-work-retest:${clientId}:${itemId}:${saved.expectedRevision}:run`)
          if (previousRun) setRetest(JSON.parse(previousRun))
        } catch {}
      })
      .catch(() => { if (!controller.signal.aborted) setReadError(true) })
    return () => controller.abort()
  }, [endpoint, t, revision, open, clientId, itemId, reload, preparing])

  async function reloadRecord() {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    try {
      if (onReloadDraft && !(await onReloadDraft())) return
      persisted.current = null
      planRef.current = null
      setPlan(null)
      setError('')
      setStatus('')
      setReload(value => value + 1)
    } finally { pending.current = false; setBusy(false) }
  }
  async function save() {
    if (pending.current || !plan || readOnly) return
    // A metadata read must not advance the revision of stale draft text.
    if (plan.expectedRevision !== revision) { setError(t('operationsConflict')); return }
    pending.current = true
    setBusy(true)
    setError('')
    setStatus('')
    try {
      const body = parseWorkOperations(plan)
      const response = await fetch(endpoint, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) {
        setError(t(response.status === 409 ? 'operationsConflict' : 'operationsError'))
        return
      }
      const saved = await response.json() as Plan
      parseWorkOperations(saved)
      if (!Array.isArray(saved.owners) || !Array.isArray(saved.evidence)) throw new Error()
      setPlan(saved)
      persisted.current = JSON.stringify(saved)
      setSavedSignature(JSON.stringify(saved))
      setComparison(null)
      setRetest(null)
      setStatus(t('preparationSaved'))
      onRevision?.(saved.expectedRevision)
    } catch { setError(t('operationsError')) }
    finally { pending.current = false; setBusy(false) }
  }
  async function start() {
    if (pending.current || !plan || readOnly) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      const key = `aiso-work-retest:${clientId}:${itemId}:${plan.expectedRevision}`
      if (intent.current?.key !== key) {
        let saved: string | null = null
        try { saved = localStorage.getItem(key) } catch {}
        intent.current = { key, value: saved ?? crypto.randomUUID() }
      }
      try { localStorage.setItem(key, intent.current.value) } catch {}
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ intentKey: intent.current.value }) })
      if (!response.ok) throw new Error()
      const body = await response.json(), run = { id: body.run.id, week: body.run.week }
      setRetest(run)
      try { localStorage.setItem(key + ':run', JSON.stringify(run)) } catch {}
    } catch { setError(t('operationsError')) }
    finally { pending.current = false; setBusy(false) }
  }
  async function compare() {
    if (!retest) return
    setBusy(true)
    try {
      const response = await fetch(endpoint + '?retest=' + retest.id, { cache: 'no-store' })
      if (!response.ok) throw new Error()
      setComparison(await response.json())
    } catch { setError(t('operationsError')) }
    finally { setBusy(false) }
  }

  const advanced = plan && <>
    <p>{t('groupEvidence', { count: plan.evidence.length })}</p>
    <label className="block">{t('owner')}<select className="min-h-11 border" value={plan.ownerId ?? ''} disabled={busy} onChange={event => setPlan({ ...plan, ownerId: event.target.value || null })}>
      <option value="">{t('unassigned')}</option>
      {plan.owners.map(owner => <option key={owner.id} value={owner.id}>{owner.display_name ?? owner.id}</option>)}
    </select></label>
    <label className="block">{t('dueAt')}<input type="date" className="min-h-11 border" value={plan.dueAt ?? ''} disabled={busy} onChange={event => setPlan({ ...plan, dueAt: event.target.value || null })} /></label>
    <label className="block">{t('operationStatus')}<select className="min-h-11 border" value={plan.operationStatus} disabled={busy} onChange={event => setPlan({ ...plan, operationStatus: event.target.value as Plan['operationStatus'] })}>
      {(['todo', 'in_progress', 'done'] as const).map(value => <option key={value} value={value}>{t('operation_' + value)}</option>)}
    </select></label>
  </>
  const content = <section className="min-w-0 space-y-3 rounded-xl border border-border p-4" aria-label={t(preparing ? 'reviewPreparationTitle' : 'operationsTitle')} aria-busy={busy}>
    <h3 className="font-semibold">{t(preparing ? 'reviewPreparationTitle' : 'operationsTitle')}</h3>
    {preparing && <>
      <p className="font-semibold">{t('targetPageUnconfirmed')}</p>
      <p>{t('targetPageUnconfirmedHelp')}</p>
      <p className="text-sm">{t('reviewPreparationScope')}</p>
    </>}
    {!readOnly && <p>{t('operationsNotice')}</p>}
    {readError && <div><p role="status" aria-label={t('reviewPreparationTitle')}>{t('preparationUnavailable')}</p><button type="button" className="min-h-11 underline" onClick={() => { setReadError(false); setReload(value => value + 1) }}>{t('reloadOperations')}</button></div>}
    {error && <p role="alert">{error}</p>}
    {error === t('operationsConflict') && <>
      {onReloadDraft && <p>{t('reloadPreparationHelp')}</p>}
      <button type="button" className="min-h-11 underline" disabled={busy} onClick={() => void reloadRecord()}>{t('reloadOperations')}</button>
    </>}
    {!plan ? !readError && <p>{t('preparationLoading')}</p> : <>
      {readOnly ? <dl className="space-y-2">
        <dt className="font-semibold">{t('targetUrl')}</dt><dd className="break-all">{plan.targetUrl || t('targetPageMissing')}</dd>
        <dt className="font-semibold">{t('acceptanceCriteria')}</dt><dd className="whitespace-pre-wrap break-words">{plan.acceptanceCriteria || t('acceptanceMissing')}</dd>
      </dl> : <>
        {(['targetUrl', 'acceptanceCriteria'] as const).map(key => <label key={key} className="block">{t(key)}
          <textarea rows={key === 'targetUrl' ? 2 : 4} className="block min-h-11 w-full rounded border bg-background p-2 text-foreground" value={plan[key] ?? ''} disabled={busy} onChange={event => { setStatus(''); setPlan({ ...plan, [key]: key === 'targetUrl' ? event.target.value || null : event.target.value }) }} />
        </label>)}
        {mode === 'prepare' ? <details onToggle={event => setOpen(event.currentTarget.open)}><summary className="min-h-11 font-semibold">{t('operationsTitle')}</summary><div className="space-y-3">{advanced}</div></details> : advanced}
        <button type="button" className="min-h-11 underline" disabled={busy} onClick={() => void save()}>{t('saveOperations')}</button>
        <p role="status" aria-label={t('reviewPreparationTitle')} aria-live="polite">{busy ? t('saving') : dirty ? t('preparationUnsaved') : status}</p>
        {plan.operationStatus === 'done' && !dirty && plan.groupScope?.context?.runId && <>
          <p>{t('retestNotice')}</p><button type="button" className="min-h-11 underline" disabled={busy} onClick={() => void start()}>{t('startRetest')}</button>
        </>}
        {retest && <>
          <a className="min-h-11 underline" href={`/${lang}/dashboard/${clientId}?step=monitor&run=${retest.id}`}>{t('openRetest')}</a>
          <a className="min-h-11 underline" href={`/${lang}/dashboard/${clientId}/observations?run=${retest.id}&week=${retest.week}`}>{t('groupEvidenceDetails')}</a>
          <button type="button" className="min-h-11 underline" disabled={busy} onClick={() => void compare()}>{t('compareRetest')}</button>
        </>}
        {comparison && <p role="status">{comparison.comparable ? t('observedDelta', { delta: comparison.delta! }) : t('notComparable', { reasons: comparison.reasons.join(', ') })}</p>}
      </>}
    </>}
  </section>
  return mode === 'details' ? <details onToggle={event => setOpen(event.currentTarget.open)}><summary className="min-h-11 font-semibold">{t('operationsTitle')}</summary>{content}</details> : content
}
