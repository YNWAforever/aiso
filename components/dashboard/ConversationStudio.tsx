'use client'

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Activity, ArrowLeft, ArrowUpRight, Ellipsis, FilePenLine, FileText, Globe2, Lock, NotebookPen, Paperclip, ScanSearch, Search, Send, Sparkles } from 'lucide-react'
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
import { buildExecutionPreview, studioResearchReads } from '@/lib/conversation-studio/execution-preview'
import { STUDIO_PROMPT_LIMIT, type StudioAttachCandidate, type StudioLiveConfig, type StudioLiveReply } from '@/lib/conversation-studio/live-types'
import { requestStudioAnswer } from '@/lib/conversation-studio/stream-client'
import { evidenceForHomeTask, HOME_TASKS, STUDIO_FILTERS, STUDIO_HOME_TEMPLATES, type StudioFilter, type StudioHomeTemplate, type StudioSourceStatus } from '@/lib/conversation-studio/home'
import { skillForTask } from '@/lib/conversation-studio/skills'
import { useStudioActions } from '@/components/dashboard/StudioActionPanel'
import type { PlanFeatures } from '@/lib/plans/catalog'
import { StudioSessionProvider, useOptionalStudioSession, useStudioSession, type StudioThread, type StudioTurn } from '@/components/dashboard/StudioSession'
import { relativeTime } from '@/lib/conversation-studio/thread-list'
import type { StudioThreadUpdateInput } from '@/lib/conversation-studio/threads-types'
import Link from 'next/link'
import './conversation-studio.css'

const templateIcons = { opportunity: Search, improve: FilePenLine, brief: NotebookPen, competitors: ScanSearch, pulse: Activity, report: FileText }
// SME copilot landing keeps four outcomes visible and nests the rest, so the
// home screen stays under the ~8-control budget the audit measured.
const COPILOT_PRIMARY: StudioHomeTemplate[] = ['pulse', 'improve', 'opportunity', 'report']
const COPILOT_SECONDARY: StudioHomeTemplate[] = ['brief', 'competitors']
const THREAD_TITLE_LIMIT = 200

/** Server caps thread titles at 200 characters; keep the full prompt in `goal`. */
function boundedTitle(value: string): string {
  if (value.length <= THREAD_TITLE_LIMIT) return value
  const clipped = value.slice(0, THREAD_TITLE_LIMIT).replace(/[\uD800-\uDBFF]$/u, '')
  const wordEnd = clipped.lastIndexOf(' ')
  return wordEnd > 0 ? clipped.slice(0, wordEnd) : clipped
}

