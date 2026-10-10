'use client'
import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { PROMPT_CATEGORIES, promptCategoryLabelKey } from '@/lib/prompts/categories'
import type { PromptBankItem } from '@/lib/types'
import { isPromptLanguage, isPromptMarket, PROMPT_MARKETS, readPromptLanguage, type PromptContextDefaults } from '@/lib/prompts/context'

interface Props {
  clientId: string
  contextDefaults?: PromptContextDefaults
  /**
   * Controlled. This used to be `initialPrompts` seeding a useState, which meant
   * a parent that also tracked the list (QuestionBankSection, so its suggest
   * panel could append) had a second copy the editor never re-read — accepting a
   * suggestion moved the header count and nothing else. One array, one owner.
   */
  prompts: PromptBankItem[]
  onPromptsChange: (next: PromptBankItem[]) => void
}

// Sections are keyed on the value actually stored in prompt_bank.category. This
// used to be a list of display labels ('Brand Queries'), which shared no member
// with the stored vocabulary — so the four sections rendered empty, the real
// categories appeared beneath them labelled with raw snake_case, and the add row
// POSTed the label, filing new questions under a category nothing else used.
// Sentinel for rows whose category is outside the vocabulary or absent. Cannot
// collide with a real category — POST validates those against PROMPT_CATEGORIES.
const UNCATEGORISED = '__other__'

function categoryKey(category: string | null): string {
  return category && (PROMPT_CATEGORIES as readonly string[]).includes(category)
    ? category
    : UNCATEGORISED
}

function groupByCategory(prompts: PromptBankItem[]): Record<string, PromptBankItem[]> {
  const result: Record<string, PromptBankItem[]> = {}
  for (const p of prompts) {
    const key = categoryKey(p.category)
    if (!result[key]) result[key] = []
    result[key].push(p)
  }
  return result
}

