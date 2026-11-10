'use client'

import { useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Activity, ArrowLeft, ArrowUpRight, FilePenLine, FileText, Globe2, Lock, NotebookPen, Paperclip, ScanSearch, Search, Send, Sparkles } from 'lucide-react'
import { composeSavedReply } from '@/lib/conversation-studio/reply'
import { composeBriefDraft } from '@/lib/conversation-studio/brief'
import { type StudioEvidence, type StudioEvidenceTarget, type StudioInspectorReads, type StudioOpportunities } from '@/lib/conversation-studio/types'
import { StudioReplyView } from './StudioReply'
import { StudioEvidenceInspector } from '@/components/dashboard/StudioEvidenceInspector'
import { StudioLiveReplyView } from '@/components/dashboard/StudioLiveReply'
import { StudioGscSnapshotView } from '@/components/dashboard/StudioGscSnapshot'
import { StudioDfsSnapshotView } from '@/components/dashboard/StudioDfsSnapshot'
import { StudioFirecrawlSnapshotView } from '@/components/dashboard/StudioFirecrawlSnapshot'
import { StudioSaveToDocs } from '@/components/dashboard/StudioSaveToDocs'
import { StudioTurnTrace } from '@/components/dashboard/StudioTurnTrace'
import { StudioAttachedSource } from '@/components/dashboard/StudioAttachedSource'
import type { StudioGscRead } from '@/lib/conversation-studio/gsc-types'
import type { StudioDfsRead } from '@/lib/conversation-studio/dfs-types'
import type { StudioFirecrawlRead } from '@/lib/conversation-studio/firecrawl-types'
import { extractTurnUrl } from '@/lib/conversation-studio/firecrawl-url'
import { STUDIO_PROMPT_LIMIT, type StudioAttachCandidate, type StudioLiveConfig, type StudioLiveReply } from '@/lib/conversation-studio/live-types'
import { evidenceForHomeTask, HOME_TASKS, STUDIO_FILTERS, STUDIO_HOME_TEMPLATES, type StudioFilter, type StudioHomeTemplate, type StudioSourceStatus } from '@/lib/conversation-studio/home'
import { StudioSessionProvider, useOptionalStudioSession, useStudioSession, type StudioThread, type StudioTurn } from '@/components/dashboard/StudioSession'
import Link from 'next/link'
import './conversation-studio.css'

const templateIcons = { opportunity: Search, improve: FilePenLine, brief: NotebookPen, competitors: ScanSearch, pulse: Activity, report: FileText }
const THREAD_TITLE_LIMIT = 200

/** Server caps thread titles at 200 characters; keep the full prompt in `goal`. */
function boundedTitle(value: string): string {
  if (value.length <= THREAD_TITLE_LIMIT) return value
  const clipped = value.slice(0, THREAD_TITLE_LIMIT).replace(/[\uD800-\uDBFF]$/u, '')
  const wordEnd = clipped.lastIndexOf(' ')
  return wordEnd > 0 ? clipped.slice(0, wordEnd) : clipped
}

