'use client'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { PROMPT_CATEGORIES, promptCategoryLabelKey } from '@/lib/prompts/categories'
import type { PromptBankItem } from '@/lib/types'

interface Props {
  clientId: string
  initialPrompts: PromptBankItem[]
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

function Toggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${active ? 'bg-green-500' : 'bg-slate-300'}`}>
      <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition ${active ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
  )
}

function PromptRow({ prompt, onToggle, onEdit, onDelete }: {
  prompt: PromptBankItem
  onToggle: (id: string, is_active: boolean) => Promise<void>
  onEdit:   (id: string, question: string)   => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const t = useTranslations('pulse')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(prompt.question)
  const [saving, setSaving]   = useState(false)

  const save = async () => {
    if (!draft.trim() || draft === prompt.question) { setEditing(false); return }
    setSaving(true)
    await onEdit(prompt.id, draft.trim())
    setSaving(false); setEditing(false)
  }

  const cancel = () => { setDraft(prompt.question); setEditing(false) }

  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 border-b border-slate-50 last:border-0 ${editing ? 'bg-blue-50' : ''} ${!prompt.is_active ? 'opacity-50' : ''}`}>
      <Toggle active={prompt.is_active} onToggle={() => onToggle(prompt.id, !prompt.is_active)} />
      {editing ? (
        <>
          <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel() }}
            className="flex-1 text-sm border border-blue-400 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500" />
          <button onClick={save} disabled={saving}
            className="text-xs bg-blue-600 text-white px-3 py-1 rounded font-semibold disabled:opacity-50">
            {saving ? '…' : t('save')}
          </button>
          <button onClick={cancel} className="text-xs border border-slate-200 text-slate-500 px-3 py-1 rounded">{t('cancel')}</button>
        </>
      ) : (
        <>
          <span className={`flex-1 text-sm ${!prompt.is_active ? 'line-through text-slate-400' : 'text-slate-700'}`}>
            {prompt.question}
          </span>
          <span className="text-xs text-slate-300 mr-1">{prompt.language}</span>
          <button onClick={() => setEditing(true)} className="text-slate-400 hover:text-slate-600 text-xs px-1" title={t('edit')}>✏️</button>
          <button onClick={() => onDelete(prompt.id)} className="text-red-300 hover:text-red-500 text-xs px-1" title={t('delete')}>🗑</button>
        </>
      )}
    </div>
  )
}

function AddPromptRow({ category, clientId, onAdd, onError }: {
  category: string
  clientId: string
  onAdd: (p: PromptBankItem) => void
  onError: (message: string) => void
}) {
  const t = useTranslations('pulse')
  const [text, setText]       = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    setLoading(true)
    // `category` is the stored value, not a display label — the route validates
    // it against the vocabulary and 400s otherwise.
    const res = await fetch(`/api/dashboard/clients/${clientId}/prompts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, question: text.trim(), language: 'en' }),
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
    setLoading(false)
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2 px-4 py-2 bg-slate-50">
      <div className="w-9 flex-shrink-0" />
      <input value={text} onChange={e => setText(e.target.value)} disabled={loading}
        placeholder={t('add_prompt_ph')}
        className="flex-1 text-sm border border-dashed border-slate-300 rounded px-2 py-1.5 bg-white text-slate-500 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-400" />
    </form>
  )
}

export function PromptBankEditor({ clientId, initialPrompts }: Props) {
  const t = useTranslations('pulse')
  const [prompts, setPrompts]     = useState<PromptBankItem[]>(initialPrompts)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [error, setError]         = useState<string | null>(null)

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
  const revertOn = async (res: Response, undo: () => void) => {
    if (res.ok) return true
    undo()
    setError(t('qb_save_failed'))
    return false
  }

  const handleToggle = async (id: string, is_active: boolean) => {
    setError(null)
    setPrompts(ps => ps.map(p => p.id === id ? { ...p, is_active } : p))
    const res = await fetch(`/api/dashboard/clients/${clientId}/prompts/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active }),
    })
    await revertOn(res, () =>
      setPrompts(ps => ps.map(p => p.id === id ? { ...p, is_active: !is_active } : p)))
  }

  const handleEdit = async (id: string, question: string) => {
    setError(null)
    const previous = prompts.find(p => p.id === id)?.question
    setPrompts(ps => ps.map(p => p.id === id ? { ...p, question } : p))
    const res = await fetch(`/api/dashboard/clients/${clientId}/prompts/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    })
    await revertOn(res, () => setPrompts(ps => ps.map(p =>
      p.id === id && previous !== undefined ? { ...p, question: previous } : p)))
  }

  const handleDelete = async (id: string) => {
    setError(null)
    const removed = prompts.find(p => p.id === id)
    const at = prompts.findIndex(p => p.id === id)
    setPrompts(ps => ps.filter(p => p.id !== id))
    const res = await fetch(`/api/dashboard/clients/${clientId}/prompts/${id}`, { method: 'DELETE' })
    await revertOn(res, () => setPrompts(ps => {
      if (!removed) return ps
      const next = [...ps]
      next.splice(at, 0, removed)
      return next
    }))
  }

  const handleAdd = (prompt: PromptBankItem) => setPrompts(ps => [...ps, prompt])

  const activeCount = prompts.filter(p => p.is_active).length

  return (
    <div>
      <p className="text-xs text-slate-400 mb-4">{t('qb_count', { active: activeCount, total: prompts.length })}</p>
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
              <button onClick={() => toggleSection(cat)} className="flex items-center gap-2 mb-2 w-full text-left">
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                  {t(promptCategoryLabelKey(canAdd ? cat : null))}
                </span>
                <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{items.length}</span>
                <span className="text-xs text-slate-400 ml-auto">{isCollapsed ? '▶' : '▼'}</span>
              </button>
              {!isCollapsed && (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  {items.map(p => (
                    <PromptRow key={p.id} prompt={p}
                      onToggle={handleToggle} onEdit={handleEdit} onDelete={handleDelete} />
                  ))}
                  {/* No add row for the uncategorised section — POST validates
                      against the vocabulary, so adding there would 400. */}
                  {canAdd && (
                    <AddPromptRow category={cat} clientId={clientId}
                      onAdd={handleAdd} onError={setError} />
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
