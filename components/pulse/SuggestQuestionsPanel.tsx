'use client'
import { useEffect, useId, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { X, Sparkles, Check } from 'lucide-react'
import type { PromptBankItem } from '@/lib/types'
import { isPromptMarket, readPromptLanguage, type PromptContext, type PromptContextDefaults } from '@/lib/prompts/context'
import { parseQuestionSuggestions, saveSuggestedQuestion, type QuestionSuggestion } from '@/lib/prompts/suggestion-client'
import { PromptContextFields } from './PromptBankEditor'

interface Props {
  clientId: string
  contextDefaults?: PromptContextDefaults
  onClose: () => void
  /** Receives the acknowledged server row, never an invented temporary id. */
  onAccepted: (prompt: PromptBankItem) => void
  onError: (message: string, unresolved?: boolean) => void
  hasUnresolvedSave?: boolean
}

export function SuggestQuestionsPanel({ clientId, onClose, onAccepted, onError, contextDefaults, hasUnresolvedSave = false }: Props) {
  const t = useTranslations('pulse')
  const locale = useLocale()
  const titleId = useId(), introId = useId(), hintId = useId()
  const dialog = useRef<HTMLDialogElement>(null), closeButton = useRef<HTMLButtonElement>(null)
  const editors = useRef<Record<number, HTMLTextAreaElement | null>>({})
  const focusAfterRemoval = useRef<number | null | undefined>(undefined)
  const mounted = useRef(false)
  const generation = useRef<AbortController | null>(null), saving = useRef<AbortController | null>(null)
  // Synchronous locks cover consecutive clicks before React has rendered disabled controls.
  const blockedSaves = useRef(new Set<number>())
  const [context, setContext] = useState<PromptContext>({
    language: readPromptLanguage(contextDefaults?.language) ?? (locale === 'zh-HK' ? 'zh-HK' : 'en'),
    market: isPromptMarket(contextDefaults?.market) ? contextDefaults.market : null,
  })
  const [loading, setLoading] = useState(false)
  const [suggestions, setSuggestions] = useState<QuestionSuggestion[]>([])
  const [editing, setEditing] = useState<Record<number, string>>({})
  const [dismissed, setDismissed] = useState<Set<number>>(new Set())
  const [fetched, setFetched] = useState(false)
  const [savingIndex, setSavingIndex] = useState<number | null>(null)
  const [unknown, setUnknown] = useState<Set<number>>(new Set())
  const [errors, setErrors] = useState<Record<number, string>>({})
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [status, setStatus] = useState('')

  useEffect(() => {
    mounted.current = true
    const node = dialog.current
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    node?.showModal()
    closeButton.current?.focus()
    return () => {
      mounted.current = false
      generation.current?.abort()
      saving.current?.abort()
      node?.close()
      document.body.style.overflow = previousOverflow
      if (previous?.isConnected) previous.focus()
    }
  }, [])

  useEffect(() => {
    if (savingIndex !== null || focusAfterRemoval.current === undefined) return
    const next = focusAfterRemoval.current
    focusAfterRemoval.current = undefined
    if (next === null) closeButton.current?.focus()
    else editors.current[next]?.focus()
  }, [dismissed, savingIndex])

  function close() {
    if (saving.current) return
    generation.current?.abort()
    onClose()
  }

  async function fetchSuggestions() {
    if (generation.current || saving.current) return
    const controller = new AbortController()
    generation.current = controller
    setLoading(true)
    setGenerationError(null)
    setStatus('')
    // A bounded wait; aborting the browser does not cancel provider work already started.
    const timer = setTimeout(() => controller.abort(), 30_000)
    try {
      const res = await fetch('/api/pulse/suggest-questions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, count: 5, ...context }), signal: controller.signal,
      })
      if (!res.ok) throw new Error('Suggestions unavailable')
      const next = parseQuestionSuggestions(await res.json(), context)
      if (!mounted.current) return
      if (controller.signal.aborted) throw new Error('Suggestions timed out')
      setSuggestions(next)
      setFetched(true)
      setStatus(t('panel_ready', { count: next.length }))
    } catch {
      if (mounted.current) setGenerationError(t('panel_generate_failed'))
    } finally {
      clearTimeout(timer)
      if (generation.current === controller) generation.current = null
      if (mounted.current) setLoading(false)
    }
  }

  function dismiss(i: number) {
    blockedSaves.current.add(i)
    const next = suggestions.findIndex((_, index) => index !== i && !dismissed.has(index))
    focusAfterRemoval.current = next >= 0 ? next : null
    setDismissed(prev => new Set([...prev, i]))
  }

  async function accept(i: number) {
    if (saving.current || blockedSaves.current.has(i)) return
    const suggestion = suggestions[i]
    const question = (editing[i] ?? suggestion?.question ?? '').trim()
    if (!suggestion || !question || question.length > 500) return
    const controller = new AbortController()
    saving.current = controller
    blockedSaves.current.add(i)
    setSavingIndex(i)
    setErrors(prev => ({ ...prev, [i]: '' }))
    setStatus('')
    const timer = setTimeout(() => controller.abort(), 15_000)
    try {
      const result = await saveSuggestedQuestion(clientId, { ...suggestion, question }, controller.signal)
      if (!mounted.current) return
      if (result.state === 'saved') {
        onAccepted(result.prompt)
        dismiss(i)
        setStatus(t('qb_saved'))
      } else {
        const message = result.state === 'unknown'
          ? t('panel_save_unknown')
          : result.max ? t('qb_limit_reached', { max: result.max }) : t('qb_save_failed')
        if (result.state === 'unknown') setUnknown(prev => new Set([...prev, i]))
        else blockedSaves.current.delete(i)
        setErrors(prev => ({ ...prev, [i]: message }))
        onError(message, result.state === 'unknown')
        editors.current[i]?.focus()
      }
    } finally {
      clearTimeout(timer)
      saving.current = null
      if (mounted.current) setSavingIndex(null)
    }
  }

  function changeContext() {
    if (saving.current || unknown.size) return
    setSuggestions([])
    setFetched(false)
    setEditing({})
    setDismissed(new Set())
    blockedSaves.current.clear()
    setErrors({})
    setStatus('')
    closeButton.current?.focus()
  }

  const visibleCount = suggestions.length - dismissed.size
  const busy = savingIndex !== null

  return (
    <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={introId}
      onCancel={event => { event.preventDefault(); close() }}
      onKeyDown={event => {
        if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return
        // Native inertness blocks background controls, but Chromium can move Tab
        // into browser chrome at the boundary. Keep the review loop in the panel.
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
          'button:not(:disabled), select:not(:disabled), textarea:not(:disabled)',
        )).filter(node => node.tabIndex >= 0 && node.getClientRects().length > 0)
        const first = controls[0], last = controls[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first?.focus()
        }
      }}
      className="fixed inset-y-0 left-auto right-0 m-0 ml-auto h-dvh max-h-none w-full max-w-md overflow-hidden border-l border-border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/40">
      <div className="flex h-full min-h-0 flex-col">
        <header className="shrink-0 border-b border-border px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <h2 id={titleId} className="flex items-center gap-2 font-bold">
              <Sparkles aria-hidden="true" className="size-4 text-primary" />{t('panel_title')}
            </h2>
            <button ref={closeButton} type="button" onClick={close} disabled={busy} aria-label={t('panel_close')}
              className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border border-border hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50">
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>
          <p id={introId} className="mt-2 text-sm text-muted-foreground">{t('panel_intro')}</p>
          <p className="mt-2 text-xs text-muted-foreground">{t('panel_review_note')}</p>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {hasUnresolvedSave && unknown.size === 0 && <p role="alert" className="mb-3 text-sm text-destructive">{t('panel_save_unknown')}</p>}
          <fieldset disabled={loading || busy || fetched} className="mb-4">
            <legend className="mb-2 text-sm font-semibold">{t('panel_context')}</legend>
            <PromptContextFields {...context} onChange={next => {
              setContext({ language: readPromptLanguage(next.language) ?? context.language, market: next.market })
            }} disabled={loading || busy || fetched} />
          </fieldset>
          {fetched && <button type="button" onClick={changeContext} disabled={busy || unknown.size > 0}
            className="mb-4 min-h-11 rounded-lg border border-border px-3 text-sm underline disabled:opacity-50">
            {t('panel_change_context')}
          </button>}
          {generationError && <p role="alert" className="mb-3 text-sm text-destructive">{generationError}</p>}
          <p role="status" aria-live="polite" aria-atomic="true" className="mb-3 text-sm text-muted-foreground">
            {busy ? t('panel_saving') : loading ? t('generating') : status}
          </p>
          {!fetched || suggestions.length === 0 ? (
            <div className="py-4">
              {fetched && <p className="mb-3 text-sm">{t('panel_empty')}</p>}
              <button type="button" onClick={fetchSuggestions} disabled={loading || busy}
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary-accessible disabled:opacity-60">
                {loading ? t('generating') : t('generate_btn')}
              </button>
            </div>
          ) : visibleCount === 0 ? (
            <p className="py-4 text-sm">{t('all_done')}</p>
          ) : (
            <div className="space-y-4">
              <p id={hintId} className="text-xs text-muted-foreground">{t('panel_question_hint')}</p>
              {suggestions.map((s, i) => {
                if (dismissed.has(i)) return null
                const currentText = editing[i] ?? s.question
                const fieldId = titleId + '-question-' + i, errorId = fieldId + '-error'
                return (
                  <section key={i} aria-label={t('panel_question_label', { number: i + 1 })} aria-busy={savingIndex === i}
                    className="rounded-xl border border-border bg-card p-4">
                    <p className="mb-2 text-xs font-semibold text-muted-foreground">{t('cat_' + s.category)}</p>
                    <label htmlFor={fieldId} className="mb-2 block text-sm font-semibold">{t('panel_question_label', { number: i + 1 })}</label>
                    <textarea ref={node => { editors.current[i] = node }} id={fieldId} value={currentText}
                      onChange={event => setEditing(prev => ({ ...prev, [i]: event.target.value }))} rows={3} maxLength={500}
                      readOnly={busy || unknown.has(i)} aria-describedby={errors[i] ? hintId + ' ' + errorId : hintId}
                      className="mb-3 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-primary" />
                    {errors[i] && <p id={errorId} role="alert" className="mb-3 text-sm text-destructive">{errors[i]}</p>}
                    <div className="flex gap-2">
                      <button type="button" onClick={() => { void accept(i) }}
                        disabled={busy || unknown.has(i) || !currentText.trim() || currentText.trim().length > 500}
                        aria-label={t('panel_accept_label', { number: i + 1 })}
                        className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary-accessible disabled:opacity-50">
                        <Check aria-hidden="true" className="size-4" />{savingIndex === i ? t('panel_saving_short') : t('accept')}
                      </button>
                      <button type="button" onClick={() => { if (!saving.current) { dismiss(i); setStatus(t('panel_dismissed')) } }}
                        disabled={busy || unknown.has(i)} aria-label={t('panel_dismiss_label', { number: i + 1 })}
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-border px-3 hover:bg-accent disabled:opacity-50">
                        <X aria-hidden="true" className="size-4" />
                      </button>
                    </div>
                  </section>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </dialog>
  )
}
