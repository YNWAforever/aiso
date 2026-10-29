'use client'

import { useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Activity, ArrowLeft, ArrowUpRight, FilePenLine, FileText, Globe2, Lock, NotebookPen, Paperclip, ScanSearch, Search, Send } from 'lucide-react'
import { cn } from '@/lib/utils'
import { composeSavedReply } from '@/lib/conversation-studio/reply'
import { type StudioEvidence, type StudioReply } from '@/lib/conversation-studio/types'
import { StudioReplyView } from './StudioReply'
import { StudioLiveReplyView } from '@/components/dashboard/StudioLiveReply'
import { STUDIO_PROMPT_LIMIT, type StudioLiveConfig, type StudioLiveReply } from '@/lib/conversation-studio/live-types'
import { evidenceForHomeTask, HOME_TASKS, STUDIO_FILTERS, STUDIO_HOME_TEMPLATES, type StudioFilter, type StudioHomeTemplate, type StudioSourceStatus } from '@/lib/conversation-studio/home'
import './conversation-studio.css'

const templateIcons = { opportunity: Search, improve: FilePenLine, brief: NotebookPen, competitors: ScanSearch, pulse: Activity, report: FileText }

type StudioTurn = { id: number; prompt: string; reply: StudioReply; task: StudioHomeTemplate | null; live?: { pending?: boolean; reply?: StudioLiveReply; error?: string } }
type StudioThread = { id: number; turns: StudioTurn[]; draft: string; template: StudioHomeTemplate | null }