export function StudioThreadHeader({ thread, attachment, onHome, originTitle, onOpenOrigin, onUpdate, onArchived }: {
  thread: Pick<StudioThread, 'title' | 'goal' | 'week' | 'kind' | 'sourceTitle' | 'saveState' | 'visibility' | 'turnCount' | 'updatedAt' | 'branchOf'> & { pinned?: boolean; mine?: boolean }
  attachment?: StudioAttachCandidate | null
  onHome: () => void
  originTitle?: string | null
  onOpenOrigin?: () => void
  onUpdate?: (patch: StudioThreadUpdateInput) => Promise<boolean>
  onArchived?: () => void
}) {
  const t = useTranslations('conversationStudio')
  const lang = useLocale()
  const [renaming, setRenaming] = useState(false)
  const [titleDraft, setTitleDraft] = useState(thread.title)
  const [actionFailed, setActionFailed] = useState(false)
  const when = relativeTime(thread.updatedAt, new Date(), lang)
  async function patch(next: StudioThreadUpdateInput) {
    if (!onUpdate) return false
    setActionFailed(false)
    const ok = await onUpdate(next)
    if (!ok) setActionFailed(true)
    return ok
  }
  return <header className="space-y-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <button type="button" onClick={onHome} className="as-button inline-flex items-center gap-2 px-3"><ArrowLeft className="size-4" aria-hidden="true" />{t('title')}</button>
      {onUpdate && thread.mine && <details className="as-thread-menu">
        <summary className="as-button inline-flex items-center justify-center px-3" aria-label={t('threadActions.label')}><Ellipsis className="size-4" aria-hidden="true" /></summary>
        <div role="group" aria-label={t('threadActions.label')} className="as-thread-menu-panel">
          <button type="button" aria-pressed={thread.pinned} onClick={() => void patch({ pinned: !thread.pinned })}>{t(thread.pinned ? 'threadActions.unpin' : 'threadActions.pin')}</button>
          <button type="button" aria-pressed={thread.visibility === 'shared'} onClick={() => void patch({ visibility: thread.visibility === 'shared' ? 'private' : 'shared' })}>{t(thread.visibility === 'shared' ? 'threadActions.unshare' : 'threadActions.share')}</button>
          <button type="button" onClick={() => { setRenaming(true); setTitleDraft(thread.title); setActionFailed(false) }}>{t('threadActions.rename')}</button>
          <button type="button" onClick={() => void patch({ archived: true }).then(ok => { if (ok) onArchived?.() })}>{t('threadActions.archive')}</button>
        </div>
      </details>}
      {onUpdate && !thread.mine && <span className="as-badge">{t('sharedReadOnlyBody')}</span>}
    </div>
    {actionFailed && <p role="alert" className="as-note">{t('threadActions.failed')}</p>}
    {renaming && <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); const title = titleDraft.trim(); if (!title) return; void patch({ title }).then(ok => { if (ok) setRenaming(false) }) }}>
      <label className="min-w-0 flex-1 space-y-1 text-sm"><span className="as-muted as-small block font-semibold">{t('threadActions.rename')}</span><input className="as-search block w-full min-w-0" value={titleDraft} maxLength={200} onChange={event => setTitleDraft(event.target.value)} autoFocus /></label>
      <button type="submit" className="as-button as-primary inline-flex min-h-11 items-center px-3 text-sm" disabled={!titleDraft.trim()}>{t('threadActions.save')}</button>
      <button type="button" className="as-button inline-flex min-h-11 items-center px-3 text-sm" onClick={() => setRenaming(false)}>{t('threadActions.cancel')}</button>
    </form>}
    <div className="as-section-heading"><p className="as-eyebrow">{t(thread.kind === 'brief' ? 'briefEyebrow' : 'discussionEyebrow')}</p><div className="flex flex-wrap gap-2"><span className="as-badge">{t(thread.saveState === 'persisted' ? 'privateLabel' : thread.saveState === 'failed' ? 'saveUnknownLabel' : 'temporaryLabel')}</span>{thread.pinned && <span className="as-badge">{t('pinnedLabel')}</span>}{thread.visibility === 'shared' && <span className="as-badge">{t('sharedLabel')}</span>}</div></div>
    <h1 className="as-thread-heading" title={thread.title}>{thread.title}</h1>
    {(when || thread.turnCount) && <p className="as-muted as-small">{thread.turnCount ? `${t('turnCount', { count: thread.turnCount })}${when ? ' · ' : ''}` : ''}{when}</p>}
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
  staffView?: boolean
  /** A question carried in from the Today composer; prefills the home draft only. */
  initialDraft?: string
  /** Approved SME copilot IA: question-first landing and one-tap skills. */
  smeCopilot?: boolean
  /** Slice 4 action skills: the brand's domain (scan) and plan features (gates). */
  brandDomain?: string | null
  features?: PlanFeatures }
