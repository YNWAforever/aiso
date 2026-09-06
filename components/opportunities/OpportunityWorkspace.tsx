'use client'
import { useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { OpportunityResponse } from '@/lib/opportunities/types'
import type { WorkItem } from '@/lib/work-items/schema'
import { DraftEditor } from '@/components/work-items/DraftEditor'
import { EvidenceDetails } from './EvidenceDetails'
export function OpportunityWorkspace({
  clientId,
  initial,
}: {
  clientId: string
  initial: OpportunityResponse
}) {
  const t = useTranslations('opportunities'),
    locale = useLocale() === 'zh-HK' ? 'zh-HK' : 'en'
  const [data, setData] = useState(initial),
    [refreshing, setRefreshing] = useState(false),
    [loadError, setLoadError] = useState(false)
  const [view, setView] = useState<'suggestions' | 'drafts'>('suggestions'),
    [items, setItems] = useState<WorkItem[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [listed, setListed] = useState(false),
    [listing, setListing] = useState(false),
    [listError, setListError] = useState(false)
  const [selected, setSelected] = useState<WorkItem | null>(null),
    [opening, setOpening] = useState(false),
    [openError, setOpenError] = useState(false)
  const [evidenceChangedKeys, setEvidenceChangedKeys] = useState<Set<string>>(
    () => new Set(),
  )
  const [saving, setSaving] = useState<string | null>(null),
    [saveError, setSaveError] = useState<{
      key: string
      message: string
    } | null>(null),
    [status, setStatus] = useState('')
  const savingLock = useRef(false),
    listLock = useRef(false),
    refreshLock = useRef(false),
    openLock = useRef(false),
    selectionEpoch = useRef(0),
    editor = useRef<HTMLDivElement>(null)
  const base = `/api/clients/${encodeURIComponent(clientId)}`
  const selectedId = selected?.id
  useEffect(() => {
    if (selectedId && view === 'drafts') editor.current?.focus()
  }, [selectedId, view])
  function remember(item: WorkItem) {
    setItems((old) => [item, ...old.filter((row) => row.id !== item.id)])
    setSelected(item)
  }
  async function list(more = false) {
    if (listLock.current) return
    listLock.current = true
    setListing(true)
    setListError(false)
    try {
      const response = await fetch(
        `${base}/work-items${more && cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
        { cache: 'no-store' },
      )
      if (!response.ok) throw new Error()
      const result = (await response.json()) as {
        items: WorkItem[]
        nextCursor: string | null
      }
      setItems((old) =>
        more
          ? [
              ...old,
              ...result.items.filter(
                (row) => !old.some((previous) => previous.id === row.id),
              ),
            ]
          : result.items,
      )
      setCursor(result.nextCursor)
      setListed(true)
    } catch {
      setListError(true)
    } finally {
      listLock.current = false
      setListing(false)
    }
  }
  function showView(next: 'suggestions' | 'drafts') {
    selectionEpoch.current++
    setView(next)
  }
  function showDrafts() {
    showView('drafts')
    if (!listed && !listLock.current) void list()
  }
  async function refresh() {
    if (refreshLock.current || savingLock.current) return
    refreshLock.current = true
    setRefreshing(true)
    setLoadError(false)
    try {
      const response = await fetch(`${base}/opportunities`, {
        cache: 'no-store',
      })
      if (!response.ok) throw new Error()
      setData(await response.json())
      setEvidenceChangedKeys(new Set())
      setSaveError(null)
      setStatus(t('refreshed'))
    } catch {
      setLoadError(true)
    } finally {
      refreshLock.current = false
      setRefreshing(false)
    }
  }
  async function open(id: string) {
    if (openLock.current) return
    openLock.current = true
    const epoch = ++selectionEpoch.current
    setOpening(true)
    setOpenError(false)
    try {
      const response = await fetch(
        `${base}/work-items/${encodeURIComponent(id)}`,
        { cache: 'no-store' },
      )
      if (!response.ok) throw new Error()
      const item = (await response.json()).item as WorkItem
      if (epoch !== selectionEpoch.current) return
      remember(item)
      setView('drafts')
    } catch {
      if (epoch === selectionEpoch.current) setOpenError(true)
    } finally {
      openLock.current = false
      setOpening(false)
    }
  }
  async function save(suggestion: OpportunityResponse['suggestions'][number]) {
    if (
      savingLock.current ||
      refreshLock.current ||
      evidenceChangedKeys.has(suggestion.key)
    )
      return
    savingLock.current = true
    setSaving(suggestion.key)
    setSaveError(null)
    setStatus('')
    try {
      const response = await fetch(`${base}/work-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: suggestion.source,
          ruleVersion: suggestion.ruleVersion,
          fingerprint: suggestion.fingerprint,
          locale,
        }),
      })
      const result = await response.json()
      if (!response.ok) {
        if (response.status === 409) {
          setEvidenceChangedKeys((previous) =>
            new Set(previous).add(suggestion.key),
          )
        } else {
          setSaveError({ key: suggestion.key, message: 'saveError' })
        }
        return
      }
      const item = result.item as WorkItem
      remember(item)
      setData((old) => ({
        ...old,
        suggestions: old.suggestions.map((row) =>
          row.key === suggestion.key
            ? { ...row, savedState: 'saved', savedDraftId: item.id }
            : row,
        ),
      }))
      setView('drafts')
      setStatus(t('draftSaved'))
    } catch {
      setSaveError({ key: suggestion.key, message: 'saveError' })
    } finally {
      savingLock.current = false
      setSaving(null)
    }
  }
  const button =
    'min-h-11 rounded-lg border border-border px-4 py-2 font-semibold disabled:opacity-50'
  return (
    <main className="mx-auto w-full min-w-0 max-w-5xl space-y-6 p-4 text-foreground sm:p-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p>{t('intro')}</p>
      </header>
      <div
        role="group"
        aria-label={t('views')}
        className="flex flex-wrap gap-3"
      >
        <button
          className={button}
          aria-pressed={view === 'suggestions'}
          disabled={saving !== null}
          onClick={() => showView('suggestions')}
        >
          {t('suggestions')}
        </button>
        <button
          className={button}
          aria-pressed={view === 'drafts'}
          disabled={saving !== null}
          onClick={showDrafts}
        >
          {t('savedDrafts')}
        </button>
      </div>
      <p role="status" aria-live="polite">
        {status || (saving ? t('saving') : opening ? t('loadingDraft') : '')}
      </p>
      {openError && <p role="alert">{t('openError')}</p>}
      <section
        hidden={view !== 'suggestions'}
        aria-label={t('suggestions')}
        className="space-y-5"
        aria-busy={refreshing}
      >
        <div className="space-y-2 rounded-xl border border-border bg-card p-4">
          <p>{t('window')}</p>
          <p>
            {t('week')}: {data.window.pulseWeek ?? t('noWeek')}
          </p>
          {data.window.pulseTruncated && <p>{t('pulseTruncated')}</p>}
          {data.partial && <p>{t('partial')}</p>}
          <p>
            {t('pulse')}: {t(`sourceStates.${data.sourceStates.pulse}`)}
          </p>
          <p>
            {t('scan')}: {t(`sourceStates.${data.sourceStates.scan}`)}
          </p>
          {data.savedDraftsState === 'unavailable' && (
            <p>{t('savedUnknown')}</p>
          )}
          <button
            className={button}
            disabled={refreshing || saving !== null}
            onClick={refresh}
          >
            {refreshing ? t('loadingSuggestions') : t('refresh')}
          </button>
          {loadError && <p role="alert">{t('loadError')}</p>}
        </div>
        {data.suggestions.length === 0 && (
          <p>
            {Object.values(data.sourceStates).includes('unavailable')
              ? t('noAvailableSuggestions')
              : t('empty')}
          </p>
        )}
        {data.suggestions.map((suggestion) => (
          <article
            key={suggestion.key}
            className="min-w-0 space-y-4 rounded-xl border border-border bg-card p-4 sm:p-6"
          >
            <h2 className="text-lg font-semibold">
              {t(`rules.${suggestion.titleKey}.title`, suggestion.args)}
            </h2>
            <p className="whitespace-pre-wrap break-words">
              {t(`rules.${suggestion.actionKey}.action`, suggestion.args)}
            </p>
            <EvidenceDetails
              evidence={suggestion.evidence}
              limitations={suggestion.limitations}
            />
            {suggestion.savedState === 'unavailable' && (
              <p>{t('savedUnknown')}</p>
            )}
            {suggestion.saveAvailability === 'limited-evidence' && (
              <p>{t('limitedEvidence')}</p>
            )}
            {saveError?.key === suggestion.key && (
              <p role="alert">{t(saveError.message)}</p>
            )}
            {evidenceChangedKeys.has(suggestion.key) && (
              <div role="alert">
                <p>{t('evidenceChanged')}</p>
                <button
                  className={button}
                  disabled={refreshing || saving !== null}
                  onClick={refresh}
                >
                  {t('refresh')}
                </button>
              </div>
            )}
            {suggestion.savedDraftId ? (
              <button
                disabled={opening || saving !== null}
                className={button}
                onClick={() => open(suggestion.savedDraftId!)}
              >
                {t('openDraft')}
              </button>
            ) : (
              <button
                className={`${button} bg-primary text-primary-foreground`}
                disabled={
                  refreshing ||
                  opening ||
                  saving !== null ||
                  suggestion.saveAvailability === 'limited-evidence' ||
                  evidenceChangedKeys.has(suggestion.key)
                }
                onClick={() => save(suggestion)}
              >
                {saving === suggestion.key ? t('saving') : t('saveDraft')}
              </button>
            )}
          </article>
        ))}
      </section>
      <section
        hidden={view !== 'drafts'}
        aria-label={t('savedDrafts')}
        className="space-y-5"
      >
        <div className="space-y-3" aria-busy={listing}>
          <h2 className="text-xl font-semibold">{t('savedDrafts')}</h2>
          <button className={button} disabled={listing} onClick={() => list()}>
            {listing ? t('loadingDrafts') : t('refreshDrafts')}
          </button>
          {listError && <p role="alert">{t('listError')}</p>}
          {listed && !items.length && <p>{t('noDrafts')}</p>}
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  className={`${button} w-full break-words text-left`}
                  disabled={opening || saving !== null}
                  onClick={() => open(item.id)}
                >
                  {item.title}
                </button>
              </li>
            ))}
          </ul>
          {cursor && (
            <button
              className={button}
              disabled={listing}
              onClick={() => list(true)}
            >
              {t('loadMore')}
            </button>
          )}
        </div>
        {selected && (
          <div ref={editor} tabIndex={-1} aria-label={t('savedDraft')}>
            <DraftEditor
              key={`${selected.id}:${selected.revision}`}
              clientId={clientId}
              item={selected}
              onSaved={(item) => {
                setItems((old) =>
                  old.map((row) => (row.id === item.id ? item : row)),
                )
              }}
            />
          </div>
        )}
      </section>
    </main>
  )
}
