'use client'
import {GroupedOpportunityCards} from './GroupedOpportunityCards'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { scanOpportunityCopy } from '@/lib/opportunities/presentation'
import { MaintenanceNextSteps,workflowCopyKeys,type WorkflowCopy } from '@/components/workspace/MaintenanceNextSteps'
import type { OpportunityResponse } from '@/lib/opportunities/types'
import type { WorkItem } from '@/lib/work-items/schema'
import { DraftEditor } from '@/components/work-items/DraftEditor'
import { EvidenceDetails } from './EvidenceDetails'
import { selectScanOpportunities } from '@/lib/opportunities/scan-selection'
type WorkspaceProps = { clientId: string; scanId?: string } & (
  | { initial: OpportunityResponse; initialError?: never }
  | { initial: null; initialError: 'unavailable' }
)
export function OpportunityWorkspace(props: WorkspaceProps) {
  return <OpportunityContent key={`${props.clientId}:${props.scanId ?? ''}`} {...props} />
}
function OpportunityContent({
  clientId,
  scanId,
  initial,
  initialError,
}: WorkspaceProps) {
  const t = useTranslations('opportunities'),
    locale = useLocale() === 'zh-HK' ? 'zh-HK' : 'en'
  const [data, setData] = useState(initial),
    [refreshing, setRefreshing] = useState(false),
    [loadError, setLoadError] = useState(Boolean(initialError))
  const [view, setView] = useState<'suggestions' | 'drafts'>('suggestions'),
    [items, setItems] = useState<WorkItem[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [listState, setListState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle')
  const [editorDirty, setEditorDirty] = useState(false)
  const listed = listState === 'loaded', listing = listState === 'loading', listError = listState === 'error'
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
    listRequest = useRef<Promise<void> | null>(null),
    listLoaded = useRef(false),
    listCursor = useRef<string | null>(null),
    selectedItem = useRef<WorkItem | null>(null),
    restored = useRef(false),
    refreshLock = useRef(false),
    openLock = useRef(false),
    active = useRef(true),
    selectionEpoch = useRef(0),
    editor = useRef<HTMLDivElement>(null)
  const base = `/api/clients/${encodeURIComponent(clientId)}`
  const belongsToScan = useCallback((item: WorkItem) => !scanId || (item.sourceScanIds ? item.sourceScanIds.includes(scanId) : (
    item.evidenceSnapshot?.source.kind === 'scan-check' && item.evidenceSnapshot.source.id === scanId
  )), [scanId])
  const selectedId = selected?.id
  const visibleSuggestions = (scanId ? selectScanOpportunities(data, scanId) : data?.suggestions)?.filter(s =>
    !data?.groups?.some(g => g.context?.runId && g.platforms.length > 1 && g.suggestionKeys.includes(s.key))) ?? []
  const displayedSuggestions = scanId ? visibleSuggestions.slice(0, 3) : visibleSuggestions
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])
  useEffect(() => {
    if (selectedId && view === 'drafts') editor.current?.focus()
  }, [selectedId, view])
  const remember = useCallback((item: WorkItem) => {
    if (!active.current) return
    setItems((old) => [item, ...old.filter((row) => row.id !== item.id)])
    setSelected(item)
    selectedItem.current = item
    const url = new URL(window.location.href)
    url.searchParams.set('draft', item.id)
    window.history.replaceState(window.history.state, '', url)
  }, [])
  const list = useCallback((more = false): Promise<void> => {
    if (listRequest.current) return listRequest.current
    const task = (async () => {
    setListState('loading')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    try {
      const response = await fetch(
        `${base}/work-items${more && listCursor.current ? `?cursor=${encodeURIComponent(listCursor.current)}` : ''}`,
        { cache: 'no-store', signal: controller.signal },
      )
      if (!response.ok) throw new Error()
      const result = (await response.json()) as {
        items: WorkItem[]
        nextCursor: string | null
      }
      if (!Array.isArray(result.items) || result.items.some(row => !row || typeof row.id !== 'string' || row.clientId !== clientId) || (result.nextCursor !== null && typeof result.nextCursor !== 'string')) throw new Error()
      setItems((old) => {
        const selected = selectedItem.current
        const matching = result.items.filter(belongsToScan)
        const rows = more ? [...old, ...matching] : [...matching, ...(selected && !matching.some(row => row.id === selected.id) ? [selected] : [])]
        const seen = new Set<string>()
        return rows.filter(row => seen.has(row.id) ? false : Boolean(seen.add(row.id)))
      })
      listCursor.current = result.nextCursor
      setCursor(result.nextCursor)
      listLoaded.current = true
      setListState('loaded')
    } catch {
      setListState('error')
    } finally {
      clearTimeout(timer)
      listRequest.current = null
    }
    })()
    listRequest.current = task
    return task
  }, [base, clientId, belongsToScan])
  const ensureDraftListLoaded = useCallback((): Promise<void> => listLoaded.current ? Promise.resolve() : list(), [list])
  function showView(next: 'suggestions' | 'drafts') {
    selectionEpoch.current++
    setView(next)
    if (next === 'suggestions') {
      const url = new URL(window.location.href)
      url.searchParams.delete('draft')
      window.history.replaceState(window.history.state, '', url)
    }
  }
  function showDrafts() {
    showView('drafts')
    void ensureDraftListLoaded()
  }
  async function refresh(more=false) {
    if (refreshLock.current || savingLock.current) return
    refreshLock.current = true
    setRefreshing(true)
    setLoadError(false)
    try {
      const response = await fetch(`${base}/opportunities${scanId?`?scanId=${encodeURIComponent(scanId)}`:more&&data?.window.nextCursor?`?cursor=${encodeURIComponent(data.window.nextCursor)}`:''}`, {
        cache: 'no-store',
        signal:AbortSignal.timeout(15000),
      })
      if (!response.ok) throw new Error()
      const next=await response.json() as OpportunityResponse
      if(!Array.isArray(next.suggestions)||!next.window||scanId&&next.window.scanId!==null&&next.window.scanId!==scanId)throw new Error()
      setData(old=>more&&old?{...next,suggestions:[...old.suggestions,...next.suggestions].filter((row,index,rows)=>rows.findIndex(item=>item.key===row.key)===index)}:next)
      if(!more){setEvidenceChangedKeys(new Set());setSaveError(null)}
      setStatus(t('refreshed'))
    } catch {
      setLoadError(true)
    } finally {
      refreshLock.current = false
      setRefreshing(false)
    }
  }
  const readDraft = useCallback(async (id: string): Promise<WorkItem> => {
    const response = await fetch(`${base}/work-items/${encodeURIComponent(id)}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error()
    const item = (await response.json()).item as WorkItem
    if (!item || item.id !== id || item.clientId !== clientId || !belongsToScan(item)) throw new Error()
    return item
  }, [base, clientId, belongsToScan])
  const open = useCallback(async (id: string) => {
    if (openLock.current || editorDirty) return
    openLock.current = true
    const epoch = ++selectionEpoch.current
    setOpening(true)
    setOpenError(false)
    try {
      const item = await readDraft(id)
      if (!active.current || epoch !== selectionEpoch.current) return
      remember(item)
      setView('drafts')
      void ensureDraftListLoaded()
    } catch {
      if (epoch === selectionEpoch.current) setOpenError(true)
    } finally {
      openLock.current = false
      setOpening(false)
    }
  }, [readDraft, remember, ensureDraftListLoaded, editorDirty])
  useEffect(() => {
    if (restored.current) return
    restored.current = true
    const id = new URL(window.location.href).searchParams.get('draft')
    let cancelled = false
    const epoch = selectionEpoch.current
    if (id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      void readDraft(id).then(item => {
        if (cancelled || epoch !== selectionEpoch.current) return
        remember(item); setView('drafts'); void ensureDraftListLoaded()
      }).catch(() => { if (!cancelled && epoch === selectionEpoch.current) setOpenError(true) })
    }
    return () => { cancelled = true }
  }, [readDraft, remember, ensureDraftListLoaded])
  async function save(suggestion: OpportunityResponse['suggestions'][number]) {
    if (
      savingLock.current ||
      editorDirty ||
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
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({
          source: suggestion.source,
          ruleVersion: suggestion.ruleVersion,
          fingerprint: suggestion.fingerprint,
          locale,
        }),
      })
      const result = await response.json()
      if (!active.current) return
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
      if (!item || typeof item.id !== 'string' || item.clientId !== clientId || !belongsToScan(item)) throw new Error()
      remember(item)
      setData(
        (old) =>
          old && {
            ...old,
            suggestions: old.suggestions.map((row) =>
              row.key === suggestion.key
                ? { ...row, savedState: 'saved', savedDraftId: item.id }
                : row,
            ),
          },
      )
      setView('drafts')
      void ensureDraftListLoaded()
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
  const Container = scanId ? 'section' : 'main'
  return (
    <Container className={`mx-auto w-full min-w-0 max-w-5xl space-y-6 text-foreground ${scanId ? '' : 'p-4 sm:p-8'}`}>
      <header className="space-y-2">
        {scanId ? <h2 className="text-2xl font-bold">{t('scanDraftTitle')}</h2> : <h1 className="text-2xl font-bold">{t('title')}</h1>}
        <p>{t(scanId ? 'scanDraftIntro' : 'intro')}</p>
        {scanId && <p className="break-all text-sm">{t('sourceScan')}: {scanId}</p>}
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
      {editorDirty && <p>{t('finishEditing')}</p>}
      {openError && <p role="alert">{t('openError')}</p>}
      <section
        hidden={view !== 'suggestions'}
        aria-label={t('suggestions')}
        className="space-y-5"
        aria-busy={refreshing}
      >
        <div className="space-y-2 rounded-xl border border-border bg-card p-4">
          <p>{t(scanId ? 'scanPriorityReason' : 'window')}</p>
          {scanId && <p>{t('scanPriorityCount', { shown: displayedSuggestions.length, available: visibleSuggestions.length })}</p>}
          {scanId && data?.suggestions.some(s => s.saveAvailability === 'limited-evidence') && <p>{t('limitedEvidence')}</p>}
          {data && (
            <>
              {!scanId && <p>
                {t('week')}: {data.window.pulseWeek ?? t('noWeek')}
              </p>}
              {data.window.pulseTruncated && <p>{t('pulseTruncated')}</p>}
              {data.partial && <p>{t('partial')}</p>}
              {!scanId && <p>
                {t('pulse')}: {t(`sourceStates.${data.sourceStates.pulse}`)}
              </p>}
              <p>
                {t('scan')}: {t(`sourceStates.${data.sourceStates.scan}`)}
              </p>
              {data.savedDraftsState === 'unavailable' && (
                <p>{t('savedUnknown')}</p>
              )}
            </>
          )}
          <button
            className={button}
            disabled={refreshing || saving !== null}
            onClick={() => refresh()}
          >
            {refreshing ? t('loadingSuggestions') : t('refresh')}
          </button>
          {loadError && (
            <p role="alert">{t(data ? 'loadError' : 'initialLoadError')}</p>
          )}
        </div>
        {data && data.suggestions.length === 0 && (
          <p>
            {Object.values(data.sourceStates).includes('unavailable')
              ? t('noAvailableSuggestions')
              : t('empty')}
          </p>
        )}
        {data?.groups&&<GroupedOpportunityCards clientId={clientId} groups={data.groups.filter(g=>g.context?.runId&&g.platforms.length>1)} suggestions={data.suggestions} onOpen={id=>void open(id)}/>}
        {displayedSuggestions.map((suggestion) => {
          const copy = suggestion.evidence.kind === 'scan-check' ? scanOpportunityCopy(suggestion.evidence, locale) : null
          const displayArgs = copy ? { ...suggestion.args, checkTitle: copy.title, checkAction: copy.action } : suggestion.args
          return (
          <article
            key={suggestion.key}
            className="min-w-0 space-y-4 rounded-xl border border-border bg-card p-4 sm:p-6"
          >
            <h2 className="text-lg font-semibold">
              {t(`rules.${suggestion.titleKey}.title`, displayArgs)}
            </h2>
            <p className="whitespace-pre-wrap break-words">
              {t(`rules.${suggestion.actionKey}.action`, displayArgs)}
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
                  onClick={() => refresh()}
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
                  editorDirty ||
                  suggestion.saveAvailability === 'limited-evidence' ||
                  evidenceChangedKeys.has(suggestion.key)
                }
                onClick={() => save(suggestion)}
              >
                {saving === suggestion.key ? t('saving') : t('saveDraft')}
              </button>
            )}
          </article>
          )
        })}
        {data?.window.nextCursor&&<button className={button} disabled={refreshing||saving!==null} onClick={()=>refresh(true)}>{t('moreCandidates')}</button>}
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
                  disabled={opening || saving !== null || editorDirty}
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
              scanId={scanId}
              item={selected}
              onDirtyChange={setEditorDirty}
              onSaved={(item) => {
                setItems((old) =>
                  old.map((row) => (row.id === item.id ? item : row)),
                )
              }}
            />
          </div>
        )}
      </section>
      {!scanId && <MaintenanceNextSteps clientId={clientId} lang={locale} current="opportunities" copy={Object.fromEntries(workflowCopyKeys.map(key=>[key,t(key)])) as WorkflowCopy}/>}
    </Container>
  )
}
