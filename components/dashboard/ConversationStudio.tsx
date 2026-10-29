'use client'

import { useRef, useState, type FormEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Activity, FileText, Globe2, Lock, MessageSquare, NotebookPen, Plus, ScanSearch, Send } from 'lucide-react'
import { cn } from '@/lib/utils'
import { composeSavedReply } from '@/lib/conversation-studio/reply'
import { STUDIO_TEMPLATES, type StudioEvidence, type StudioReply, type StudioTemplate } from '@/lib/conversation-studio/types'
import { StudioReplyView } from './StudioReply'
import { StudioLiveReplyView } from '@/components/dashboard/StudioLiveReply'
import { STUDIO_PROMPT_LIMIT, type StudioLiveConfig, type StudioLiveReply } from '@/lib/conversation-studio/live-types'
import './conversation-studio.css'

const templateIcons = { brief: NotebookPen, competitors: ScanSearch, pulse: Activity, report: FileText }

type StudioTurn = { id: number; prompt: string; reply: StudioReply; live?: { pending?: boolean; reply?: StudioLiveReply; error?: string } }
type StudioThread = { id: number; turns: StudioTurn[]; draft: string; template: StudioTemplate | null }

/** Saved evidence is local; the optional B2 transport sends one question only. */
export function ConversationStudio({ brandName, evidence, clientId, live }: { brandName: string; evidence: StudioEvidence; clientId?: string; live?: StudioLiveConfig }) {
  const t = useTranslations('conversationStudio')
  const language = useLocale()
  const [platforms, setPlatforms] = useState<string[]>(live?.platforms.slice(0, 1) ?? [])
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const [threads, setThreads] = useState<StudioThread[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [newDraft, setNewDraft] = useState('')
  const [newTemplate, setNewTemplate] = useState<StudioTemplate | null>(null)
  const nextId = useRef(1)
  const composer = useRef<HTMLTextAreaElement>(null)
  const current = threads.find(thread => thread.id === activeId)
  const draft = current?.draft ?? newDraft

  function updateDraft(value: string, template: StudioTemplate | null = null) {
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
    const turn: StudioTurn = { id: nextId.current++, prompt, reply: composeSavedReply(prompt, current ? current.template : newTemplate, evidence), ...(askLive ? { live: { pending: true } } : {}) }
    if (current) {
      setThreads(previous => previous.map(thread => thread.id === activeId ? { ...thread, turns: [...thread.turns, turn], draft: '', template: null } : thread))
    } else {
      setThreads(previous => [{ id, turns: [turn], draft: '', template: null }, ...previous])
      setActiveId(id)
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

  return (
    <main id="aiso-studio" className="mx-auto w-full min-w-0 max-w-6xl space-y-6">
      <div className="as-topbar">
        <p className="as-breadcrumb"><span>{brandName}</span><span aria-hidden="true">/</span><span>{t('title')}</span></p>
        <span className="as-locale"><Globe2 className="size-3.5 shrink-0" aria-hidden="true" />{t('localeLabel')}</span>
      </div>
      <header className="space-y-3">
        <p className="as-eyebrow">{t('heroEyebrow')}</p>
        <h1>{t('title')}</h1>
        <p className="as-muted max-w-2xl">{t('description')}</p>
        <details className="as-note as-disclosure">
          <summary>{t('scopeNote')}</summary>
          <div className="space-y-2 pb-3">
            <p>{t(live ? 'live.notice' : 'savedNotice')}</p>
            {live && <><p>{t('live.unverified')}</p><p>{t('live.temporaryCap')}</p></>}
          </div>
        </details>
      </header>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside aria-labelledby="studio-threads-title" className="as-threads min-w-0 space-y-4 p-4">
          <div className="flex items-center gap-2">
            <MessageSquare className="size-4" aria-hidden="true" />
            <h2 id="studio-threads-title" className="font-semibold">{t('threadsTitle')}</h2>
          </div>
          <button type="button" onClick={() => { setActiveId(null); composer.current?.focus() }} className="as-button flex w-full items-center gap-2 px-3 font-semibold">
            <Plus className="size-4" aria-hidden="true" />{t('newThread')}
          </button>
          {threads.length === 0
            ? <p className="as-muted">{t('threadsEmpty')}</p>
            : <ul className="max-h-64 space-y-1 overflow-y-auto">
              {threads.map(thread => <li key={thread.id}>
                <button type="button" aria-pressed={thread.id === activeId} onClick={() => setActiveId(thread.id)} className="as-thread w-full truncate px-3 text-left">
                  {thread.turns[0].prompt}
                </button>
              </li>)}
            </ul>}
          <div className="as-divider space-y-2 pt-4">
            <p className="flex items-center gap-2 font-semibold"><Lock className="size-4 shrink-0" aria-hidden="true" />{t('privateLabel')}</p>
            <p className="as-muted as-small">{t('privacyBody')}</p>
          </div>
        </aside>

        <div className="min-w-0 space-y-5">
          <section aria-labelledby="studio-templates-title" className="space-y-3">
            <h2 id="studio-templates-title">{t('templatesTitle')}</h2>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {STUDIO_TEMPLATES.map(key => {
                const Icon = templateIcons[key]
                return <button key={key} type="button" aria-labelledby={`studio-template-${key}`} aria-describedby={`studio-template-${key}-description`} onClick={() => { updateDraft(t(`templates.${key}.prompt`), key); composer.current?.focus() }} className="as-template space-y-2 text-left">
                  <span className="flex items-start gap-2 font-semibold"><Icon className="as-blue mt-0.5 size-4 shrink-0" aria-hidden="true" /><span id={`studio-template-${key}`}>{t(`templates.${key}.label`)}</span></span>
                  <span id={`studio-template-${key}-description`} className="block space-y-2 as-muted">
                    <span className="block">{t(`templates.${key}.description`)}</span>
                    <span className="as-small block">{t(`templates.${key}.output`)}</span>
                  </span>
                </button>
              })}
            </div>
          </section>

          <div role="log" aria-label={t('conversationLabel')} aria-live="polite" className="as-conversation min-h-44 space-y-4 p-4 sm:p-5">
            {!current && <div className="space-y-2 py-4">
              <h2>{t('emptyTitle')}</h2>
              <p className="as-muted">{t('emptyBody')}</p>
            </div>}
            {current?.turns.map(({ prompt, reply, live: liveTurn }, index) => <div key={index} className="space-y-3">
              <div className="as-question p-4">
                <p className="as-muted as-small mb-2 font-semibold">{t('youLabel')}</p>
                <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{prompt}</p>
              </div>
              <div className={cn('min-w-0', liveTurn && 'grid gap-4 xl:grid-cols-2')}>
                <StudioReplyView reply={reply} evidence={evidence} id={`studio-${current.id}-${index}`} number={index + 1} liveEnabled={Boolean(live)} />
                {liveTurn && <StudioLiveReplyView {...liveTurn} number={index + 1} />}
              </div>
            </div>)}
          </div>

          <form onSubmit={submit} className="as-composer space-y-3">
            {live && <fieldset className="space-y-2" disabled={busy || live.cap === 0}>
              <legend className="as-muted as-small font-semibold">{t('live.platforms')}</legend>
              <div className="flex flex-wrap gap-2">{live.platforms.map(platform => <label key={platform} className="as-platform flex items-center gap-2 px-3">
                <input type="checkbox" checked={platforms.includes(platform)} onChange={event => setPlatforms(previous => event.target.checked ? [...previous, platform] : previous.filter(item => item !== platform))} />{platform}
              </label>)}</div>
              <p className="as-muted as-small">{t(!live.platforms.length ? 'live.upgrade' : live.cap === 0 ? 'live.disabled' : 'live.usesQuota', { count: platforms.length, cap: live.cap })}</p>
            </fieldset>}
            <label htmlFor="studio-composer" className="as-muted as-small block font-semibold">{t('composerLabel')}</label>
            <textarea ref={composer} id="studio-composer" value={draft} maxLength={live ? STUDIO_PROMPT_LIMIT : undefined} onChange={event => updateDraft(event.target.value)} rows={4} placeholder={t('composerPlaceholder')} aria-describedby="studio-composer-help" className="block w-full min-w-0 resize-y" />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p id="studio-composer-help" className="as-muted as-small">{t(live ? 'live.composerHelp' : 'composerHelp')}</p>
              <button type="submit" disabled={!draft.trim() || busy || Boolean(live && live.cap > 0 && live.platforms.length && !platforms.length)} className="as-button as-primary inline-flex items-center gap-2 px-4 font-semibold disabled:opacity-50">
                <Send className="size-4" aria-hidden="true" />{t('send')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </main>
  )
}
