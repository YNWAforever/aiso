'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type { SourcePack, SourcePackEntry } from '@/lib/view-models/source-pack'

/**
 * The owner's view of the facts a draft may quote.
 *
 * It renders a projection the SERVER derived and never derives one itself. Two
 * copies of "will a draft use this?" would be two chances to disagree with
 * `listAgentUsableSources`, and the disagreement would surface as a green badge
 * over a source nothing will ever cite. So a mutation here posts, then asks the
 * server to re-render (`router.refresh()`), rather than patching local state.
 *
 * Every failure path says what did NOT happen. A silent revert would leave an
 * owner believing they had switched agent use on.
 *
 * The type imports are type-only on purpose: `lib/sources/schema.ts` reaches for
 * `node:crypto`, which has no business in a browser bundle.
 */

type Draft = { question: string; answer: string }
const EMPTY_PAIR: Draft = { question: '', answer: '' }

export function SourcePackWorkspace({
  clientId,
  pack,
  loadFailed = false,
}: {
  clientId: string
  pack: SourcePack | null
  loadFailed?: boolean
}) {
  const t = useTranslations('sources')
  const router = useRouter()
  const base = `/api/clients/${encodeURIComponent(clientId)}/sources`

  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [status, setStatus] = useState('')

  const [label, setLabel] = useState('')
  const [sourceKey, setSourceKey] = useState('')
  const [kind, setKind] = useState<'facts' | 'faq'>('facts')
  const [method, setMethod] = useState<'paste' | 'csv'>('paste')
  const [originRef, setOriginRef] = useState('')
  const [pairs, setPairs] = useState<Draft[]>([{ ...EMPTY_PAIR }])
  const [csv, setCsv] = useState('')
  const [approve, setApprove] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  /** A code the service documented; anything else is a dependency failure. */
  function messageFor(code: unknown): string {
    const table = t.raw('errors') as Record<string, string>
    return (typeof code === 'string' && table[code]) || table.SOURCES_UNAVAILABLE!
  }

  async function mutate(sourceId: string, body: Record<string, unknown>, done: string) {
    if (busy) return
    setBusy(sourceId)
    setActionError(null)
    setStatus('')
    try {
      const response = await fetch(`${base}/${encodeURIComponent(sourceId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setActionError(messageFor((payload as { error?: unknown }).error))
        return
      }
      setStatus(done)
      router.refresh()
    } catch {
      // A network failure is not a saved change, and must not read like one.
      setActionError(t('actions.failed'))
    } finally {
      setBusy(null)
    }
  }

  async function submitImport(event: React.FormEvent) {
    event.preventDefault()
    if (importing) return
    setImporting(true)
    setImportError(null)
    setStatus('')
    try {
      const response = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceKey,
          kind,
          label,
          importMethod: method,
          originRef: originRef.trim() ? originRef : null,
          approve,
          ...(method === 'csv' ? { csv } : { entries: pairs }),
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setImportError(messageFor((payload as { error?: unknown }).error))
        return
      }
      // `unchanged` is a real outcome, not a failure: identical text hashes the
      // same, so no version was created and saying "imported" would overstate it.
      setStatus((payload as { result?: string }).result === 'unchanged' ? t('import.unchanged') : t('import.created'))
      setPairs([{ ...EMPTY_PAIR }])
      setCsv('')
      router.refresh()
    } catch {
      setImportError(t('import.failed'))
    } finally {
      setImporting(false)
    }
  }

  const field = 'mt-1 w-full min-h-11 rounded-lg border border-dash-border bg-dash-surface px-3 py-2 text-sm text-dash-text'
  const action = 'inline-flex min-h-11 items-center rounded-lg border border-dash-border px-3 py-2 text-sm font-semibold text-dash-text disabled:opacity-60'

  function entryCard(entry: SourcePackEntry) {
    const { provenance } = entry
    return (
      <li key={entry.id} className="min-w-0 rounded-xl border border-dash-border bg-dash-surface p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-base font-bold text-dash-text">{entry.label}</h3>
          <span className="rounded-full border border-dash-border px-3 py-1 text-xs font-semibold text-dash-text">
            {t(`usability.${entry.usability}`)}
          </span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-dash-muted">{t(`why.${entry.usability}`)}</p>

        <dl className="mt-4 grid gap-2 text-xs text-dash-muted sm:grid-cols-2">
          <div>
            <dt className="font-semibold text-dash-text">{t('provenance.method')}</dt>
            <dd>{provenance.importMethod ? t(`provenance.${provenance.importMethod}`) : t('provenance.none')}</dd>
          </div>
          <div>
            <dt className="font-semibold text-dash-text">{t('provenance.imported')}</dt>
            <dd>
              {provenance.importedAt
                ? <><time dateTime={provenance.importedAt}>{provenance.importedAt.slice(0, 10)}</time>
                    {' · '}{provenance.ageDays} {t('provenance.daysAgo')}</>
                : t('provenance.none')}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-dash-text">{t('provenance.origin')}</dt>
            <dd className="break-words">{provenance.originRef ?? t('provenance.noOrigin')}</dd>
          </div>
          <div>
            <dt className="font-semibold text-dash-text">{t('provenance.version')}</dt>
            <dd>
              {entry.versionNumber ?? '—'}
              {entry.contentHash && <> · <code className="break-all">{entry.contentHash.slice(0, 12)}</code></>}
              {' · '}{entry.entryCount} {t('provenance.entries')}
            </dd>
          </div>
        </dl>

        {entry.freshness === 'stale' && (
          <p className="mt-3 text-xs leading-relaxed text-dash-muted">
            <span className="font-semibold text-dash-text">{t('freshness.stale')}</span>{' — '}{t('freshness.staleNote')}
          </p>
        )}

        {entry.usability !== 'revoked' && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className={action}
              disabled={busy !== null}
              onClick={() => mutate(entry.id, { agentUseAllowed: !entry.agentUseAllowed }, t('actions.saved'))}
            >
              {busy === entry.id ? t('actions.working') : entry.agentUseAllowed ? t('actions.disallow') : t('actions.allow')}
            </button>
            <button
              type="button"
              className={action}
              disabled={busy !== null}
              // No confirm() dialog: it is unreadable on a phone and cannot be
              // translated. The warning is stated next to the control instead.
              onClick={() => mutate(entry.id, { revoke: true }, t('actions.revoked'))}
            >
              {t('actions.revoke')}
            </button>
            <span className="self-center text-xs text-dash-muted">{t('actions.revokeWarning')}</span>
          </div>
        )}
      </li>
    )
  }

  return (
    <main className="mx-auto w-full min-w-0 max-w-4xl break-words px-4 py-8 sm:px-6">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-dash-text">{t('title')}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-dash-muted">{t('summary')}</p>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-dash-muted">{t('notConnected')}</p>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-dash-muted">{t('gate')}</p>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-dash-muted">{t('untrusted')}</p>
      </header>

      <p aria-live="polite" className="text-sm text-dash-text">{status}</p>
      {actionError && <p role="alert" className="mt-2 text-sm text-dash-text">{actionError}</p>}

      {loadFailed || !pack ? (
        <section className="mt-6 rounded-xl border border-dash-border bg-dash-surface p-5">
          <p role="alert" className="text-sm leading-relaxed text-dash-muted">{t('states.error')}</p>
          <button type="button" className={`${action} mt-4`} onClick={() => router.refresh()}>{t('actions.reload')}</button>
        </section>
      ) : (
        <>
          <p className="mt-6 text-sm text-dash-muted">
            {pack.inUse} {t('counts.inUse')} · {pack.awaitingApproval} {t('counts.awaitingApproval')} · {pack.revoked} {t('counts.revoked')}
            {pack.staleInUse > 0 && <> · {pack.staleInUse} {t('counts.staleInUse')} {pack.staleAfterDays} {t('counts.days')}</>}
          </p>
          {pack.state === 'empty'
            ? <p className="mt-6 max-w-2xl text-sm leading-relaxed text-dash-muted">{t('states.empty')}</p>
            : <ul className="mt-6 space-y-4">{pack.entries.map(entryCard)}</ul>}
        </>
      )}

      <section className="mt-10 rounded-xl border border-dash-border bg-dash-surface p-5">
        <h2 className="text-xl font-bold text-dash-text">{t('import.title')}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-dash-muted">{t('import.summary')}</p>
        <form className="mt-5 space-y-4" onSubmit={submitImport}>
          <label className="block text-sm font-semibold text-dash-text">
            {t('import.label')}
            <input className={field} value={label} onChange={event => setLabel(event.target.value)} required maxLength={160} />
          </label>
          <label className="block text-sm font-semibold text-dash-text">
            {t('import.key')}
            <input className={field} value={sourceKey} onChange={event => setSourceKey(event.target.value)} required maxLength={120} />
            <span className="mt-1 block text-xs font-normal text-dash-muted">{t('import.keyHint')}</span>
          </label>
          <label className="block text-sm font-semibold text-dash-text">
            {t('import.kind')}
            <select className={field} value={kind} onChange={event => setKind(event.target.value as 'facts' | 'faq')}>
              <option value="facts">{t('import.kinds.facts')}</option>
              <option value="faq">{t('import.kinds.faq')}</option>
            </select>
          </label>
          <label className="block text-sm font-semibold text-dash-text">
            {t('import.method')}
            <select className={field} value={method} onChange={event => setMethod(event.target.value as 'paste' | 'csv')}>
              <option value="paste">{t('import.methods.paste')}</option>
              <option value="csv">{t('import.methods.csv')}</option>
            </select>
          </label>
          <label className="block text-sm font-semibold text-dash-text">
            {t('import.origin')}
            <input className={field} value={originRef} onChange={event => setOriginRef(event.target.value)} maxLength={500} />
            <span className="mt-1 block text-xs font-normal text-dash-muted">{t('provenance.originNote')}</span>
          </label>

          {method === 'csv' ? (
            <label className="block text-sm font-semibold text-dash-text">
              {t('import.methods.csv')}
              <textarea className={`${field} min-h-32 font-mono`} value={csv} onChange={event => setCsv(event.target.value)} rows={8} />
              <span className="mt-1 block text-xs font-normal text-dash-muted">{t('import.csvHint')}</span>
            </label>
          ) : (
            <fieldset className="space-y-4">
              <legend className="text-sm font-semibold text-dash-text">{t('import.methods.paste')}</legend>
              {pairs.map((pair, index) => (
                <div key={index} className="rounded-lg border border-dash-border p-3">
                  <label className="block text-xs font-semibold text-dash-text">
                    {t('import.question')}
                    <input
                      className={field}
                      value={pair.question}
                      maxLength={4000}
                      onChange={event => setPairs(old => old.map((row, i) => i === index ? { ...row, question: event.target.value } : row))}
                    />
                  </label>
                  <label className="mt-3 block text-xs font-semibold text-dash-text">
                    {t('import.answer')}
                    <textarea
                      className={field}
                      value={pair.answer}
                      maxLength={4000}
                      rows={3}
                      onChange={event => setPairs(old => old.map((row, i) => i === index ? { ...row, answer: event.target.value } : row))}
                    />
                  </label>
                  {pairs.length > 1 && (
                    <button type="button" className={`${action} mt-3`} onClick={() => setPairs(old => old.filter((_, i) => i !== index))}>
                      {t('import.remove')}
                    </button>
                  )}
                </div>
              ))}
              <button type="button" className={action} onClick={() => setPairs(old => [...old, { ...EMPTY_PAIR }])}>
                {t('import.add')}
              </button>
            </fieldset>
          )}

          <label className="flex items-start gap-3 text-sm font-semibold text-dash-text">
            <input type="checkbox" className="mt-1 h-5 w-5" checked={approve} onChange={event => setApprove(event.target.checked)} />
            <span>
              {t('import.approve')}
              <span className="mt-1 block text-xs font-normal text-dash-muted">{t('import.approveNote')}</span>
            </span>
          </label>

          {importError && <p role="alert" className="text-sm text-dash-text">{importError}</p>}
          <button type="submit" className={action} disabled={importing}>
            {importing ? t('import.submitting') : t('import.submit')}
          </button>
        </form>
      </section>
    </main>
  )
}
