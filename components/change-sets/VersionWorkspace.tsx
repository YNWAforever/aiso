'use client'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { WorkItem } from '@/lib/work-items/schema'
import type { VersionDetail, VersionSummary } from '@/lib/change-sets/types'
import { parseVersionDetail, parseVersionPage } from '@/lib/change-sets/read-view'
import { installReportNavigationBlocker } from '@/lib/reports/navigation-blocker'
import { VersionDetails } from './VersionDetails'
import { DecisionForm } from './DecisionForm'
import { ReviewHelp } from '@/components/change-sets/ReviewHelp'
import { DeliveryWorkspace } from '@/components/delivery/DeliveryWorkspace'
import { HandoffPanel } from '@/components/site-edit/HandoffPanel'
import { OutcomeWorkspace } from '@/components/outcomes/OutcomeWorkspace'
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
  smeCopilot?: boolean
  viewerProfileId?: string
}

function sameVersion(left: VersionSummary, right: VersionSummary): boolean {
  return left.id === right.id && left.workItemId === right.workItemId &&
    left.contentHash === right.contentHash && left.draftRevision === right.draftRevision &&
    left.schemaVersion === right.schemaVersion && left.versionNumber === right.versionNumber
}
function sameDecision(left: VersionSummary, right: VersionSummary): boolean {
  const a = left.decision, b = right.decision
  return !a || Boolean(b && a.decision === b.decision && a.reason === b.reason &&
    a.decidedAt === b.decidedAt && a.decidedBy.profileId === b.decidedBy.profileId &&
    a.decidedBy.role === b.decidedBy.role && a.decidedBy.displayName === b.decidedBy.displayName)
}
function assertVersionProgress(value: VersionSummary, known: Iterable<VersionSummary>): void {
  for (const saved of known) {
    if (saved.id === value.id && (!sameVersion(saved, value) || !sameDecision(saved, value))) throw Error()
  }
}
function mergeDetailDecision(page: VersionPageDTO, detail: VersionDetail): VersionPageDTO {
  if (!detail.decision) return page
  return { ...page, versions: page.versions.map(summary => summary.id === detail.id
    ? { ...summary, decision: detail.decision, capabilities: detail.capabilities } : summary) }
}
function canonicalScopeId(value: string): string {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase() : value
}
function readDraft(value: unknown, clientId: string, workItemId: string): WorkItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error()
  const item = value as WorkItem
  if (item.id !== workItemId || item.clientId !== clientId || item.status !== 'draft' ||
    !Number.isSafeInteger(item.revision) || item.revision < 1 ||
    typeof item.title !== 'string' || !item.title || typeof item.action !== 'string' || !item.action ||
    typeof item.notes !== 'string' || !['en', 'zh-HK'].includes(item.locale) ||
    typeof item.createdAt !== 'string' || !Number.isFinite(Date.parse(item.createdAt)) ||
    typeof item.updatedAt !== 'string' || !Number.isFinite(Date.parse(item.updatedAt)) ||
    !item.evidenceSnapshot || item.evidenceSnapshot.schemaVersion !== 1) throw Error()
  return item
}