const CONTROL = 'min-h-11 min-w-11 rounded-lg px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60'
export function PromptContextFields({ language, market, disabled, onChange }: {
  language: string; market: string | null; disabled?: boolean; onChange: (context: { language: string; market: string | null }) => void
}) {
  const t = useTranslations('pulse'), locale = useLocale(), id = useId()
  return <div className="flex w-full flex-wrap gap-2">
    <label className="min-w-0 flex-1 text-xs text-muted-foreground" htmlFor={`${id}-language`}>{t('qb_language')}
      <select id={`${id}-language`} value={language} disabled={disabled} onChange={e => onChange({ language: e.target.value, market })} className={`${CONTROL} mt-1 w-full border border-border bg-background text-foreground`}>
        {!isPromptLanguage(language) && <option value="">{t('qb_unknown_context')}</option>}
        <option value="en">English</option><option value="zh-HK">繁體中文（香港）</option>
      </select>
    </label>
    <label className="min-w-0 flex-1 text-xs text-muted-foreground" htmlFor={`${id}-market`}>{t('qb_market')}
      <select id={`${id}-market`} value={market ?? ''} disabled={disabled} onChange={e => onChange({ language, market: e.target.value || null })} className={`${CONTROL} mt-1 w-full border border-border bg-background text-foreground`}>
        <option value="">{t('qb_unspecified_market')}</option>
        {PROMPT_MARKETS.map(m => <option key={m.value} value={m.value}>{locale === 'zh-HK' ? m.labelZh : m.labelEn}</option>)}
      </select>
    </label>
  </div>
}
function Toggle({ active, name, disabled, buttonRef, onToggle }: { active: boolean; name: string; disabled: boolean; buttonRef: RefObject<HTMLButtonElement | null>; onToggle: () => void }) {
  return (
    <button type="button" ref={buttonRef} role="switch" aria-checked={active} aria-label={name} aria-disabled={disabled} onClick={onToggle}
      className={`${CONTROL} inline-flex shrink-0 items-center justify-center p-0`}>
      <span aria-hidden="true" className={`inline-flex h-5 w-9 rounded-full border-2 border-transparent ${active ? 'bg-primary' : 'bg-muted-foreground'}`}>
      <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition ${active ? 'translate-x-4' : 'translate-x-0'}`} />
      </span>
    </button>
  )
}

function PromptRow({ prompt, onToggle, onEdit, onDelete }: {
  prompt: PromptBankItem
  onToggle: (id: string, is_active: boolean) => Promise<void>
  onEdit:   (id: string, question: string, context?: PromptContextDefaults) => Promise<boolean>
  onDelete: (id: string) => Promise<void>
}) {
  const t = useTranslations('pulse')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(prompt.question)
  const [context, setContext] = useState({ language: readPromptLanguage(prompt.language) ?? '', market: prompt.market ?? null })
  const [saving, setSaving]   = useState(false)
  const inputId = useId(), editButton = useRef<HTMLButtonElement>(null), pending = useRef(false)
  const editInput = useRef<HTMLInputElement>(null), toggleButton = useRef<HTMLButtonElement>(null)
  const wasEditing = useRef(false)
  useEffect(() => {
    if (wasEditing.current && !editing && !saving) editButton.current?.focus()
    if (!saving) wasEditing.current = editing
  }, [editing, saving])
  const focusEdit = () => requestAnimationFrame(() => editButton.current?.focus())

  const save = async () => {
    if (pending.current || !draft.trim()) return
    if (draft.trim() === prompt.question && context.language === (readPromptLanguage(prompt.language) ?? '') && context.market === (prompt.market ?? null)) { setEditing(false); focusEdit(); return }
    pending.current = true
    setSaving(true)
    try {
      if (await onEdit(prompt.id, draft.trim(), { ...(isPromptLanguage(context.language) ? { language: context.language } : {}), market: context.market })) { setEditing(false); focusEdit() }
      else requestAnimationFrame(() => { if (document.activeElement === document.body) editInput.current?.focus() })
    } finally { pending.current = false; setSaving(false) }
  }

  const cancel = () => { if (pending.current) return; setDraft(prompt.question); setContext({ language: readPromptLanguage(prompt.language) ?? '', market: prompt.market ?? null }); setEditing(false); focusEdit() }
  async function toggle() {
    if (pending.current || editing) return
    pending.current = true; setSaving(true)
    try { await onToggle(prompt.id, !prompt.is_active) }
    finally { pending.current = false; setSaving(false); requestAnimationFrame(() => { if (document.activeElement === document.body) toggleButton.current?.focus() }) }
  }

  return (
    <div aria-busy={saving} className="flex flex-wrap items-center gap-2 px-3 py-2.5 border-b border-border last:border-0">
      <Toggle active={prompt.is_active} name={t('qb_toggle_label', { question: prompt.question })} buttonRef={toggleButton} disabled={saving || editing} onToggle={toggle} />
      {editing ? (
        <div className="flex w-full flex-wrap gap-2">
          <label className="sr-only" htmlFor={inputId}>{t('qb_edit_label', { question: prompt.question })}</label>
          <input id={inputId} ref={editInput} autoFocus value={draft} readOnly={saving} onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              // IME keys confirm or cancel composition before acting on the draft.
              // 229 also covers composition boundary events with isComposing=false.
              if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return
              if (e.key === 'Enter') { e.preventDefault(); void save() }
              if (e.key === 'Escape') cancel()
            }}
            className="min-h-11 min-w-0 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-primary" />
          <button type="button" onClick={save} disabled={saving || !draft.trim()}
            className={`${CONTROL} bg-primary text-primary-foreground`}>
            {saving ? '…' : t('save')}
          </button>
          <button type="button" onClick={cancel} disabled={saving} className={`${CONTROL} border border-border text-foreground`}>{t('cancel')}</button>
          <PromptContextFields {...context} onChange={setContext} disabled={saving} />
        </div>
      ) : (
        <>
          <span className={`min-w-0 flex-1 break-words text-sm text-foreground ${!prompt.is_active ? 'line-through' : ''}`}>
            {prompt.question}
          </span>
          <span className="text-xs text-muted-foreground">{readPromptLanguage(prompt.language) ?? `${t('qb_unknown_context')} (${prompt.language ?? '—'})`} · {isPromptMarket(prompt.market) ? prompt.market : t('qb_unspecified_market')}</span>
          <button type="button" ref={editButton} disabled={saving} onClick={() => { setDraft(prompt.question); setContext({ language: readPromptLanguage(prompt.language) ?? '', market: prompt.market ?? null }); setEditing(true) }} className={`${CONTROL} shrink-0 text-foreground`} aria-label={t('qb_edit_label', { question: prompt.question })} title={t('edit')}><span aria-hidden="true">✏️</span></button>
          <button type="button" id={`prompt-delete-${prompt.id}`} disabled={saving} onClick={() => onDelete(prompt.id)} className={`${CONTROL} shrink-0 text-destructive`} aria-label={t('qb_delete_label', { question: prompt.question })} title={t('delete')}><span aria-hidden="true">🗑</span></button>
        </>
      )}
    </div>
  )
}

function AddPromptRow({ category, clientId, onAdd, onError, onStart, contextDefaults }: {
  category: string
  clientId: string
  onAdd: (p: PromptBankItem) => void
  onError: (message: string) => void
  onStart: () => void
  contextDefaults?: PromptContextDefaults
}) {
  const t = useTranslations('pulse')
  const [text, setText]       = useState('')
  const [loading, setLoading] = useState(false)
  const inputId = useId()
  const locale = useLocale()
  const [context, setContext] = useState<{ language: string; market: string | null }>({ language: readPromptLanguage(contextDefaults?.language) ?? (locale === 'zh-HK' ? 'zh-HK' : 'en'), market: isPromptMarket(contextDefaults?.market) ? contextDefaults.market : null })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!text.trim() || loading) return
    onStart()
    setLoading(true)
    try {
    // `category` is the stored value, not a display label — the route validates
    // it against the vocabulary and 400s otherwise.
    const res = await fetch(`/api/dashboard/clients/${clientId}/prompts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, question: text.trim(), ...context }),
    })
    if (res.ok) {
      const { prompt } = await res.json()
      onAdd(prompt); setText('')
    } else if (res.status === 409) {
      const body = await res.json().catch(() => ({}))
      onError(t('qb_limit_reached', { max: body.max ?? 50 }))
    } else {
      onError(t('qb_save_failed'))
    }
    } catch {
      onError(t('qb_save_failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2 px-3 py-2 bg-secondary">
      <label className="sr-only" htmlFor={inputId}>{t('qb_add_label', { category: t(promptCategoryLabelKey(category)) })}</label>
      <input id={inputId} value={text} onChange={e => setText(e.target.value)} disabled={loading}
        placeholder={t('add_prompt_ph')}
        className="min-h-11 min-w-0 flex-1 rounded-lg border border-border px-3 bg-background text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-primary" />
      <button type="submit" disabled={loading || !text.trim()} className={`${CONTROL} border border-border text-foreground`}>{loading ? t('qb_saving') : t('qb_add')}</button>
      <PromptContextFields {...context} onChange={setContext} disabled={loading} />
    </form>
  )
}

export function PromptBankEditor({ clientId, prompts, onPromptsChange, contextDefaults }: Props) {
  const t = useTranslations('pulse')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [error, setError]         = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const current = useRef(prompts)
  useEffect(() => { current.current = prompts }, [prompts])

  // Keeps the existing updater-function call sites working against a controlled
  // list, so the optimistic-update-and-revert logic below is unchanged.
  const setPrompts = (update: (current: PromptBankItem[]) => PromptBankItem[]) => {
    current.current = update(current.current)
    onPromptsChange(current.current)
  }

  const grouped = groupByCategory(prompts)
  // The canonical four always render, in order, even when empty — they are what
  // a user adds into. Anything else present (a legacy value, or NULL) gets a
  // trailing section so those rows stay visible and editable.
  const allCategories = [
    ...PROMPT_CATEGORIES,
    ...(grouped[UNCATEGORISED] ? [UNCATEGORISED] : []),
  ]

  const toggleSection = (cat: string) =>
    setCollapsed(prev => ({ ...prev, [cat]: !prev[cat] }))

  // Every mutation reverts its optimistic update when the server refuses.
  // Without this a refused write — an unentitled plan, a lost session, a lookup
  // failure — leaves the UI showing a change that was never persisted, and the
  // next reload silently undoes it.
  const revertOn = async (res: Response | null, undo: () => void) => {
    if (res?.ok) { setStatus(t('qb_saved')); return true }
    undo()
    setError(t('qb_save_failed'))
    setStatus('')
    return false
  }

  const handleToggle = async (id: string, is_active: boolean) => {
    setError(null)
    setStatus('')
    setPrompts(ps => ps.map(p => p.id === id ? { ...p, is_active } : p))
    const res = await fetch(`/api/dashboard/clients/${clientId}/prompts/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active }),
    }).catch(() => null)
    await revertOn(res, () =>
      setPrompts(ps => ps.map(p => p.id === id ? { ...p, is_active: !is_active } : p)))
  }

  const handleEdit = async (id: string, question: string, context: PromptContextDefaults = {}) => {
    setError(null)
    setStatus('')
    const previous = current.current.find(p => p.id === id)
    const changes = { question, ...(isPromptLanguage(context.language) ? { language: context.language } : {}), ...(context.market !== undefined ? { market: context.market as string | null } : {}) }
    setPrompts(ps => ps.map(p => p.id === id ? { ...p, ...changes } : p))
    const res = await fetch(`/api/dashboard/clients/${clientId}/prompts/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    }).catch(() => null)
    return await revertOn(res, () => setPrompts(ps => ps.map(p =>
      p.id === id && previous !== undefined ? { ...p, question: previous.question, language: previous.language, market: previous.market } : p)))
  }

  const handleDelete = async (id: string) => {
    setError(null)
    setStatus('')
    const removed = prompts.find(p => p.id === id)
    const at = prompts.findIndex(p => p.id === id)
    setPrompts(ps => ps.filter(p => p.id !== id))
    const res = await fetch(`/api/dashboard/clients/${clientId}/prompts/${id}`, { method: 'DELETE' }).catch(() => null)
    const accepted = await revertOn(res, () => setPrompts(ps => {
      if (!removed) return ps
      const next = ps.filter(p => p.id !== id)
      next.splice(at, 0, removed)
      return next
    }))
    if (!accepted && typeof window !== 'undefined') requestAnimationFrame(() => document.getElementById(`prompt-delete-${id}`)?.focus())
  }

  const handleAdd = (prompt: PromptBankItem) => { setPrompts(ps => [...ps, prompt]); setError(null); setStatus(t('qb_saved')) }

  const activeCount = prompts.filter(p => p.is_active).length

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-4">{t('qb_count', { active: activeCount, total: prompts.length })}</p>
      <p role="status" className="text-sm text-muted-foreground" aria-live="polite">{status}</p>
      {error && (
        <p role="alert" className="text-xs text-red-600 mb-4">{error}</p>
      )}
      <div className="space-y-4">
        {allCategories.map(cat => {
          const items = grouped[cat] ?? []
          const isCollapsed = collapsed[cat]
          const canAdd = cat !== UNCATEGORISED
          return (
            <div key={cat}>
              <button type="button" aria-expanded={!isCollapsed} onClick={() => toggleSection(cat)} className={`${CONTROL} flex items-center gap-2 mb-2 w-full text-left`}>
                <span className="text-sm font-bold text-foreground">
                  {t(promptCategoryLabelKey(canAdd ? cat : null))}
                </span>
                <span className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">{items.length}</span>
                <span aria-hidden="true" className="text-xs text-muted-foreground ml-auto">{isCollapsed ? '▶' : '▼'}</span>
              </button>
              {!isCollapsed && (
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                  {items.map(p => (
                    <PromptRow key={p.id} prompt={p}
                      onToggle={handleToggle} onEdit={handleEdit} onDelete={handleDelete} />
                  ))}
                  {/* No add row for the uncategorised section — POST validates
                      against the vocabulary, so adding there would 400. */}
                  {canAdd && (
                    <AddPromptRow category={cat} clientId={clientId} contextDefaults={contextDefaults}
                      onAdd={handleAdd} onError={setError} onStart={() => { setStatus(''); setError(null) }} />
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
