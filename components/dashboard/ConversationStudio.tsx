'use client'

import { useRef, useState, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import { Lock, MessageSquare, Plus, Send } from 'lucide-react'
import { cn } from '@/lib/utils'

type DemoThread = { id: number; prompts: string[]; draft: string }
const TEMPLATE_KEYS = ['visibility', 'content', 'competitors'] as const

/** Stage A: page-local demo state only. Deliberately no transport or storage. */
export function ConversationStudio({ brandName }: { brandName: string }) {
  const t = useTranslations('conversationStudio')
  const [threads, setThreads] = useState<DemoThread[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [newDraft, setNewDraft] = useState('')
  const nextId = useRef(1)
  const composer = useRef<HTMLTextAreaElement>(null)
  const current = threads.find(thread => thread.id === activeId)
  const draft = current?.draft ?? newDraft

  function updateDraft(value: string) {
    if (activeId === null) setNewDraft(value)
    else setThreads(previous => previous.map(thread => thread.id === activeId ? { ...thread, draft: value } : thread))
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const prompt = draft.trim()
    if (!prompt) return
    if (current) {
      setThreads(previous => previous.map(thread => thread.id === activeId ? { ...thread, prompts: [...thread.prompts, prompt], draft: '' } : thread))
    } else {
      const id = nextId.current++
      setThreads(previous => [{ id, prompts: [prompt], draft: '' }, ...previous])
      setActiveId(id)
      setNewDraft('')
    }
    composer.current?.focus()
  }

  return (
    <main className="mx-auto w-full min-w-0 max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="space-y-3">
        <p className="break-words text-sm font-semibold text-muted-foreground">{brandName}</p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <span className="rounded-full border border-border bg-secondary px-3 py-1 text-xs font-semibold">{t('demoBadge')}</span>
        </div>
        <p className="max-w-2xl text-muted-foreground">{t('description')}</p>
        <p className="rounded-xl border border-border bg-secondary p-4 text-sm">{t('demoNotice')}</p>
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
                  {thread.prompts[0]}
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
            <div className="grid gap-3 sm:grid-cols-3">
              {TEMPLATE_KEYS.map(key => <button key={key} type="button" onClick={() => { updateDraft(t(`templates.${key}.prompt`)); composer.current?.focus() }} className="min-h-20 rounded-xl border border-border bg-card p-4 text-left text-sm font-medium hover:bg-secondary">
                {t(`templates.${key}.label`)}
              </button>)}
            </div>
          </section>

          <div role="log" aria-label={t('conversationLabel')} aria-live="polite" className="min-h-44 space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
            {!current && <div className="space-y-2 py-4">
              <h2 className="text-lg font-semibold">{t('emptyTitle')}</h2>
              <p className="text-sm text-muted-foreground">{t('emptyBody')}</p>
            </div>}
            {current?.prompts.map((prompt, index) => <div key={index} className="space-y-3">
              <div className="rounded-xl bg-secondary p-4">
                <p className="mb-2 text-xs font-semibold text-muted-foreground">{t('youLabel')}</p>
                <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{prompt}</p>
              </div>
              <div className="space-y-2 p-2 text-sm">
                <p className="font-semibold">{t('stubLabel')}</p>
                <p className="text-muted-foreground">{t('stubReply')}</p>
              </div>
            </div>)}
          </div>

          <form onSubmit={submit} className="space-y-3 rounded-2xl border border-border bg-card p-4">
            <label htmlFor="studio-composer" className="block text-sm font-semibold">{t('composerLabel')}</label>
            <textarea ref={composer} id="studio-composer" value={draft} onChange={event => updateDraft(event.target.value)} rows={4} placeholder={t('composerPlaceholder')} aria-describedby="studio-composer-help" className="block w-full min-w-0 resize-y rounded-lg border border-border bg-background p-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p id="studio-composer-help" className="text-xs text-muted-foreground">{t('composerHelp')}</p>
              <button type="submit" disabled={!draft.trim()} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                <Send className="size-4" aria-hidden="true" />{t('send')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </main>
  )
}