// The server also keys brand:item. Keep the boundary here for every other caller,
// so pending child callbacks and local fields cannot survive a scope change.
export function VersionWorkspace(props: VersionWorkspaceProps) {
  const clientId = canonicalScopeId(props.clientId), workItemId = canonicalScopeId(props.workItemId)
  return <ScopedVersionWorkspace {...props} key={`${clientId}:${workItemId}`} clientId={clientId} workItemId={workItemId} />
}
function ScopedVersionWorkspace({
  clientId, workItemId, initialDraft, initial, initialVersion = null,
  initialError = '', smeCopilot = false, viewerProfileId,
}: VersionWorkspaceProps) {
  const t = useTranslations('changeSets'), lang = useLocale()
  const [seed] = useState(() => {
    let error = initialError
    let page: VersionPageDTO | null = null, selected: VersionDetail | null = null, draft: WorkItem | null = null
    try {
      if (initialDraft) draft = readDraft(initialDraft, clientId, workItemId)
      if (initial) {
        const candidate = parseVersionPage(initial, workItemId)
        for (const summary of candidate.versions) assertVersionProgress(summary, candidate.versions)
        page = candidate
      }
      if (initialVersion) {
        const summary = page?.versions.find(v => v.id === initialVersion.id)
        const candidate = parseVersionDetail(initialVersion, workItemId, summary)
        assertVersionProgress(candidate, page?.versions ?? [])
        if (page) page = mergeDetailDecision(page, candidate)
        selected = candidate
      }
    } catch { error = 'unavailable' }
    return { draft, page, selected, error }
  })
  const [draft, setDraft] = useState(seed.draft), [page, setPage] = useState(seed.page),
    [selected, setSelected] = useState(seed.selected)
  const [error, setError] = useState(seed.error), [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false),
    [deliveryDirty, setDeliveryDirty] = useState(false), [outcomeRefresh, setOutcomeRefresh] = useState(0),
    [deliveryRefresh, setDeliveryRefresh] = useState(0), [mutationFloor, setMutationFloor] = useState(0)
  const alive = useRef(true), lock = useRef(false), versionReadGeneration = useRef(0)
  const pageRef = useRef(page), selectedRef = useRef(selected), draftRef = useRef(draft)
  // Per-scope positive knowledge: validated terminal reads must survive moving
  // away from their inspector, just as confirmed mutations survive older reads.
  // Only mutation receipts may be retained as extra rows across pagination.
  const confirmed = useRef(new Map<string, { version: VersionSummary; mutation: boolean }>(
    [...(seed.page?.versions ?? []), ...(seed.selected ? [seed.selected] : [])]
      .filter(version => version.decision !== null)
      .map(version => [version.id, { version, mutation: false }] as const),
  ))
  const decisionDirtyRef = useRef(false), deliveryDirtyRef = useRef(false), dirtyRef = useRef(false)
  const statusRef = useRef<HTMLParagraphElement>(null)
  const manualDetailsRef = useRef<HTMLDetailsElement>(null)
  const anyDirty = dirty || deliveryDirty
  useEffect(() => {
    alive.current = true
    const generation = versionReadGeneration
    return () => { alive.current = false; generation.current++ }
  }, [])
  const deliveryChanged = useCallback(() => {
    if (alive.current) setOutcomeRefresh(value => value + 1)
  }, [])
  const handoffRecordedChange = useCallback(() => {
    if (!alive.current) return
    setDeliveryRefresh(value => value + 1)
    setOutcomeRefresh(value => value + 1)
  }, [])
  const deliveryDirtyChange = useCallback((next: boolean) => {
    if (!alive.current) return
    deliveryDirtyRef.current = next
    dirtyRef.current = decisionDirtyRef.current || next
    setDeliveryDirty(next)
  }, [])
  useEffect(() => {
    let allowUnload = false, timeout: number | undefined
    const prepareFailOpen = () => {
      allowUnload = true
      timeout = window.setTimeout(() => { allowUnload = false }, 1000)
      return () => { allowUnload = false; window.clearTimeout(timeout) }
    }
    const unload = (event: BeforeUnloadEvent) => {
      if (allowUnload) { event.stopImmediatePropagation(); return }
      // DeliveryWorkspace already protects its own dirty fields.
      if (!decisionDirtyRef.current || deliveryDirtyRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    const navigate = (event: MouseEvent) => {
      if (!decisionDirtyRef.current || deliveryDirtyRef.current || event.defaultPrevented || event.button !== 0 ||
        event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
      if (!anchor || anchor.hasAttribute('download') || anchor.target === '_blank') return
      if (anchor.href === window.location.href) return
      if (!window.confirm(t('sme.unsaved'))) { event.preventDefault(); event.stopImmediatePropagation() }
      else prepareFailOpen()
    }
    const remove = installReportNavigationBlocker({
      browser: window, shouldBlock: () => dirtyRef.current,
      confirmLeave: () => {
        const leave = window.confirm(t('sme.unsaved'))
        if (leave) prepareFailOpen()
        return leave
      }, prepareFailOpen,
    })
    window.addEventListener('beforeunload', unload, true)
    document.addEventListener('click', navigate, true)
    return () => {
      remove(); window.clearTimeout(timeout)
      window.removeEventListener('beforeunload', unload, true)
      document.removeEventListener('click', navigate, true)
    }
  }, [t])
  const base = `/api/clients/${encodeURIComponent(clientId)}/work-items/${encodeURIComponent(workItemId)}`,
    endpoint = base + '/versions'
  const button = 'min-h-11 rounded-lg border border-border px-4 py-2 font-semibold disabled:opacity-50'
  const primary = button + ' border-primary bg-primary text-primary-foreground'
  const latest = page?.versions.find(v => v.id === page.latestVersionId)
  const knownFloor = Math.max(mutationFloor, ...(page?.versions ?? []).map(v => v.versionNumber))
  const latestIsCurrent = Boolean(latest && latest.versionNumber >= knownFloor)
  const emptyHistory = page?.latestVersionId === null && page.versions.length === 0 && page.nextCursor === null && knownFloor === 0
  const canFreeze = Boolean(draft && (emptyHistory || (latestIsCurrent && latest && latest.draftRevision < draft.revision)))
  const historical = Boolean(selected && ((latestIsCurrent && selected.id !== page?.latestVersionId) || selected.versionNumber < knownFloor))
  const historyAvailable = Boolean(page && (emptyHistory || latestIsCurrent))
  const currentDecision = selected && latestIsCurrent && selected.id === page?.latestVersionId && !selected.decision && selected.capabilities.canDecide
  // Latest scope is independent of a page's first row or a replayed submission.
  const decisionVersion = selected && (!latestIsCurrent || selected.id !== page?.latestVersionId)
    ? { ...selected, capabilities: { canDecide: false } } : selected
  function choose(value: VersionDetail | null) { selectedRef.current = value; setSelected(value) }
  function savePage(value: VersionPageDTO) { pageRef.current = value; setPage(value) }
  function knownVersions(): VersionSummary[] {
    return [...(pageRef.current?.versions ?? []), ...(selectedRef.current ? [selectedRef.current] : []),
      ...[...confirmed.current.values()].map(saved => saved.version)]
  }
  function rememberTerminal(version: VersionSummary) {
    if (version.decision) confirmed.current.set(version.id, {
      version, mutation: confirmed.current.get(version.id)?.mutation ?? false,
    })
  }
  async function run(operation: () => Promise<void>) {
    if (lock.current || !alive.current) return
    lock.current = true
    const generation = versionReadGeneration.current
    setBusy(true); setError('')
    try { await operation() }
    catch { if (alive.current && generation === versionReadGeneration.current) setError('unavailable') }
    finally {
      lock.current = false
      if (alive.current) setBusy(false)
    }
  }
  function upsert(version: VersionDetail, preserveSelection = false) {
    if (!alive.current) return
    assertVersionProgress(version, knownVersions())
    versionReadGeneration.current++
    confirmed.current.set(version.id, { version, mutation: true })
    setMutationFloor(floor => Math.max(floor, version.versionNumber))
    const current = selectedRef.current
    choose(preserveSelection && current && current.id !== version.id
      ? { ...current, capabilities: version.versionNumber > current.versionNumber ? { canDecide: false } : current.capabilities }
      : version)
    const previous = pageRef.current
    if (previous) savePage({
      ...previous,
      versions: previous.versions.some(v => v.id === version.id)
        ? previous.versions.map(v => v.id === version.id ? version : v)
        : [version, ...previous.versions],
      // Only a list read may change this independent server-provided identity.
      latestVersionId: previous.latestVersionId,
    })
  }
  function applyHistory(next: VersionPageDTO, more: boolean) {
    const previous = pageRef.current, current = selectedRef.current
    const known = knownVersions()
    for (const v of next.versions) assertVersionProgress(v, [...known, ...next.versions])
    if (previous?.latestVersionId && !next.latestVersionId) throw Error()
    const oldLatest = known.find(v => v.id === previous?.latestVersionId)
    const newLatest = [...next.versions, ...known].find(v => v.id === next.latestVersionId)
    const floor = Math.max(oldLatest?.versionNumber ?? 0, ...known.map(v => v.versionNumber))
    if (newLatest && floor > newLatest.versionNumber) throw Error()
    const versions = [...next.versions,
      ...[...confirmed.current.values()]
        .filter(saved => saved.mutation && !next.versions.some(next => next.id === saved.version.id))
        .map(saved => saved.version),
    ]
    for (const version of next.versions) rememberTerminal(version)
    if (current) {
      const summary = versions.find(v => v.id === current.id)
      choose(summary ? { ...current, decision: summary.decision, capabilities: summary.capabilities }
        : next.latestVersionId !== current.id ? { ...current, capabilities: { canDecide: false } } : current)
    }
    savePage(more ? { ...next, versions: [
      ...(previous?.versions ?? []).map(v => versions.find(next => next.id === v.id) ?? v),
      ...versions.filter(v => !previous?.versions.some(saved => saved.id === v.id)),
    ] } : { ...next, versions })
  }
  async function readHistory(more = false) {
    const generation = versionReadGeneration.current
    const cursor = more ? pageRef.current?.nextCursor : null
    const res = await fetch(endpoint + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''), { cache: 'no-store' })
    if (!alive.current || generation !== versionReadGeneration.current) return
    if (!res.ok) throw Error()
    const next = parseVersionPage(await res.json(), workItemId)
    if (!alive.current || generation !== versionReadGeneration.current) return
    applyHistory(next, more)
  }
  async function submit(e: FormEvent) {
    e.preventDefault()
    const saved = draftRef.current
    if (!saved || dirtyRef.current || (smeCopilot && !canFreeze)) return
    await run(async () => {
      setStatus('')
      const res = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: saved.revision }),
      })
      if (!alive.current) return
      if (!res.ok) {
        setError(res.status === 409 ? 'conflict' : res.status === 422 ? 'validationFailed' : res.status === 403 ? 'denied' : 'unavailable')
        return
      }
      const data = await res.json()
      const submitted = parseVersionDetail(data?.version, workItemId, { draftRevision: saved.revision })
      if (!alive.current) return
      const known = pageRef.current?.versions.find(v => v.id === submitted.id)
      if (known && !sameVersion(known, submitted)) throw Error()
      upsert(submitted, dirtyRef.current)
      setStatus('versionSubmitted')
      // A replay can be historical. Re-read latest rather than promoting its id.
      try { await readHistory() } catch { if (alive.current) setError('unavailable') }
    })
  }
  async function reload() {
    await run(async () => {
      const res = await fetch(base, { cache: 'no-store' })
      if (!res.ok) throw Error()
      const data = await res.json(), next = readDraft(data?.item, clientId, workItemId)
      if (!alive.current) return
      if (draftRef.current && next.revision < draftRef.current.revision) throw Error()
      draftRef.current = next; setDraft(next); setStatus('draftReloaded')
    })
  }
  async function history(more = false) { await run(() => readHistory(more)) }
  async function select(id: string) {
    if (dirtyRef.current) return
    const expected = pageRef.current?.versions.find(v => v.id === id)
    await run(async () => {
      const generation = versionReadGeneration.current
      const res = await fetch(endpoint + '/' + encodeURIComponent(id), { cache: 'no-store' })
      if (!alive.current || generation !== versionReadGeneration.current) return
      if (!res.ok) throw Error()
      const data = await res.json()
      const next = parseVersionDetail(data?.version, workItemId, { id, contentHash: expected?.contentHash, draftRevision: expected?.draftRevision })
      if (!alive.current || dirtyRef.current || generation !== versionReadGeneration.current) return
      assertVersionProgress(next, knownVersions())
      rememberTerminal(next)
      const currentPage = pageRef.current
      if (currentPage) savePage(mergeDetailDecision(currentPage, next))
      choose(next)
    })
  }
  const draftContents = <>
    {draft ? <>
      <p>{t('savedRevision', { revision: draft.revision })}</p>
      <h3 className="whitespace-pre-wrap break-words">{draft.title}</h3>
      <p className="whitespace-pre-wrap break-words">{draft.action}</p>
      <p className="whitespace-pre-wrap break-words">{draft.notes}</p>
      {!smeCopilot && <form onSubmit={submit}><button className={button} disabled={busy || anyDirty} type="submit">{t('submitVersion')}</button></form>}
    </> : <p>{t('draftUnavailable')}</p>}
    <button className={button} disabled={busy} onClick={reload}>{t('reloadDraft')}</button>
  </>
  const historyContents = <>
    {(!smeCopilot || historyAvailable) && <button className={button} disabled={busy} onClick={() => history()}>{t('reloadHistory')}</button>}
    {emptyHistory && <p>{t('noVersions')}</p>}
    <ul className="flex flex-wrap gap-3">{page?.versions.map(v => <li key={v.id}>
      <button className={button} disabled={busy || anyDirty} aria-pressed={selected?.id === v.id} onClick={() => select(v.id)}>
        {t('versionNumber', { number: v.versionNumber })} · {t(v.decision?.decision ?? 'pending')}
      </button>
    </li>)}</ul>
    {page?.nextCursor && <button className={button} disabled={busy || anyDirty} onClick={() => history(true)}>{t('moreVersions')}</button>}
  </>
  const decisionForm = decisionVersion && (dirty || (!decisionVersion.decision && decisionVersion.capabilities.canDecide)) && <DecisionForm
    key={`${endpoint}:${decisionVersion.id}:${decisionVersion.contentHash}`} version={decisionVersion} smeCopilot={smeCopilot}
    emphasize={!canFreeze && !historical} endpoint={endpoint + '/' + encodeURIComponent(decisionVersion.id) + '/decision'}
    onDirty={next => {
      if (!alive.current) return
      decisionDirtyRef.current = next; dirtyRef.current = next || deliveryDirtyRef.current; setDirty(next)
    }}
    onCompleted={value => {
      if (!alive.current || !selectedRef.current || !sameVersion(selectedRef.current, value)) return
      const confirmedValue = parseVersionDetail(value, workItemId, { id: decisionVersion.id, contentHash: decisionVersion.contentHash, draftRevision: decisionVersion.draftRevision })
      upsert(confirmedValue); setStatus('decisionRecorded')
      requestAnimationFrame(() => { if (alive.current) statusRef.current?.focus() })
    }}
  />
  const deliveryEmphasize = latestIsCurrent && !canFreeze && !historical && selected?.decision?.decision === 'approved'
  const handoff = selected?.editSpec && <HandoffPanel key={'handoff' + selected.id + selected.contentHash + (selected.decision?.decision ?? 'pending')} clientId={clientId} version={selected} smeCopilot={smeCopilot} emphasize={deliveryEmphasize} onRecordedChange={handoffRecordedChange}
    onViewManualOptions={smeCopilot ? () => {
      const details = manualDetailsRef.current
      if (details) { details.open = true; details.querySelector('summary')?.focus() }
    } : undefined} />
  const manualDelivery = selected && <DeliveryWorkspace key={selected.id + selected.contentHash} clientId={clientId} version={selected} onDirtyChange={deliveryDirtyChange} onDeliveryChange={deliveryChanged} smeCopilot={smeCopilot} emphasize={deliveryEmphasize} refreshKey={deliveryRefresh} />
  const deliveryChoice = `${clientId}:${workItemId}:${selected?.id ?? ''}:delivery`
  const downstream = selected && <>
    {smeCopilot ? <div className="space-y-3">
      <details ref={manualDetailsRef} name={deliveryChoice} className="min-w-0 space-y-3">
        <summary className="min-h-11 cursor-pointer rounded-lg border border-border px-3 py-2 font-semibold">{t('sme.manualPath')}</summary>
        {manualDelivery}
      </details>
      <details name={deliveryChoice} className="min-w-0 space-y-3">
        <summary className="min-h-11 cursor-pointer rounded-lg border border-border px-3 py-2 font-semibold">{t('sme.developerPath')}</summary>
        {handoff || <div className="space-y-2">
          <p>{t('sme.developerUnavailable')}</p>
          <a className="inline-flex min-h-11 items-center underline" href={`/${lang}/dashboard/${encodeURIComponent(clientId)}/opportunities?draft=${encodeURIComponent(workItemId)}`}>{t('sme.backToThisDraft')}</a>
        </div>}
      </details>
    </div> : <>{handoff}{manualDelivery}</>}
    <OutcomeWorkspace clientId={clientId} itemId={workItemId} versionId={selected.id} refreshKey={outcomeRefresh} smeCopilot={smeCopilot} versionSchema={selected.schemaVersion} />
  </>
  const stage = !historyAvailable ? 'unavailable' : canFreeze ? 'sme.prepare' : historical ? 'sme.historical'
    : latest?.decision?.decision === 'approved' ? 'sme.approved' : latest?.decision?.decision === 'changes_requested' ? 'sme.revise'
      : currentDecision || (!selected && latestIsCurrent) ? 'sme.review' : 'sme.wait'
  return <main className="mx-auto max-w-5xl space-y-6 p-4 text-foreground sm:p-8" aria-busy={busy}>
    <a className="inline-flex min-h-11 items-center underline" href={`/${lang}/dashboard/${encodeURIComponent(clientId)}/opportunities`}>{t('backToDrafts')}</a>
    <h1 className="text-2xl font-semibold">{t(smeCopilot ? 'sme.title' : 'title')}</h1>
    <p>{t('notDelivery')}</p>
    {!smeCopilot && <p>{t('immutableNotice')}</p>}
    {error && <p role="alert">{t(error)}</p>}
    <p role="status" tabIndex={-1} ref={statusRef}>{busy ? t('loading') : status ? t(status) : ''}</p>
    {smeCopilot ? <>
      <section className="space-y-3 rounded-xl border border-primary bg-background p-4">
        <h2 className="text-xl font-semibold">{t(stage)}</h2>
        {canFreeze && latest && <p>{t('sme.newerDraft')}</p>}
        {canFreeze && <form onSubmit={submit}><button className={primary} disabled={busy || anyDirty} type="submit">{t('submitVersion')}</button></form>}
        {!historyAvailable && <button className={primary} disabled={busy} onClick={() => history()}>{t('reloadHistory')}</button>}
        {!canFreeze && (!selected || historical) && latestIsCurrent && latest && <button className={primary} disabled={busy || anyDirty} onClick={() => select(latest.id)}>{t('sme.review')} · {t('versionNumber', { number: latest.versionNumber })}</button>}
        {latestIsCurrent && latest?.decision?.decision === 'changes_requested' && !canFreeze && <a className={(historical ? button : primary) + ' inline-flex items-center'} href={`/${lang}/dashboard/${encodeURIComponent(clientId)}/opportunities?draft=${encodeURIComponent(workItemId)}`}>{t('sme.backToThisDraft')}</a>}
        {stage === 'sme.wait' && <p>{t('sme.independentReview')}</p>}
        {viewerProfileId && latestIsCurrent && selected && selected.id === page?.latestVersionId && !selected.decision && !selected.capabilities.canDecide && <ReviewHelp
          clientId={clientId} workItemId={workItemId} versionId={selected.id} contentHash={selected.contentHash}
          viewerProfileId={viewerProfileId} submittedBy={selected.submittedBy.profileId} />}
      </section>
      <details className="space-y-3 rounded-xl border border-border p-4"><summary className="min-h-11 cursor-pointer py-2 font-semibold">{t('sme.savedDraft')}</summary>{draftContents}</details>
      <details open className="space-y-3 rounded-xl border border-border p-4"><summary className="min-h-11 cursor-pointer py-2 font-semibold">{t('sme.history')}</summary>{historyContents}</details>
    </> : <>
      <section className="space-y-3 rounded-xl border border-border p-4"><h2 className="text-xl font-semibold">{t('currentDraft')}</h2>{draftContents}</section>
      <section className="space-y-3"><h2 className="text-xl font-semibold">{t('history')}</h2>{historyContents}</section>
    </>}
    {dirty && <p>{t(smeCopilot ? 'sme.finishReview' : 'finishDecision')}</p>}
    {selected && <>
      {!latestIsCurrent && selected.versionNumber < knownFloor && <p>{t('superseded')}</p>}
      <VersionDetails version={selected} latestVersionId={latestIsCurrent ? page?.latestVersionId ?? null : null} smeCopilot={smeCopilot} />
      {smeCopilot ? <>
        {decisionForm}
        <details open={selected.decision?.decision === 'approved'} className="space-y-4 rounded-xl border border-border p-4"><summary className="min-h-11 cursor-pointer py-2 font-semibold">{t('sme.downstream')}</summary>{downstream}</details>
      </> : <>{downstream}{decisionForm}</>}
    </>}
  </main>
}