export function StudioThreadHeader({ thread, attachment, onHome, originTitle, onOpenOrigin }: { thread: Pick<StudioThread, 'title' | 'goal' | 'week' | 'kind' | 'sourceTitle' | 'saveState' | 'visibility' | 'branchOf'>; attachment?: StudioAttachCandidate | null; onHome: () => void; originTitle?: string | null; onOpenOrigin?: () => void }) {
  const t = useTranslations('conversationStudio')
  return <header className="space-y-3">
    <button type="button" onClick={onHome} className="as-button inline-flex items-center gap-2 px-3"><ArrowLeft className="size-4" aria-hidden="true" />{t('title')}</button>
    <div className="as-section-heading"><p className="as-eyebrow">{t(thread.kind === 'brief' ? 'briefEyebrow' : 'discussionEyebrow')}</p><span className="as-badge">{t(thread.saveState === 'persisted' ? 'privateLabel' : 'temporaryLabel')}</span></div>
    <h1 className="[overflow-wrap:anywhere]">{thread.title}</h1>
    {thread.branchOf && (originTitle && onOpenOrigin
      ? <button type="button" onClick={onOpenOrigin} className="as-button inline-flex min-h-11 items-center gap-2 px-3 text-sm">{t('branchedFrom', { title: originTitle })}</button>
      : <span className="as-badge">{t('branchedFromUnknown')}</span>)}
    {thread.branchOf && <p className="as-muted as-small [overflow-wrap:anywhere]">{thread.goal}</p>}
    <div className="flex flex-wrap gap-2" aria-label={t('threadScope')}>
      <span className="as-badge">{t('localeBadge')}</span>
      {thread.week && <span className="as-badge">{t('savedWeek', { week: thread.week })}</span>}
      {attachment && <span className="as-badge">{t('attach.badge')} · {attachment.label}</span>}
    </div>
    {thread.sourceTitle && <div className="as-note space-y-1 [overflow-wrap:anywhere]"><p>{t('briefContext', { title: thread.sourceTitle })}</p><p>{thread.goal}</p><p>{t('briefTemporary')}</p></div>}
  </header>
}

/** Saved evidence is local; the optional B2 transport sends one question only. */
type Props = { brandName: string; evidence: StudioEvidence; clientId?: string; opportunities?: StudioOpportunities; live?: StudioLiveConfig; sourceStatus?: StudioSourceStatus; inspector?: StudioInspectorReads; attachCandidates?: StudioAttachCandidate[] | null
  /** R3 A1 staff view: saved evidence only. No provider, Google or LIVE call, no attach, nothing saved. */
  staffView?: boolean }
