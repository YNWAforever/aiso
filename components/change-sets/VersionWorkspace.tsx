'use client'
import { useRef, useState, type FormEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { WorkItem } from '@/lib/work-items/schema'
import type { VersionDetail, VersionSummary } from '@/lib/change-sets/types'
import { VersionDetails } from './VersionDetails'
import { DecisionForm } from './DecisionForm'
export type VersionPageDTO = {
  versions: VersionSummary[]
  nextCursor: string | null
  latestVersionId: string | null
}
export type VersionWorkspaceProps = {
  clientId: string
  workItemId: string
  initialDraft: WorkItem | null
  initial: VersionPageDTO | null
  initialVersion?: VersionDetail | null
  initialError?: string
}
export function VersionWorkspace({
  clientId,
  workItemId,
  initialDraft,
  initial,
  initialVersion = null,
  initialError = '',
}: VersionWorkspaceProps) {
  const t = useTranslations('changeSets'),
    lang = useLocale(),
    [draft, setDraft] = useState(initialDraft),
    [page, setPage] = useState(initial),
    [selected, setSelected] = useState(initialVersion)
  const [error, setError] = useState(initialError),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false)
  const dirtyRef = useRef(false),
    versionReadGeneration = useRef(0)
  const lock = useRef(false),
    statusRef = useRef<HTMLParagraphElement>(null)
  const base = `/api/clients/${encodeURIComponent(clientId)}/work-items/${encodeURIComponent(workItemId)}`,
    endpoint = base + '/versions'
  const button =
    'min-h-11 rounded-lg border border-border px-4 py-2 font-semibold disabled:opacity-50'
  async function run(operation: () => Promise<void>) {
    if (lock.current) return
    lock.current = true
    const generation = versionReadGeneration.current
    setBusy(true)
    setError('')
    try {
      await operation()
    } catch {
      if (generation === versionReadGeneration.current) setError('unavailable')
    } finally {
      setBusy(false)
      lock.current = false
    }
  }
  function upsert(version: VersionDetail) {
    // A confirmed mutation outranks every version read started before it.
    versionReadGeneration.current++
    setSelected(version)
    setPage((previous) => ({
      versions: [
        version,
        ...(previous?.versions ?? []).filter((v) => v.id !== version.id),
      ].sort((a, b) => b.versionNumber - a.versionNumber),
      nextCursor: previous?.nextCursor ?? null,
      latestVersionId:
        !previous?.versions.length ||
        version.versionNumber >= previous.versions[0].versionNumber
          ? version.id
          : previous.latestVersionId,
    }))
  }
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!draft || dirty) return
    await run(async () => {
      setStatus('')
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: draft.revision }),
      })
      if (!res.ok) {
        setError(
          res.status === 409
            ? 'conflict'
            : res.status === 422
              ? 'validationFailed'
              : res.status === 403
                ? 'denied'
                : 'unavailable',
        )
        return
      }
      upsert((await res.json()).version)
      setStatus('versionSubmitted')
    })
  }
  async function reload() {
    await run(async () => {
      const res = await fetch(base, { cache: 'no-store' })
      if (!res.ok) throw Error()
      setDraft((await res.json()).item)
      setStatus('draftReloaded')
    })
  }
  async function history(more = false) {
    await run(async () => {
      const generation = versionReadGeneration.current
      const res = await fetch(
        endpoint +
          (more && page?.nextCursor
            ? '?cursor=' + encodeURIComponent(page.nextCursor)
            : ''),
        { cache: 'no-store' },
      )
      if (!res.ok) throw Error()
      const next: VersionPageDTO = await res.json()
      if (generation !== versionReadGeneration.current) return
      setSelected((current) => {
        if (!current) return current
        const summary = next.versions.find((value) => value.id === current.id)
        return summary
          ? {
              ...current,
              decision: summary.decision,
              capabilities: summary.capabilities,
            }
          : next.latestVersionId !== current.id
            ? { ...current, capabilities: { canDecide: false } }
            : current
      })
      setPage((previous) =>
        more
          ? {
              ...next,
              versions: [
                ...(previous?.versions ?? []),
                ...next.versions,
              ].filter(
                (v, i, all) => all.findIndex((x) => x.id === v.id) === i,
              ),
            }
          : next,
      )
    })
  }
  async function select(id: string) {
    if (dirtyRef.current) return
    await run(async () => {
      const generation = versionReadGeneration.current
      const res = await fetch(endpoint + '/' + encodeURIComponent(id), {
        cache: 'no-store',
      })
      if (!res.ok) throw Error()
      const next: { version: VersionDetail } = await res.json()
      // The existing form stays editable during this read. Do not remount it
      // if the user has entered a reason or a mutation has since completed.
      if (dirtyRef.current || generation !== versionReadGeneration.current)
        return
      setSelected(next.version)
    })
  }
  return (
    <main
      className="mx-auto max-w-5xl space-y-6 p-4 text-foreground sm:p-8"
      aria-busy={busy}
    >
      <a
        className="inline-flex min-h-11 items-center underline"
        href={`/${lang}/dashboard/${encodeURIComponent(clientId)}/opportunities`}
      >
        {t('backToDrafts')}
      </a>
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <p>{t('notDelivery')}</p>
      <p>{t('immutableNotice')}</p>
      {error && <p role="alert">{t(error)}</p>}
      <p role="status" tabIndex={-1} ref={statusRef}>
        {busy ? t('loading') : status ? t(status) : ''}
      </p>
      <section className="space-y-3 rounded-xl border border-border p-4">
        <h2 className="text-xl font-semibold">{t('currentDraft')}</h2>
        {draft ? (
          <>
            <p>{t('savedRevision', { revision: draft.revision })}</p>
            <h3 className="whitespace-pre-wrap break-words">{draft.title}</h3>
            <p className="whitespace-pre-wrap break-words">{draft.action}</p>
            <p className="whitespace-pre-wrap break-words">{draft.notes}</p>
            <form onSubmit={submit}>
              <button className={button} disabled={busy || dirty} type="submit">
                {t('submitVersion')}
              </button>
            </form>
          </>
        ) : (
          <p>{t('draftUnavailable')}</p>
        )}
        <button className={button} disabled={busy} onClick={reload}>
          {t('reloadDraft')}
        </button>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">{t('history')}</h2>
        <button className={button} disabled={busy} onClick={() => history()}>
          {t('reloadHistory')}
        </button>
        {page && page.versions.length === 0 && <p>{t('noVersions')}</p>}
        <ul className="flex flex-wrap gap-3">
          {page?.versions.map((v) => (
            <li key={v.id}>
              <button
                className={button}
                disabled={busy || dirty}
                aria-pressed={selected?.id === v.id}
                onClick={() => select(v.id)}
              >
                {t('versionNumber', { number: v.versionNumber })} ·{' '}
                {t(v.decision?.decision ?? 'pending')}
              </button>
            </li>
          ))}
        </ul>
        {page?.nextCursor && (
          <button
            className={button}
            disabled={busy || dirty}
            onClick={() => history(true)}
          >
            {t('moreVersions')}
          </button>
        )}
      </section>
      {dirty && <p>{t('finishDecision')}</p>}
      {selected && (
        <>
          <VersionDetails
            version={selected}
            latestVersionId={page?.latestVersionId ?? null}
          />
          {(dirty ||
            (!selected.decision && selected.capabilities.canDecide)) && (
            <DecisionForm
              key={selected.id}
              version={selected}
              endpoint={
                endpoint + '/' + encodeURIComponent(selected.id) + '/decision'
              }
              onDirty={(next) => {
                dirtyRef.current = next
                setDirty(next)
              }}
              onCompleted={(value) => {
                upsert(value)
                setStatus('decisionRecorded')
                requestAnimationFrame(() => statusRef.current?.focus())
              }}
            />
          )}
        </>
      )}
    </main>
  )
}
