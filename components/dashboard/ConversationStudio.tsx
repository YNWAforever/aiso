'use client'

import { useRef, useState, type FormEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Lock, MessageSquare, Plus, Send } from 'lucide-react'
import { cn } from '@/lib/utils'
import { composeSavedReply } from '@/lib/conversation-studio/reply'
import { STUDIO_TEMPLATES, type StudioEvidence, type StudioReply, type StudioTemplate } from '@/lib/conversation-studio/types'
import { StudioReplyView } from './StudioReply'
import { StudioLiveReplyView } from '@/components/dashboard/StudioLiveReply'
import { STUDIO_PROMPT_LIMIT, type StudioLiveConfig, type StudioLiveReply } from '@/lib/conversation-studio/live-types'

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
    <main className="mx-auto w-full min-w-0 max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="space-y-3">
        <p className="break-words text-sm font-semibold text-muted-foreground">{brandName}</p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <span className="rounded-full border border-border bg-secondary px-3 py-1 text-xs font-semibold">{t(live ? 'live.badge' : 'savedBadge')}</span>
        </div>
        <p className="max-w-2xl text-muted-foreground">{t('description')}</p>
        <p className="rounded-xl border border-border bg-secondary p-4 text-sm">{t(live ? 'live.notice' : 'savedNotice')}</p>
      </header>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside aria-labelledby="studio-threads-title" className="min-w-0 space-y-4 rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <MessageSquare className="size-4" aria-hidden="true" />
            <h2 id="studio-threads-title" className="font-semibold">{t('threadsTitle')}</h2>
          </div>
          <button type="button" onClick={() => { setActiveId(null); composer.current?.focus() }} className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold hover:bg-secondary">
            <Plus className="size-4" aria-hidden="true" />{t('newThread')}
          </button>
          {threads.length === 0
            ? <p className="text-sm text-muted-foreground">{t('threadsEmpty')}</p>
            : <ul className="max-h-64 space-y-1 overflow-y-auto">
              {threads.map(thread => <li key={thread.id}>
                <button type="button" aria-pressed={thread.id === activeId} onClick={() => setActiveId(thread.id)} className={cn('min-h-11 w-full truncate rounded-lg px-3 text-left text-sm hover:bg-secondary', thread.id === activeId && 'bg-secondary font-semibold')}>
                  {thread.turns[0].prompt}
                </button>
              </li>)}
            </ul>}
          <div className="space-y-2 border-t border-border pt-4 text-sm">
            <p className="flex items-center gap-2 font-semibold"><Lock className="size-4 shrink-0" aria-hidden="true" />{t('privateLabel')}</p>
            <p className="text-muted-foreground">{t('privacyBody')}</p>
          </div>
        </aside>

        <div className="min-w-0 space-y-5">
          <section aria-labelledby="studio-templates-title" className="space-y-3">
            <h2 id="studio-templates-title" className="font-semibold">{t('templatesTitle')}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {STUDIO_TEMPLATES.map(key => <button key={key} type="button" onClick={() => { updateDraft(t(`templates.${key}.prompt`), key); composer.current?.focus() }} className="min-h-20 rounded-xl border border-border bg-card p-4 text-left text-sm font-medium hover:bg-secondary">
                {t(`templates.${key}.label`)}
              </button>)}
            </div>
          </section>

          <div role="log" aria-label={t('conversationLabel')} aria-live="polite" className="min-h-44 space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
            {!current && <div className="space-y-2 py-4">
              <h2 className="text-lg font-semibold">{t('emptyTitle')}</h2>
              <p className="text-sm text-muted-foreground">{t('emptyBody')}</p>
            </div>}
            {current?.turns.map(({ prompt, reply, live: liveTurn }, index) => <div key={index} className="space-y-3">
              <div className="rounded-xl bg-secondary p-4">
                <p className="mb-2 text-xs font-semibold text-muted-foreground">{t('youLabel')}</p>
                <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{prompt}</p>
              </div>
              <div className={cn('min-w-0', liveTurn && 'grid gap-4 xl:grid-cols-2')}>
                <StudioReplyView reply={reply} evidence={evidence} id={`studio-${current.id}-${index}`} number={index + 1} liveEnabled={Boolean(live)} />
                {liveTurn && <StudioLiveReplyView {...liveTurn} number={index + 1} />}
              </div>
            </div>)}
          </div>

          <form onSubmit={submit} className="space-y-3 rounded-2xl border border-border bg-card p-4">
            {live && <fieldset className="space-y-2" disabled={busy || live.cap === 0}>
              <legend className="text-sm font-semibold">{t('live.platforms')}</legend>
              <div className="flex flex-wrap gap-2">{live.platforms.map(platform => <label key={platform} className="flex min-h-11 items-center gap-2 rounded-full border border-border px-3 text-sm">
                <input type="checkbox" checked={platforms.includes(platform)} onChange={event => setPlatforms(previous => event.target.checked ? [...previous, platform] : previous.filter(item => item !== platform))} />{platform}
              </label>)}</div>
              <p className="text-sm">{t(!live.platforms.length ? 'live.upgrade' : live.cap === 0 ? 'live.disabled' : 'live.usesQuota', { count: platforms.length, cap: live.cap })}</p>
              <p className="text-xs text-muted-foreground">{t('live.temporaryCap')}</p>
            </fieldset>}
            <label htmlFor="studio-composer" className="block text-sm font-semibold">{t('composerLabel')}</label>
            <textarea ref={composer} id="studio-composer" value={draft} maxLength={live ? STUDIO_PROMPT_LIMIT : undefined} onChange={event => updateDraft(event.target.value)} rows={4} placeholder={t('composerPlaceholder')} aria-describedby="studio-composer-help" className="block w-full min-w-0 resize-y rounded-lg border border-border bg-background p-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p id="studio-composer-help" className="text-xs text-muted-foreground">{t(live ? 'live.composerHelp' : 'composerHelp')}</p>
              <button type="submit" disabled={!draft.trim() || busy || Boolean(live && live.cap > 0 && live.platforms.length && !platforms.length)} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                <Send className="size-4" aria-hidden="true" />{t('send')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </main>
  )
}