export function ConversationStudio(props: Props) {
  const session = useOptionalStudioSession()
  return session ? <StudioConversation {...props} embedded /> : <StudioSessionProvider key={props.clientId ?? props.brandName} clientId={props.clientId}><StudioConversation {...props} /></StudioSessionProvider>
}
function StudioConversation({ brandName, evidence, clientId, opportunities, live, sourceStatus = 'unavailable', inspector = { documents: null, searchConsole: null }, attachCandidates = null, embedded = false, staffView = false }: Props & { embedded?: boolean }) {
  const t = useTranslations('conversationStudio')
  const language = useLocale()
  const [platforms, setPlatforms] = useState<string[]>(live?.platforms.slice(0, 1) ?? [])
  const [liveExhausted, setLiveExhausted] = useState(false)
  const [attachment, setAttachment] = useState<StudioAttachCandidate | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const { busy, isInFlight, beginLive, endLive, threads, setThreads, activeId, navigationVersion, setActiveId, selectThread, saveThread, saveTurn, saveLive, feedback, setFeedback, newDraft, setNewDraft, newTemplate, setNewTemplate, allocateId, allocateThreadId, hydrated, readFailed } = useStudioSession()
  const [filter, setFilter] = useState<StudioFilter>('all')
  const [inspection, setInspection] = useState<{ navigationVersion: number; turnId: number; target: StudioEvidenceTarget; trigger: HTMLButtonElement } | null>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const previousNavigation = useRef(navigationVersion)
  const focusBriefStart = useRef(false)
  const current = threads.find(thread => thread.id === activeId)
  // A branch's origin may no longer be in this list (archived, or another member's
  // private thread that was unshared); then the origin is shown without a link.
  const branchOrigin = current?.branchOf ? threads.find(thread => thread.id === current.branchOf!.threadId) ?? null : null
  const inspectedTurn = inspection?.navigationVersion === navigationVersion ? current?.turns.find(turn => turn.id === inspection.turnId) : undefined
  const draft = current?.draft ?? newDraft
  const home = !current
  const basePath = clientId ? `/${language}/dashboard/${encodeURIComponent(clientId)}` : null

  useLayoutEffect(() => {
    if (previousNavigation.current !== navigationVersion || activeId !== null) {
      composer.current?.focus()
      if (focusBriefStart.current && composer.current) {
        composer.current.setSelectionRange(0, 0)
        composer.current.scrollTop = 0
        focusBriefStart.current = false
      }
    }
    previousNavigation.current = navigationVersion
  }, [activeId, navigationVersion])

  function openHome() { setInspection(null); setActiveId(null) }
  function openThread(id: string) { setInspection(null); selectThread(id) }

  function branchThread(source: StudioThread, turn: StudioTurn) {
    // Lineage needs a saved origin turn; a brand-new unsaved turn has no server id yet.
    if (source.saveState !== 'persisted' || turn.saveState !== 'saved' || !turn.serverId) {
      setFeedback({ id: turn.id, threadId: source.id, key: 'branchUnavailable' })
      return
    }
    const id = allocateThreadId()
    const title = boundedTitle(t('branchTitle', { title: source.title }))
    const summary = [t(turn.reply.status === 'evidenced' ? 'evidence.savedSummary' : 'evidence.insufficient'),
      t(turn.reply.template === 'competitors' ? 'evidence.comparisonLimit' : turn.reply.template ? 'evidence.summaryScope' : 'evidence.questionLimit'),
      t('honesty.searchDemandPending')].join(' ')
    const seed = composeBriefDraft({ goal: source.goal, prompt: turn.prompt, summary }, context => t('branchContextPrompt', context))
    const branchOf = { threadId: source.id, turnId: turn.serverId }
    const kind = source.kind
    const sourceTitle = kind === 'brief' ? source.title : undefined
    // The new thread keeps the origin's skill (when the turn has one) and records
    // where it came from; no turn is copied.
    setThreads(previous => [{ id, title, goal: source.goal, week: source.week, kind, sourceTitle, turns: [], draft: seed, template: turn.task ?? null, saveState: 'unsaved', turnsLoaded: true, skill: turn.task ?? null, visibility: 'private', pinned: false, archived: false, mine: true, branchOf }, ...previous])
    const saving = saveThread(id, { kind, title, goal: source.goal, week: source.week, sourceTitle, branchOf })
    focusBriefStart.current = true
    openThread(id)
    void saving.then(saved => { if (saved) setFeedback({ id: turn.id, threadId: saved, key: 'branchOpened' }) })
  }

  function updateDraft(value: string, template: StudioHomeTemplate | null = null) {
    if (activeId === null) { setNewDraft(value); setNewTemplate(template) }
    else setThreads(previous => previous.map(thread => thread.id === activeId ? { ...thread, draft: value, template } : thread))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const prompt = draft.trim()
    if (!prompt || isInFlight()) return
    const askLive = Boolean(live && !staffView && live.cap > 0 && !liveExhausted && platforms.length && clientId)
    if (prompt.length > STUDIO_PROMPT_LIMIT) return
    setFeedback(null)
    const id = current?.id ?? allocateThreadId()
    const task = current ? current.template : newTemplate
    const title = boundedTitle(task ? t(`templates.${task}.label`) : prompt)
    const kind = task === 'brief' ? 'brief' : 'research'
    // A staff view reads no provider or Google data: those routes bill and scope to the viewer's own account.
    const wantsGsc = Boolean(clientId && !staffView && sourceStatus === 'bound')
    const wantsDfs = Boolean(clientId && !staffView)
    // One explicit public URL per turn; a turn without one never calls Firecrawl.
    const scrapeUrl = clientId && !staffView ? extractTurnUrl(prompt) : null
    const turn: StudioTurn = { id: allocateId(), prompt, task, reply: composeSavedReply(prompt, task ? HOME_TASKS[task].capability : null, evidenceForHomeTask(evidence, task), opportunities), ...(attachment ? { attached: { label: attachment.label, versionNumber: attachment.versionNumber } } : {}), ...(askLive ? { live: { pending: true } } : {}), ...(wantsGsc ? { gsc: { pending: true } } : {}), ...(wantsDfs ? { dfs: { pending: true } } : {}), ...(scrapeUrl ? { firecrawl: { pending: true } } : {}) }
    if (current) {
      setThreads(previous => previous.map(thread => thread.id === activeId ? { ...thread, turns: [...thread.turns, turn], draft: '', template: null } : thread))
    } else {
      setThreads(previous => [{ id, title, goal: prompt, week: evidence.week, kind, turns: [turn], draft: '', template: null, saveState: 'unsaved', turnsLoaded: true, skill: task, visibility: 'private', pinned: false, archived: false, mine: true, branchOf: null }, ...previous])
      void saveThread(id, { kind, title, goal: prompt, week: evidence.week, sourceTitle: null })
      openThread(id)
      setNewDraft('')
      setNewTemplate(null)
    }
    composer.current?.focus()
    function applyGsc(next: StudioGscRead) {
      setThreads(previous => previous.map(thread => thread.turns.some(item => item.id === turn.id)
        ? { ...thread, turns: thread.turns.map(item => item.id === turn.id ? { ...item, gsc: next } : item) }
        : thread))
    }
    function applyDfs(next: StudioDfsRead) {
      setThreads(previous => previous.map(thread => thread.turns.some(item => item.id === turn.id)
        ? { ...thread, turns: thread.turns.map(item => item.id === turn.id ? { ...item, dfs: next } : item) }
        : thread))
    }
    function applyFirecrawl(next: StudioFirecrawlRead) {
      setThreads(previous => previous.map(thread => thread.turns.some(item => item.id === turn.id)
        ? { ...thread, turns: thread.turns.map(item => item.id === turn.id ? { ...item, firecrawl: next } : item) }
        : thread))
    }
    // On-demand only: never on page load. Saved and LIVE turns both ask once.
    if (wantsGsc && clientId) {
      void (async () => {
        try {
          const response = await fetch(`/api/dashboard/clients/${encodeURIComponent(clientId)}/studio/search-console`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(12_000),
          })
          const data = await response.json().catch(() => null) as { snapshot?: StudioGscRead['snapshot']; error?: string } | null
          applyGsc(response.ok && data?.snapshot ? { snapshot: data.snapshot } : { error: data?.error ?? 'STUDIO_UNAVAILABLE' })
        } catch {
          applyGsc({ error: 'STUDIO_UNAVAILABLE' })
        }
      })()
    }
    if (wantsDfs && clientId) {
      void (async () => {
        try {
          const response = await fetch(`/api/dashboard/clients/${encodeURIComponent(clientId)}/studio/dataforseo`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
            body: JSON.stringify({ keyword: prompt }), signal: AbortSignal.timeout(16_000),
          })
          const data = await response.json().catch(() => null) as { snapshot?: StudioDfsRead['snapshot']; error?: string } | null
          applyDfs(response.ok && data?.snapshot ? { snapshot: data.snapshot } : { error: data?.error ?? 'STUDIO_UNAVAILABLE' })
        } catch {
          applyDfs({ error: 'STUDIO_UNAVAILABLE' })
        }
      })()
    }
    if (scrapeUrl && clientId) {
      void (async () => {
        try {
          const response = await fetch(`/api/dashboard/clients/${encodeURIComponent(clientId)}/studio/firecrawl`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
            body: JSON.stringify({ url: scrapeUrl }), signal: AbortSignal.timeout(20_000),
          })
          const data = await response.json().catch(() => null) as { snapshot?: StudioFirecrawlRead['snapshot']; error?: string } | null
          applyFirecrawl(response.ok && data?.snapshot ? { snapshot: data.snapshot } : { error: data?.error ?? 'STUDIO_UNAVAILABLE' })
        } catch {
          applyFirecrawl({ error: 'STUDIO_UNAVAILABLE' })
        }
      })()
    }
    const persist = saveTurn(id, turn.id, { prompt, task, reply: turn.reply, attached: turn.attached ?? null })
      .then(result => {
        if (result.ok) setFeedback({ id: turn.id, threadId: result.threadId, key: 'followUpSent' })
        return result
      })
    if (askLive) {
      beginLive()
      let result: NonNullable<StudioTurn['live']>
      try {
        const response = await fetch(`/api/dashboard/clients/${encodeURIComponent(clientId!)}/studio/answer`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
          body: JSON.stringify({ prompt, platforms, language, ...(attachment ? { attachedSourceId: attachment.id } : {}) }), signal: AbortSignal.timeout(25_000),
        })
        const data = await response.json()
        if (response.ok) {
          const reply = data as StudioLiveReply
          result = { reply }
          if (reply.quota.remaining === 0) setLiveExhausted(true)
        } else {
          result = { error: data.error ?? 'STUDIO_UNAVAILABLE' }
          if (data.error === 'STUDIO_QUOTA_EXCEEDED') setLiveExhausted(true)
        }
      } catch { result = { error: 'STUDIO_UNAVAILABLE' } }
      setThreads(previous => previous.map(thread => thread.turns.some(item => item.id === turn.id) ? { ...thread, turns: thread.turns.map(item => item.id === turn.id ? { ...item, live: result } : item) } : thread))
      const saved = await persist
      if (saved.ok) await saveLive(saved.threadId, saved.position, result.reply ? { reply: result.reply } : { error: result.error ?? 'STUDIO_UNAVAILABLE' })
      endLive()
    } else {
      void persist
    }
  }

  const composerForm = <form onSubmit={submit} className="as-composer space-y-3">
    <label htmlFor="studio-composer" className="as-muted as-small block font-semibold">{t(home ? 'composerLabel' : 'followUpLabel')}</label>
    <textarea ref={composer} id="studio-composer" value={draft} maxLength={STUDIO_PROMPT_LIMIT} onChange={event => updateDraft(event.target.value)} rows={4} placeholder={t(home ? 'composerPlaceholder' : 'followUpPlaceholder')} aria-describedby="studio-composer-help" className="block w-full min-w-0 resize-y" />
    <div className="as-composer-footer">
      <div className="as-composer-tools">
        {(current ? current.template : newTemplate) && <>
          <span className="as-badge">{t('skillChip.label', { skill: t(`templates.${(current ? current.template : newTemplate)!}.label`) })}</span>
          <button type="button" onClick={() => updateDraft(draft, null)} className="as-button px-2 text-sm">{t('skillChip.clear')}</button>
        </>}
        {!staffView && <button type="button" onClick={() => setPickerOpen(open => !open)} disabled={!clientId} aria-expanded={pickerOpen} aria-controls="studio-attach-picker" className="as-button inline-flex items-center gap-2 px-3 disabled:opacity-60"><Paperclip className="size-4" aria-hidden="true" />{t('chooseDocuments')}</button>}
        {attachment && <>
          <span className="as-badge">{t('attach.badge')} · {attachment.label}</span>
          <button type="button" onClick={() => setAttachment(null)} className="as-button px-2 text-sm">{t('attach.clear')}</button>
        </>}
        <span className="as-badge">{t('localeBadge')}</span>
        {live && <details className="as-platform-picker">
          <summary>{t('live.selector', { count: platforms.length })}</summary>
          <fieldset className="space-y-2" disabled={busy || live.cap === 0 || liveExhausted}>
            <legend className="as-muted as-small font-semibold">{t('live.platforms')}</legend>
            <div className="flex flex-wrap gap-2">{live.platforms.map(platform => <label key={platform} className="as-platform flex items-center gap-2 px-3">
              <input type="checkbox" checked={platforms.includes(platform)} onChange={event => setPlatforms(previous => event.target.checked ? [...previous, platform] : previous.filter(item => item !== platform))} />{platform}
            </label>)}</div>
          </fieldset>
        </details>}
      </div>
      <button type="submit" disabled={!draft.trim() || busy || Boolean(live && live.cap > 0 && live.platforms.length && !platforms.length)} className="as-button as-primary inline-flex items-center justify-center gap-2 px-4 font-semibold disabled:opacity-50">
        <Send className="size-4" aria-hidden="true" />{t(home ? 'send' : 'followUpSend')}
      </button>
    </div>
    {pickerOpen && <div id="studio-attach-picker" role="group" aria-label={t('attach.pickerLabel')} className="as-note space-y-2">
      {attachCandidates === null
        ? <p>{t('attach.unavailable')}</p>
        : attachCandidates.length === 0
          ? <p>{t('attach.empty')}{basePath && <> <Link href={`${basePath}/sources`} className="underline">{t('attach.manageSources')}</Link></>}</p>
          : <ul className="space-y-2">{attachCandidates.map(candidate => <li key={candidate.id}>
            <button type="button" aria-pressed={attachment?.id === candidate.id} onClick={() => { setAttachment(candidate); setPickerOpen(false) }} className="as-button flex w-full items-center justify-between gap-3 px-3 text-left">
              <span className="[overflow-wrap:anywhere]">{candidate.label}</span>
              <span className="as-muted as-small shrink-0">{t('attach.version', { version: candidate.versionNumber })}</span>
            </button>
          </li>)}</ul>}
    </div>}
    {!live && attachment && <p className="as-muted as-small">{t('attach.savedNote')}</p>}
    {!live && <p className="as-note">{t('featureShellNote')}</p>}
    {live && <p className="as-muted as-small">{t(liveExhausted ? 'live.exhausted' : !live.platforms.length ? 'live.upgrade' : live.cap === 0 ? 'live.disabled' : 'live.usesQuota', { count: platforms.length, cap: live.cap })}</p>}
    <p id="studio-composer-help" className="as-muted as-small">{t(live ? 'live.composerHelp' : 'composerHelp')}</p>
  </form>

  const scopeNote = <details className="as-note as-disclosure">
    <summary>{t('scopeNote')}</summary>
    <div className="space-y-2 pb-3">
      <p>{t(live ? 'live.notice' : 'savedNotice')}</p>
      {live && <><p>{t('live.unverified')}</p><p>{t('live.temporaryCap')}</p></>}
      <p>{t('honesty.noEstimatedNumbers')}</p>
      <p>{t('honesty.mentionsCoverage')}</p>
      <p>{t('honesty.missingIsNotZero')}</p>
    </div>
  </details>

  return (
    <main id={embedded ? undefined : "aiso-studio"} className={embedded ? "as-page space-y-6" : "mx-auto w-full min-w-0 max-w-6xl space-y-6"}>
      {!embedded && <div className="as-topbar">
        <p className="as-breadcrumb"><span>{brandName}</span><span aria-hidden="true">/</span><span>{t(home ? 'title' : 'discussionTitle')}</span></p>
        <span className="as-locale"><Globe2 className="size-3.5 shrink-0" aria-hidden="true" />{t('localeLabel')}</span>
      </div>}
      {home ? <div id="studio-home" className="as-home space-y-6">
        <header className="space-y-3">
          <p className="as-eyebrow">{t('heroEyebrow')}</p>
          <h1>{t('heroTitle')}</h1>
          <p className="as-muted">{t('description')}</p>
        </header>
        {composerForm}
        <div className="as-source-bar" aria-label={t('savedDataLabel')}>
          <span className="inline-flex items-center gap-2"><span className="as-source-dot" aria-hidden="true" />{t('savedDataLabel')}</span>
          <span className={sourceStatus === 'bound' ? 'as-muted' : 'as-source-status'}>{t(`sources.${sourceStatus}`)}</span>
          <span className="as-muted">{t('sources.notQueried')}</span>
          {embedded && basePath && !staffView && <Link href={`${basePath}/studio/connections`} className="underline">{t('manageConnections')}</Link>}
        </div>
        <section aria-labelledby="studio-templates-title" className="space-y-3">
          <div className="as-section-heading">
            <h2 id="studio-templates-title">{t('templatesTitle')}</h2>
            <p className="as-muted as-small">{t('templatesDescription')}</p>
          </div>
          <div className="as-filters" role="group" aria-label={t('templatesTitle')}>
            {STUDIO_FILTERS.map(key => <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)} className="as-filter">{t(`filters.${key}`)}</button>)}
          </div>
          <div className="as-template-grid">
            {STUDIO_HOME_TEMPLATES.filter(key => filter === 'all' || HOME_TASKS[key].category === filter).map(key => {
              const Icon = templateIcons[key]
              return <button key={key} type="button" aria-labelledby={`studio-template-${key}`} aria-describedby={`studio-template-${key}-description`} onClick={() => { updateDraft(t(`templates.${key}.prompt`), key); composer.current?.focus() }} className="as-template space-y-2 text-left">
                <span className="flex items-start gap-2 font-semibold"><Icon className="as-blue mt-0.5 size-4 shrink-0" aria-hidden="true" /><span id={`studio-template-${key}`}>{t(`templates.${key}.label`)}</span></span>
                <span id={`studio-template-${key}-description`} className="block space-y-2 as-muted">
                  <span className="block">{t(`templates.${key}.description`)}</span>
                  <span className="as-small block">{t(`templates.${key}.output`)}</span>
                  <span className="as-small block">{t(`templates.${key}.limit`)}</span>
                </span>
              </button>
            })}
          </div>
        </section>
        <section aria-labelledby="studio-continue-title" className="space-y-3">
          <div className="as-section-heading"><h2 id="studio-continue-title">{t('continueTitle')}</h2>{embedded && basePath && <Link href={`${basePath}/studio/threads`} className="underline">{t('allThreads')}</Link>}</div>
          {readFailed ? <p className="as-note">{t('readUnavailable')}</p> : !hydrated ? <p className="as-muted" aria-busy="true">{t('loadingThreads')}</p> : threads.length === 0 ? <p className="as-muted">{t('threadsEmpty')}</p> : <ul className="as-continue-list">
            {threads.map(thread => <li key={thread.id}>
              <button type="button" onClick={() => openThread(thread.id)} className="as-thread flex w-full items-center justify-between gap-3 text-left">
                <span className="min-w-0"><span className="block truncate">{thread.title}</span><span className="as-muted as-small block truncate">{thread.goal}</span><span className="as-muted as-small">{t(thread.saveState !== 'persisted' ? 'temporaryLabel' : thread.visibility === 'shared' ? 'sharedLabel' : 'privateLabel')}</span></span>
                <ArrowUpRight className="size-4 shrink-0" aria-hidden="true" />
              </button>
            </li>)}
          </ul>}
        </section>
        {scopeNote}
      </div> : <div id="studio-discussion" className={`space-y-5${inspectedTurn ? ' as-inspector-open' : ''}`}>
        <StudioThreadHeader thread={current} attachment={attachment} onHome={openHome} originTitle={branchOrigin?.title ?? null} onOpenOrigin={branchOrigin ? () => openThread(branchOrigin.id) : undefined} />
        {current.saveState === 'failed' && <p role="alert" className="as-note">{t('saveFailed')}</p>}
        <h2 className="sr-only">{t('conversationLabel')}</h2>
        <div className="as-discussion-grid">
        <div role="log" aria-label={t('conversationLabel')} aria-live="polite" className="as-conversation space-y-8">
          {!current.turnsLoaded && !current.turnsError && <p className="as-muted as-small">{t('loadingThreads')}</p>}
          {current.turnsError && <p className="as-note">{t('readUnavailable')}</p>}
          {current.turns.map(({ id, prompt, reply, task, live: liveTurn, gsc, dfs, firecrawl, attached, saveState: turnSaveState, position }, index) => <div key={id} className="space-y-5">
            <div className="as-question p-4">
              <p className="as-muted as-small mb-2 font-semibold">{t('youLabel')}</p>
              <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{prompt}</p>
              {attached && <p className="as-muted as-small mt-2">{t('attach.badge')} · {attached.label}{!live ? ` — ${t('attach.savedNote')}` : ''}</p>}
            </div>
            <div className="as-answer space-y-3">
            <p className="as-answer-label"><Sparkles className="size-4" aria-hidden="true" />{t('answerLabel')}</p>
            <StudioTurnTrace attached={attached} gsc={gsc} dfs={dfs} firecrawl={firecrawl} live={liveTurn} />
            <StudioAttachedSource attached={attached} liveAttachment={liveTurn?.reply?.attachment ?? null} documents={inspector.documents} />
            {task && <div className="as-note space-y-1">
              <p>{t(`templates.${task}.limit`)}</p>
            </div>}
            <div className="min-w-0 space-y-4">
              <StudioReplyView clientId={clientId} readOnly={staffView || !current.mine} reply={reply} evidence={evidenceForHomeTask(evidence, task)} id={`studio-${current.id}-${index}`} number={index + 1} liveEnabled={Boolean(live)} gsc={gsc} dfs={dfs} firecrawl={firecrawl} onBranchBrief={turnSaveState === 'saved' ? () => branchThread(current, current.turns[index]) : undefined} onOpenEvidence={(trigger, target = 'saved') => setInspection({ navigationVersion, turnId: id, target, trigger })} />
              {liveTurn && <StudioLiveReplyView {...liveTurn} number={index + 1} onOpenEvidence={(trigger, target = 'saved') => setInspection({ navigationVersion, turnId: id, target, trigger })} />}
              <StudioGscSnapshotView gsc={gsc} />
              <StudioDfsSnapshotView dfs={dfs} />
              <StudioFirecrawlSnapshotView firecrawl={firecrawl} />
              {/* Only a turn saved to the member's own thread can be saved to their Drive. */}
              {clientId && current.saveState === 'persisted' && turnSaveState === 'saved' && position !== undefined
                && <StudioSaveToDocs clientId={clientId} threadId={current.id} position={position} />}
            </div>
            </div>
          </div>)}
        </div>
        {inspection && inspectedTurn && <StudioEvidenceInspector reply={inspectedTurn.reply} evidence={evidenceForHomeTask(evidence, inspectedTurn.task)} liveReply={inspectedTurn.live?.reply} liveEnabled={Boolean(live)} gsc={inspectedTurn.gsc} dfs={inspectedTurn.dfs} firecrawl={inspectedTurn.firecrawl} reads={inspector} sourceStatus={sourceStatus} prompt={inspectedTurn.prompt} target={inspection.target} trigger={inspection.trigger} onClose={() => setInspection(null)} />}
        </div>
        {current.mine ? composerForm : <p className="as-note">{t('sharedReadOnlyBody')}</p>}
        {scopeNote}
      </div>}
      <div className="as-toast" role="status" aria-live="polite" aria-atomic="true">{feedback && feedback.threadId === activeId && <span key={feedback.id}>{t(feedback.key)}</span>}</div>
      <footer className="as-divider space-y-2 pt-4">
        <p className="as-small flex items-center gap-2 font-semibold"><Lock className="size-4 shrink-0" aria-hidden="true" />{t(current && !current.mine ? 'sharedLabel' : 'privateLabel')}</p>
        <p className="as-muted as-small">{t('privacyBody')}</p>
      </footer>
    </main>
  )
}