/** Saved evidence is local; the optional B2 transport sends one question only. */
export function ConversationStudio({ brandName, evidence, clientId, live, sourceStatus = 'unavailable' }: { brandName: string; evidence: StudioEvidence; clientId?: string; live?: StudioLiveConfig; sourceStatus?: StudioSourceStatus }) {
  const t = useTranslations('conversationStudio')
  const language = useLocale()
  const [platforms, setPlatforms] = useState<string[]>(live?.platforms.slice(0, 1) ?? [])
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const [threads, setThreads] = useState<StudioThread[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [newDraft, setNewDraft] = useState('')
  const [newTemplate, setNewTemplate] = useState<StudioHomeTemplate | null>(null)
  const [filter, setFilter] = useState<StudioFilter>('all')
  const nextId = useRef(1)
  const composer = useRef<HTMLTextAreaElement>(null)
  const focusAfterNavigation = useRef(false)
  const current = threads.find(thread => thread.id === activeId)
  const draft = current?.draft ?? newDraft
  const home = !current
  const basePath = clientId ? `/${language}/dashboard/${encodeURIComponent(clientId)}` : null

  useLayoutEffect(() => {
    if (focusAfterNavigation.current) {
      composer.current?.focus()
      focusAfterNavigation.current = false
    }
  }, [activeId])

  function openHome() { focusAfterNavigation.current = true; setActiveId(null) }
  function openThread(id: number) { focusAfterNavigation.current = true; setActiveId(id) }

  function updateDraft(value: string, template: StudioHomeTemplate | null = null) {
    if (activeId === null) { setNewDraft(value); setNewTemplate(template) }
    else setThreads(previous => previous.map(thread => thread.id === activeId ? { ...thread, draft: value, template } : thread))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const prompt = draft.trim()
    if (!prompt || inFlight.current) return
    const askLive = Boolean(live && live.cap > 0 && platforms.length && clientId)
    if (askLive && prompt.length > STUDIO_PROMPT_LIMIT) return
    const id = current?.id ?? nextId.current++
    const task = current ? current.template : newTemplate
    const turn: StudioTurn = { id: nextId.current++, prompt, task, reply: composeSavedReply(prompt, task ? HOME_TASKS[task].capability : null, evidenceForHomeTask(evidence, task)), ...(askLive ? { live: { pending: true } } : {}) }
    if (current) {
      setThreads(previous => previous.map(thread => thread.id === activeId ? { ...thread, turns: [...thread.turns, turn], draft: '', template: null } : thread))
    } else {
      setThreads(previous => [{ id, turns: [turn], draft: '', template: null }, ...previous])
      openThread(id)
      setNewDraft('')
      setNewTemplate(null)
    }
    composer.current?.focus()
    if (askLive) {
      inFlight.current = true
      setBusy(true)
      let result: NonNullable<StudioTurn['live']>
      try {
        const response = await fetch(`/api/dashboard/clients/${encodeURIComponent(clientId!)}/studio/answer`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
          body: JSON.stringify({ prompt, platforms, language }), signal: AbortSignal.timeout(25_000),
        })
        const data = await response.json()
        result = response.ok ? { reply: data as StudioLiveReply } : { error: data.error ?? 'STUDIO_UNAVAILABLE' }
      } catch { result = { error: 'STUDIO_UNAVAILABLE' } }
      setThreads(previous => previous.map(thread => thread.id === id ? { ...thread, turns: thread.turns.map(item => item.id === turn.id ? { ...item, live: result } : item) } : thread))
      inFlight.current = false
      setBusy(false)
    }
  }

  const composerForm = <form onSubmit={submit} className="as-composer space-y-3">
    <label htmlFor="studio-composer" className="as-muted as-small block font-semibold">{t(home ? 'composerLabel' : 'followUpLabel')}</label>
    <textarea ref={composer} id="studio-composer" value={draft} maxLength={live ? STUDIO_PROMPT_LIMIT : undefined} onChange={event => updateDraft(event.target.value)} rows={4} placeholder={t(home ? 'composerPlaceholder' : 'followUpPlaceholder')} aria-describedby="studio-composer-help" className="block w-full min-w-0 resize-y" />
    <div className="as-composer-footer">
      <div className="as-composer-tools">
        <button type="button" disabled className="as-button inline-flex items-center gap-2 px-3 disabled:opacity-60"><Paperclip className="size-4" aria-hidden="true" />{t('chooseDocuments')}</button>
        <span className="as-badge">{t('localeBadge')}</span>
        {live && <details className="as-platform-picker">
          <summary>{t('live.selector', { count: platforms.length })}</summary>
          <fieldset className="space-y-2" disabled={busy || live.cap === 0}>
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
    {live && <p className="as-muted as-small">{t(!live.platforms.length ? 'live.upgrade' : live.cap === 0 ? 'live.disabled' : 'live.usesQuota', { count: platforms.length, cap: live.cap })}</p>}
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
    <main id="aiso-studio" className="mx-auto w-full min-w-0 max-w-6xl space-y-6">
      <div className="as-topbar">
        <p className="as-breadcrumb"><span>{brandName}</span><span aria-hidden="true">/</span><span>{t(home ? 'title' : 'discussionTitle')}</span></p>
        <span className="as-locale"><Globe2 className="size-3.5 shrink-0" aria-hidden="true" />{t('localeLabel')}</span>
      </div>
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
          <h2 id="studio-continue-title">{t('continueTitle')}</h2>
          {threads.length === 0 ? <p className="as-muted">{t('threadsEmpty')}</p> : <ul className="as-continue-list">
            {threads.map(thread => <li key={thread.id}>
              <button type="button" onClick={() => openThread(thread.id)} className="as-thread flex w-full items-center justify-between gap-3 text-left">
                <span className="min-w-0"><span className="block truncate">{thread.turns[0].prompt}</span><span className="as-muted as-small">{t('privateLabel')}</span></span>
                <ArrowUpRight className="size-4 shrink-0" aria-hidden="true" />
              </button>
            </li>)}
          </ul>}
        </section>
        {scopeNote}
      </div> : <div id="studio-discussion" className="space-y-5">
        <header className="space-y-3">
          <button type="button" onClick={openHome} className="as-button inline-flex items-center gap-2 px-3"><ArrowLeft className="size-4" aria-hidden="true" />{t('title')}</button>
          <p className="as-eyebrow">{t('discussionTitle')}</p>
          <h1 className="[overflow-wrap:anywhere]">{current.turns[0].prompt}</h1>
          <span className="as-badge">{t('privateLabel')}</span>
        </header>
        <h2 className="sr-only">{t('conversationLabel')}</h2>
        <div role="log" aria-label={t('conversationLabel')} aria-live="polite" className="as-conversation space-y-4 p-4 sm:p-5">
          {current.turns.map(({ id, prompt, reply, task, live: liveTurn }, index) => <div key={id} className="space-y-3">
            <div className="as-question p-4">
              <p className="as-muted as-small mb-2 font-semibold">{t('youLabel')}</p>
              <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{prompt}</p>
            </div>
            {task && <div className="as-note space-y-1">
              <p>{t(`templates.${task}.limit`)}</p>
              {basePath && HOME_TASKS[task].destination && <a href={`${basePath}/${HOME_TASKS[task].destination}`} className="gap-2 underline">{t(`destinations.${HOME_TASKS[task].destination}`)}<ArrowUpRight className="size-4" aria-hidden="true" /></a>}
            </div>}
            <div className={cn('min-w-0', liveTurn && 'grid gap-4 xl:grid-cols-2')}>
              <StudioReplyView reply={reply} evidence={evidenceForHomeTask(evidence, task)} id={`studio-${current.id}-${index}`} number={index + 1} liveEnabled={Boolean(live)} />
              {liveTurn && <StudioLiveReplyView {...liveTurn} number={index + 1} />}
            </div>
          </div>)}
        </div>
        {composerForm}
        {scopeNote}
      </div>}
      <footer className="as-divider space-y-2 pt-4">
        <p className="as-small flex items-center gap-2 font-semibold"><Lock className="size-4 shrink-0" aria-hidden="true" />{t('privateLabel')}</p>
        <p className="as-muted as-small">{t('privacyBody')}</p>
      </footer>
    </main>
  )
}