export function ConversationStudio(props: Props) {
  const session = useOptionalStudioSession()
  return session ? <StudioConversation {...props} embedded /> : <StudioSessionProvider key={props.clientId ?? props.brandName} clientId={props.clientId} initialDraft={props.initialDraft}><StudioConversation {...props} /></StudioSessionProvider>
}
function StudioConversation({ brandName, evidence, clientId, opportunities, live, sourceStatus = 'unavailable', inspector = { documents: null, searchConsole: null }, attachCandidates = null, embedded = false, staffView = false, smeCopilot = false, brandDomain = null, features, initialDraft = '' }: Props & { embedded?: boolean }) {
  const t = useTranslations('conversationStudio')
  const language = useLocale()
  const [platforms, setPlatforms] = useState<string[]>(live?.platforms.slice(0, 1) ?? [])
  const [liveExhausted, setLiveExhausted] = useState(false)
  const [attachment, setAttachment] = useState<StudioAttachCandidate | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const { busy, isInFlight, beginLive, endLive, threads, setThreads, activeId, navigationVersion, setActiveId, selectThread, saveThread, saveTurn, refreshThread, refreshingThreadId, selectionError, feedback, setFeedback, newDraft, setNewDraft, newTemplate, setNewTemplate, allocateId, allocateThreadId, hydrated, readFailed, updateThread } = useStudioSession()
  const [filter, setFilter] = useState<StudioFilter>('all')
  const [lastThreadId, setLastThreadId] = useState<string | null>(null)
  const lastThreadKey = clientId ? `aiso:studio:last-thread:${clientId}` : null
  const [inspection, setInspection] = useState<{ navigationVersion: number; turnId: number; target: StudioEvidenceTarget; trigger: HTMLButtonElement } | null>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const previousNavigation = useRef(navigationVersion)
  const focusBriefStart = useRef(false)
  const current = threads.find(thread => thread.id === activeId)
  const currentId = current?.id
  const currentSaveState = current?.saveState
  const currentMine = current?.mine
  const conversationPending = Boolean(current?.turns.some(turn => turn.live?.pending || turn.answerState === 'pending'))
  const carriedDraft = useRef('')
  const conversationEnd = useRef<HTMLDivElement>(null)
  const answerAbort = useRef<AbortController | null>(null)
  const stopRequested = useRef(false)

  useEffect(() => {
    if (!initialDraft || carriedDraft.current === initialDraft) return
    const start = setTimeout(() => {
      carriedDraft.current = initialDraft
      if (activeId === null) setNewDraft(previous => previous || initialDraft)
    }, 0)
    return () => clearTimeout(start)
  }, [initialDraft, activeId, setNewDraft])

  // Remember the last saved discussion this member opened, so landing can offer
  // one-tap resume even after the sidebar's Studio link drops `?thread=`.
  useEffect(() => {
    if (!lastThreadKey) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe mount gate: last-thread lives only in this browser
    try { setLastThreadId(window.localStorage.getItem(lastThreadKey)) } catch { /* Private mode: resume card simply stays hidden. */ }
  }, [lastThreadKey])
  useEffect(() => {
    if (!lastThreadKey || !currentId || currentSaveState !== 'persisted' || !currentMine) return
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(currentId)) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors client-only navigation state so the resume card updates without a reload
    try { window.localStorage.setItem(lastThreadKey, currentId); setLastThreadId(currentId) } catch { /* Storage unavailable. */ }
  }, [lastThreadKey, currentId, currentSaveState, currentMine])

  const latestTurn = current?.turns.at(-1)
  useEffect(() => {
    const end = conversationEnd.current
    if (!end) return
    // The sibling composer sticks over the viewport; reserve its actual height
    // so an end anchor inside the viewport cannot leave the latest reply covered.
    const composerHeight = composer.current?.closest('form')?.getBoundingClientRect().height ?? 0
    end.style.scrollMarginBottom = `${Math.ceil(composerHeight) + 16}px`
    end.scrollIntoView({ block: 'nearest' })
  }, [latestTurn?.id, latestTurn?.live, latestTurn?.saveState])
  // A branch's origin may no longer be in this list (archived, or another member's
  // private thread that was unshared); then the origin is shown without a link.
  const branchOrigin = current?.branchOf ? threads.find(thread => thread.id === current.branchOf!.threadId) ?? null : null
  const inspectedTurn = inspection?.navigationVersion === navigationVersion ? current?.turns.find(turn => turn.id === inspection.turnId) : undefined
  const draft = current?.draft ?? newDraft
  const sendBlocked = busy || conversationPending || Boolean(current && (!current.turnsLoaded || current.turnsError)) || Boolean(live && (liveExhausted || live.cap === 0 || !platforms.length))
  const home = !current
  const basePath = clientId ? `/${language}/dashboard/${encodeURIComponent(clientId)}` : null
  const actionPanel = useStudioActions({ clientId, brandName, brandDomain, features, evidence, enabled: smeCopilot && !staffView })

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

  /**
   * Stop an open SSE answer. The server still commits what it generated, so the
   * caller reads the owned turn back instead of re-dispatching the paid request.
   */
  function stopAnswer() {
    stopRequested.current = true
    answerAbort.current?.abort()
  }

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
    setThreads(previous => [{ id, title, goal: source.goal, week: source.week, kind, sourceTitle, turns: [], draft: seed, template: turn.task ?? null, saveState: 'unsaved', turnsLoaded: true, skill: skillForTask(turn.task), visibility: 'private', pinned: false, archived: false, mine: true, branchOf }, ...previous])
    const saving = saveThread(id, { kind, title, goal: source.goal, week: source.week, sourceTitle, branchOf })
    focusBriefStart.current = true
    openThread(id)
    void saving.then(saved => { if (saved) setFeedback({ id: turn.id, threadId: saved, key: 'branchOpened' }) })
  }

  function updateDraft(value: string, template: StudioHomeTemplate | null = null) {
    if (activeId === null) { setNewDraft(value); setNewTemplate(template) }
    else setThreads(previous => previous.map(thread => thread.id === activeId ? { ...thread, draft: value, template } : thread))
  }

  /** Refill the composer with a failed question so the member can edit and resend. */
  function retryPrompt(prompt: string, task: StudioHomeTemplate | null) {
    updateDraft(prompt, task)
    composer.current?.focus()
    composer.current?.scrollIntoView({ block: 'center' })
  }

  /** Explicit Send is the only write/provider path; a selected task just fills the draft. */
  async function submitTurn(prompt: string, taskHint: StudioHomeTemplate | null) {
    if (!prompt || isInFlight() || sendBlocked || (current && !current.mine)) return
    if (prompt.length > STUDIO_PROMPT_LIMIT || (live && (liveExhausted || live.cap === 0 || !platforms.length))) return
    const askLive = Boolean(live && !staffView && live.cap > 0 && platforms.length && clientId)
    // Lock synchronously, before thread creation or append can yield.
    beginLive()
    try {
    setFeedback(null)
    const id = current?.id ?? allocateThreadId()
    const task = taskHint
    const title = boundedTitle(task ? t(`templates.${task}.label`) : prompt)
    const kind = task === 'brief' ? 'brief' : 'research'
    // A staff view reads no provider or Google data: those routes bill and scope to the viewer's own account.
    const research = studioResearchReads(task)
    const wantsGsc = Boolean(clientId && !staffView && research.searchConsole && sourceStatus === 'bound')
    const wantsDfs = Boolean(clientId && !staffView && research.keywords)
    const scrapeUrl = clientId && !staffView && research.publicPage ? extractTurnUrl(prompt) : null
    const turn: StudioTurn = { id: allocateId(), requestId: crypto.randomUUID(), prompt, task, reply: composeSavedReply(prompt, task ? HOME_TASKS[task].capability : null, evidenceForHomeTask(evidence, task), opportunities), ...(attachment ? { attached: { label: attachment.label, versionNumber: attachment.versionNumber } } : {}), ...(askLive ? { live: { pending: true } } : {}), ...(wantsGsc ? { gsc: { pending: true } } : {}), ...(wantsDfs ? { dfs: { pending: true } } : {}), ...(scrapeUrl ? { firecrawl: { pending: true } } : {}) }
    if (current) {
      setThreads(previous => previous.map(thread => thread.id === activeId ? { ...thread, turns: [...thread.turns, turn], draft: '', template: null } : thread))
    } else {
      setThreads(previous => [{ id, title, goal: prompt, week: evidence.week, kind, turns: [turn], draft: '', template: null, saveState: 'unsaved', turnsLoaded: true, skill: skillForTask(task), visibility: 'private', pinned: false, archived: false, mine: true, branchOf: null }, ...previous])
      void saveThread(id, { kind, title, goal: prompt, week: evidence.week, sourceTitle: null, skill: skillForTask(task) })
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
    // Persist the user turn before any provider or research request.
    const saved = await saveTurn(id, turn.id, { prompt, task, reply: turn.reply, requestId: turn.requestId, language: language === 'zh-HK' ? 'zh-HK' : 'en', attached: turn.attached ?? null })
    if (!saved.ok) {
      setThreads(previous => previous.map(thread => thread.turns.some(item => item.id === turn.id)
        ? { ...thread, turns: thread.turns.map(item => item.id === turn.id ? { ...item, live: undefined, gsc: undefined, dfs: undefined, firecrawl: undefined } : item) } : thread))
      return
    }
    setFeedback({ id: turn.id, threadId: saved.threadId, key: 'followUpSent' })
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
    if (askLive && saved.ok) {
      let result: NonNullable<StudioTurn['live']>
      stopRequested.current = false
      const answerInput = { prompt, platforms, language: language === 'zh-HK' ? 'zh-HK' as const : 'en' as const, threadId: saved.threadId, position: saved.position, ...(attachment ? { attachedSourceId: attachment.id } : {}) }
      // While an SSE answer is open the turn shows partial text; the terminal
      // payload then replaces it with the same reply the buffered route returns.
      const applyStream = (platform: string, text: string) => setThreads(previous => previous.map(thread => thread.turns.some(item => item.id === turn.id)
        ? { ...thread, turns: thread.turns.map(item => item.id === turn.id
          ? { ...item, live: { pending: true, stream: { ...(item.live?.stream ?? {}), [platform]: (item.live?.stream?.[platform] ?? '') + text } } }
          : item) }
        : thread))
      try {
        if (live?.streaming) {
          const controller = new AbortController()
          answerAbort.current = controller
          const timeout = setTimeout(() => controller.abort(), 55_000)
          try {
            const outcome = await requestStudioAnswer({ clientId: clientId!, input: answerInput, signal: controller.signal, onDelta: applyStream })
            if (outcome.kind === 'reply') {
              result = { reply: outcome.reply }
              if (outcome.reply.quota.remaining === 0) setLiveExhausted(true)
            } else if (outcome.kind === 'pending') {
              result = { pending: true }
            } else if (outcome.kind === 'error') {
              result = { error: outcome.error }
              if (outcome.error === 'STUDIO_QUOTA_EXCEEDED') setLiveExhausted(true)
            } else {
              // Unconfirmed stream: either the member stopped it or it broke. In
              // both cases the server may already have committed the answer.
              result = stopRequested.current ? { pending: true } : { error: 'STUDIO_UNAVAILABLE' }
            }
          } finally {
            clearTimeout(timeout)
            answerAbort.current = null
          }
        } else {
          const response = await fetch(`/api/dashboard/clients/${encodeURIComponent(clientId!)}/studio/answer`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
            body: JSON.stringify(answerInput), signal: AbortSignal.timeout(45_000),
          })
          const data = await response.json()
          if (response.ok) {
            const reply = data as StudioLiveReply
            result = { reply }
            if (reply.quota.remaining === 0) setLiveExhausted(true)
          } else {
            result = data.error === 'STUDIO_ANSWER_PENDING' ? { pending: true } : { error: data.error ?? 'STUDIO_UNAVAILABLE' }
            if (data.error === 'STUDIO_QUOTA_EXCEEDED') setLiveExhausted(true)
          }
        }
      } catch { result = { error: 'STUDIO_UNAVAILABLE' } }
      const answerState: StudioTurn['answerState'] = result.pending ? 'pending'
        : result.reply ? result.reply.answers.some(answer => answer.coverage === 'present') ? 'complete' : 'failed'
          : result.error === 'STUDIO_ANSWER_UNKNOWN' ? 'unknown' : undefined
      setThreads(previous => previous.map(thread => thread.turns.some(item => item.id === turn.id) ? { ...thread, turns: thread.turns.map(item => item.id === turn.id ? { ...item, live: result, answerState } : item) } : thread))
      if (stopRequested.current) {
        setFeedback({ id: turn.id, threadId: saved.threadId, key: 'live.stopped' })
        // Stopping never re-sends the paid answer; this reads back what the server committed.
        await refreshThread(saved.threadId)
      } else if (result.error === 'STUDIO_UNAVAILABLE') {
        // The answer endpoint commits the assistant turn before it returns 200.
        // On a lost response, GET the owned thread; never re-dispatch a paid answer.
        await refreshThread(saved.threadId)
      }
    }
    } finally { endLive() }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const prompt = draft.trim()
    if (!prompt) return
    void submitTurn(prompt, current ? current.template : newTemplate)
  }

  /** Review the task's question before explicitly sending it to the model. */
  function submitSkill(key: StudioHomeTemplate) {
    if (isInFlight()) return
    updateDraft(t(`templates.${key}.prompt`), key)
    composer.current?.focus()
  }

  const preview = buildExecutionPreview({ clientId, staffView, sourceStatus, prompt: draft, task: current ? current.template : newTemplate, live: Boolean(live && live.cap > 0), platforms, liveExhausted })
  const previewReads = [preview.savesTurn && t('execution.readsSaved'), preview.readsSearchDemand && t('execution.readsSearchDemand'), preview.readsKeywordDemand && t('execution.readsKeywordDemand'), preview.readsPublicPage && t('execution.readsPublicPage')].filter(Boolean).join(' · ')
  const executionPreview = t('execution.preview', { reads: previewReads || t('execution.readsNothing'), live: preview.liveAnswers })

  /** One-tap skill card: the tap sends, so it never needs a second Send. */
  function skillButton(key: StudioHomeTemplate) {
    const Icon = templateIcons[key]
    return <button key={key} type="button" aria-labelledby={`studio-template-${key}`} aria-describedby={`studio-template-${key}-description`} onClick={() => submitSkill(key)} className="as-template space-y-2 text-left">
      <span className="flex items-start gap-2 font-semibold"><Icon className="as-blue mt-0.5 size-4 shrink-0" aria-hidden="true" /><span id={`studio-template-${key}`}>{t(`templates.${key}.label`)}</span></span>
      <span id={`studio-template-${key}-description`} className="block space-y-2 as-muted">
        <span className="block">{t(`templates.${key}.description`)}</span>
        <span className="as-small block">{t('oneTapHint')}</span>
      </span>
    </button>
  }

  const composerForm = <form onSubmit={submit} className={`as-composer space-y-3${home ? '' : ' as-chat-composer'}`} aria-busy={busy}>
    <label htmlFor="studio-composer" className="as-muted as-small block font-semibold">{t(home ? 'composerLabel' : 'followUpLabel')}</label>
    <textarea ref={composer} id="studio-composer" value={draft} maxLength={STUDIO_PROMPT_LIMIT} onChange={event => updateDraft(event.target.value, current ? current.template : newTemplate)} onKeyDown={event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); event.currentTarget.form?.requestSubmit() }
    }} rows={home ? 4 : 2} placeholder={t(home ? 'composerPlaceholder' : 'followUpPlaceholder')} aria-describedby="studio-composer-help" className="block w-full min-w-0 resize-y" />
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
        {!smeCopilot && <span className="as-badge">{t('localeBadge')}</span>}
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
      <button type="submit" disabled={!draft.trim() || sendBlocked} className="as-button as-primary inline-flex items-center justify-center gap-2 px-4 font-semibold disabled:opacity-50">
        <Send className="size-4" aria-hidden="true" />{t(busy ? 'sending' : home ? 'send' : 'followUpSend')}
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
    {smeCopilot && live && (liveExhausted || live.cap === 0 || !live.platforms.length) && <p role="status" className="as-note">{t(liveExhausted ? 'live.exhausted' : !live.platforms.length ? 'live.upgrade' : 'live.disabled')}</p>}
    {smeCopilot
      ? <p className="as-muted as-small">{executionPreview}</p>
      : <>
        {!live && <p className="as-note">{t('featureShellNote')}</p>}
        {live && <p className="as-muted as-small">{t(liveExhausted ? 'live.exhausted' : !live.platforms.length ? 'live.upgrade' : live.cap === 0 ? 'live.disabled' : 'live.usesQuota', { count: platforms.length, cap: live.cap })}</p>}
      </>}
    <p id="studio-composer-help" className="as-muted as-small">{t(live ? 'live.composerHelp' : 'composerHelp')}</p>
    {live && !home && (current?.turns.length ?? 0) > 0 && <p className="as-muted as-small">{t('live.continuityNote')}</p>}
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

  const visibleThreads = threads.filter(thread => !thread.archived)
  const lastThread = lastThreadId ? visibleThreads.find(thread => thread.id === lastThreadId) ?? null : null
  function threadMeta(thread: StudioThread): string {
    const when = relativeTime(thread.updatedAt, new Date(), language)
    const turns = thread.turnCount ?? thread.turns.length
    return [when, turns ? t('turnCount', { count: turns }) : null].filter(Boolean).join(' · ')
  }
  const continueSection = <section aria-labelledby="studio-continue-title" className="space-y-3">
    <div className="as-section-heading">
      <h2 id="studio-continue-title">{t('continueTitle')}</h2>
      {basePath && !staffView && <Link href={`${basePath}/studio/threads`} className="underline">{t('allThreads')}</Link>}
    </div>
    {lastThread && <button type="button" onClick={() => openThread(lastThread.id)} className="as-thread as-resume flex w-full items-center justify-between gap-3 text-left">
      <span className="min-w-0"><span className="as-badge">{t('resumeLast')}</span><span className="mt-1 block truncate font-semibold">{lastThread.title}</span><span className="as-muted as-small block">{threadMeta(lastThread)}</span></span>
      <ArrowUpRight className="size-4 shrink-0" aria-hidden="true" />
    </button>}
    {readFailed ? <p className="as-note">{t('readUnavailable')}</p> : !hydrated ? <p className="as-muted" aria-busy="true">{t('loadingThreads')}</p> : visibleThreads.length === 0 ? <div className="space-y-3">
      <p className="as-muted">{t('threadsEmpty')}</p>
      {smeCopilot && <div className="space-y-2" aria-label={t('examplesTitle')}>
        <p className="as-small font-semibold">{t('examplesTitle')}</p>
        <div className="flex flex-wrap gap-2">
          {(['exampleOne', 'exampleTwo', 'exampleThree'] as const).map(key => <button key={key} type="button" onClick={() => { updateDraft(t(key)); composer.current?.focus() }} className="as-button px-3 text-left">{t(key)}</button>)}
        </div>
      </div>}
    </div> : <ul className="as-continue-list">
      {visibleThreads.filter(thread => thread.id !== lastThread?.id).slice(0, 6).map(thread => <li key={thread.id}>
        <button type="button" onClick={() => openThread(thread.id)} className="as-thread flex w-full items-center justify-between gap-3 text-left">
          <span className="min-w-0"><span className="block truncate font-semibold">{thread.title}</span><span className="as-muted as-small block">{threadMeta(thread)}{thread.pinned ? ` · ${t('pinnedLabel')}` : ''}{thread.visibility === 'shared' ? ` · ${t('sharedLabel')}` : ''}</span>{thread.goal !== thread.title && <span className="sr-only">{thread.goal}</span>}</span>
          <ArrowUpRight className="size-4 shrink-0" aria-hidden="true" />
        </button>
      </li>)}
    </ul>}
    {visibleThreads.length > (lastThread ? 7 : 6) && basePath && <p className="as-small"><Link href={`${basePath}/studio/threads`} className="underline">{t('allThreads')}</Link></p>}
  </section>

  return (
    <main id={embedded ? undefined : "aiso-studio"} className={embedded ? "as-page space-y-6" : "mx-auto w-full min-w-0 max-w-6xl space-y-6"}>
      {!embedded && <div className="as-topbar">
        <p className="as-breadcrumb"><span>{brandName}</span><span aria-hidden="true">/</span><span>{t(home ? 'title' : 'discussionTitle')}</span></p>
        <span className="as-locale"><Globe2 className="size-3.5 shrink-0" aria-hidden="true" />{t('localeLabel')}</span>
      </div>}
      {home && activeId ? <section className="as-empty space-y-3" aria-busy={!selectionError}>
        <h1>{t('discussionTitle')}</h1>
        <p role={selectionError ? 'alert' : 'status'}>{t(selectionError ? 'readUnavailable' : 'loadingThreads')}</p>
        {selectionError && <button type="button" className="as-button px-4" onClick={() => void refreshThread(activeId)}>{t('retry')}</button>}
        <button type="button" className="as-button px-4" onClick={openHome}>{t('newThread')}</button>
      </section> : home ? <div id="studio-home" className="as-home space-y-6">
        <header className="space-y-3">
          <p className="as-eyebrow">{t(smeCopilot ? 'copilotEyebrow' : 'heroEyebrow')}</p>
          <h1>{t(smeCopilot ? 'copilotTitle' : 'heroTitle')}</h1>
          <p className="as-muted">{t(smeCopilot ? 'copilotDescription' : 'description')}</p>
        </header>
        {composerForm}
        <div className="as-source-bar" aria-label={t('savedDataLabel')}>
          <span className="inline-flex items-center gap-2"><span className="as-source-dot" aria-hidden="true" />{t('savedDataLabel')}</span>
          <span className={sourceStatus === 'bound' ? 'as-muted' : 'as-source-status'}>{t(`sources.${sourceStatus}`)}</span>
          <span className="as-muted">{t('sources.notQueried')}</span>
          {embedded && basePath && !staffView && <Link href={`${basePath}/studio/connections`} className="underline">{t('manageConnections')}</Link>}
        </div>
        {continueSection}
        <details className="as-disclosure" open>
          <summary className="as-muted as-small font-semibold">{t('templatesTitle')}</summary>
          <section aria-labelledby="studio-templates-title" className="mt-3 space-y-3">
          <div className="as-section-heading">
            <h2 id="studio-templates-title">{t('templatesTitle')}</h2>
            <p className="as-muted as-small">{t('templatesDescription')}</p>
          </div>
          {smeCopilot ? <div className="space-y-3">
            <div className="as-template-grid">{COPILOT_PRIMARY.map(skillButton)}</div>
            <details className="as-note as-disclosure">
              <summary>{t('moreSkills')}</summary>
              <div className="as-template-grid mt-3">{COPILOT_SECONDARY.map(skillButton)}</div>
            </details>
          </div> : <>
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
          </>}
          </section>
        </details>
        {actionPanel}
        {smeCopilot && basePath && !staffView && <details className="as-note as-disclosure">
          <summary>{t('chatMoreTitle')}</summary>
          <ul className="as-record-list mt-3">
            {([
              ['threads', t('threadsTitle'), `${basePath}/studio/threads`],
              ['weekly', t('nav.weekly'), `${basePath}/studio/weekly`],
              ['documents', t('nav.documents'), `${basePath}/studio/documents`],
              ['connections', t('nav.connections'), `${basePath}/studio/connections`],
              ['tools', t('nav.tools'), `${basePath}/studio/tools`],
            ] as const).map(([key, label, href]) => <li key={key}>
              <Link href={href} className="as-record-link">{label}<ArrowUpRight className="ml-auto size-4 shrink-0" aria-hidden="true" /></Link>
            </li>)}
          </ul>
        </details>}
        {scopeNote}
      </div> : <div id="studio-discussion" className={`space-y-5${inspectedTurn ? ' as-inspector-open' : ''}`}>
        <StudioThreadHeader thread={current} attachment={attachment} onHome={openHome} originTitle={branchOrigin?.title ?? null} onOpenOrigin={branchOrigin ? () => openThread(branchOrigin.id) : undefined} onUpdate={current.mine && !staffView ? async patch => (await updateThread(current.id, patch)).ok : undefined} onArchived={openHome} />
        {current.saveState === 'failed' && <p role="alert" className="as-note">{t('saveFailed')}</p>}
        <h2 className="sr-only">{t('conversationLabel')}</h2>
        <div className="as-discussion-grid as-has-rail">
        <div role="log" aria-label={t('conversationLabel')} aria-live="polite" className="as-conversation space-y-8">
          {!current.turnsLoaded && !current.turnsError && <p className="as-muted as-small">{t('loadingThreads')}</p>}
          {current.turnsError && <p role="alert" className="as-note">{t('readUnavailable')} <button type="button" className="as-button px-3" onClick={() => void refreshThread(current.id)}>{t('retry')}</button></p>}
          {current.turns.map(({ id, prompt, reply, task, live: liveTurn, gsc, dfs, firecrawl, attached, receipts, saveState: turnSaveState, position }, index) => <div key={id} className="space-y-5">
            <div className="as-question p-4">
              <p className="as-muted as-small mb-2 font-semibold">{t('youLabel')}</p>
              <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{prompt}</p>
              {attached && <p className="as-muted as-small mt-2">{t('attach.badge')} · {attached.label}{!live ? ` — ${t('attach.savedNote')}` : ''}</p>}
            </div>
            <div className="as-answer space-y-3">
            {!liveTurn && <p className="as-answer-label"><Sparkles className="size-4" aria-hidden="true" />{t('answerLabel')}</p>}
            <StudioTurnTrace attached={attached} gsc={gsc} dfs={dfs} firecrawl={firecrawl} live={liveTurn} receipts={receipts} />
            <StudioAttachedSource attached={attached} liveAttachment={liveTurn?.reply?.attachment ?? null} documents={inspector.documents} />
            {task && <div className="as-note space-y-1">
              <p>{t(`templates.${task}.limit`)}</p>
            </div>}
            <div className="min-w-0 space-y-4">
              {turnSaveState === 'failed' && <p role="alert" className="as-note">{t('messageNotSent')}</p>}
              {liveTurn && <StudioLiveReplyView {...liveTurn} number={index + 1} refreshing={busy || refreshingThreadId === current.id} onRefresh={current.mine ? () => void refreshThread(current.id) : undefined} onOpenEvidence={(trigger, target = 'saved') => setInspection({ navigationVersion, turnId: id, target, trigger })} onStop={live?.streaming && liveTurn.pending && busy ? stopAnswer : undefined} onRetry={current.mine && liveTurn.error && liveTurn.error !== 'STUDIO_QUOTA_EXCEEDED' ? () => retryPrompt(prompt, task ?? null) : undefined} />}
              {turnSaveState !== 'failed' && <details className="as-note as-saved-context" open={!liveTurn}>
                <summary>{t('savedContextDetails')}</summary>
              <StudioReplyView clientId={clientId} readOnly={staffView || !current.mine} reply={reply} evidence={evidenceForHomeTask(evidence, task)} id={`studio-${current.id}-${index}`} number={index + 1} liveEnabled={Boolean(live)} gsc={gsc} dfs={dfs} firecrawl={firecrawl} onBranchBrief={turnSaveState === 'saved' ? () => branchThread(current, current.turns[index]) : undefined} onOpenEvidence={(trigger, target = 'saved') => setInspection({ navigationVersion, turnId: id, target, trigger })} />
              {/* This existing export saves the stored summary, not the model reply. */}
              {clientId && current.mine && !staffView && current.saveState === 'persisted' && turnSaveState === 'saved' && position !== undefined
                && <StudioSaveToDocs clientId={clientId} threadId={current.id} position={position} />}
              </details>}
              <StudioGscSnapshotView gsc={gsc} />
              <StudioDfsSnapshotView dfs={dfs} />
              <StudioFirecrawlSnapshotView firecrawl={firecrawl} />
            </div>
            </div>
          </div>)}
          <div ref={conversationEnd} aria-hidden="true" />
        </div>
        {!staffView && visibleThreads.length > 1 && <aside className="as-thread-rail" aria-labelledby="studio-rail-title">
          <h2 id="studio-rail-title" className="as-muted as-small font-semibold">{t('recentThreadsTitle')}</h2>
          <ul>{visibleThreads.filter(thread => thread.id !== current.id).slice(0, 6).map(thread => <li key={thread.id}>
            <button type="button" className="as-thread w-full px-2 text-left" onClick={() => openThread(thread.id)}><span className="block truncate">{thread.title}</span><span className="as-muted as-small block">{threadMeta(thread)}</span></button>
          </li>)}</ul>
          {basePath && <Link href={`${basePath}/studio/threads`} className="as-small block px-2 underline">{t('allThreads')}</Link>}
        </aside>}
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
