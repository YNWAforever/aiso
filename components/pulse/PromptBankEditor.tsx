'use client'
import { useState } from 'react'
import type { PromptBankItem } from '@/lib/types'

interface Props {
  clientId: string
  initialPrompts: PromptBankItem[]
}

const CATEGORY_ORDER = ['Brand Queries', 'Pain Points', 'Category Queries', 'Intent Queries']

function groupByCategory(prompts: PromptBankItem[]): Record<string, PromptBankItem[]> {
  const result: Record<string, PromptBankItem[]> = {}
  for (const p of prompts) {
    if (!result[p.category]) result[p.category] = []
    result[p.category].push(p)
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
            {saving ? '…' : 'Save'}
          </button>
          <button onClick={cancel} className="text-xs border border-slate-200 text-slate-500 px-3 py-1 rounded">Cancel</button>
        </>
      ) : (
        <>
          <span className={`flex-1 text-sm ${!prompt.is_active ? 'line-through text-slate-400' : 'text-slate-700'}`}>
            {prompt.question}
          </span>
          <span className="text-xs text-slate-300 mr-1">{prompt.language}</span>
          <button onClick={() => setEditing(true)} className="text-slate-400 hover:text-slate-600 text-xs px-1" title="Edit">✏️</button>
          <button onClick={() => onDelete(prompt.id)} className="text-red-300 hover:text-red-500 text-xs px-1" title="Delete">🗑</button>
        </>
      )}
    </div>
  )
}

function AddPromptRow({ category, clientId, onAdd }: {
  category: string; clientId: string; onAdd: (p: PromptBankItem) => void
}) {
  const [text, setText]       = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    setLoading(true)
    const res = await fetch(`/api/dashboard/clients/${clientId}/prompts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, question: text.trim(), language: 'en' }),
    })
    if (res.ok) { const { prompt } = await res.json(); onAdd(prompt); setText('') }
    setLoading(false)
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2 px-4 py-2 bg-slate-50">
      <div className="w-9 flex-shrink-0" />
      <input value={text} onChange={e => setText(e.target.value)} disabled={loading}
        placeholder="+ Type a new prompt and press Enter…"
        className="flex-1 text-sm border border-dashed border-slate-300 rounded px-2 py-1.5 bg-white text-slate-500 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-400" />
    </form>
  )
}

export function PromptBankEditor({ clientId, initialPrompts }: Props) {
  const [prompts, setPrompts]     = useState<PromptBankItem[]>(initialPrompts)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const grouped = groupByCategory(prompts)
  const allCategories = [
    ...CATEGORY_ORDER,
    ...Object.keys(grouped).filter(c => !CATEGORY_ORDER.includes(c)),
  ]

  const toggleSection = (cat: string) =>
    setCollapsed(prev => ({ ...prev, [cat]: !prev[cat] }))

  const handleToggle = async (id: string, is_active: boolean) => {
    setPrompts(ps => ps.map(p => p.id === id ? { ...p, is_active } : p))
    await fetch(`/api/dashboard/clients/${clientId}/prompts/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active }),
    })
  }

  const handleEdit = async (id: string, question: string) => {
    setPrompts(ps => ps.map(p => p.id === id ? { ...p, question } : p))
    await fetch(`/api/dashboard/clients/${clientId}/prompts/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    })
  }

  const handleDelete = async (id: string) => {
    setPrompts(ps => ps.filter(p => p.id !== id))
    await fetch(`/api/dashboard/clients/${clientId}/prompts/${id}`, { method: 'DELETE' })
  }

  const handleAdd = (prompt: PromptBankItem) => setPrompts(ps => [...ps, prompt])

  const activeCount = prompts.filter(p => p.is_active).length

  return (
    <div>
      <p className="text-xs text-slate-400 mb-4">{activeCount} active / {prompts.length} total</p>
      <div className="space-y-4">
        {allCategories.map(cat => {
          const items = grouped[cat] ?? []
          const isCollapsed = collapsed[cat]
          return (
            <div key={cat}>
              <button onClick={() => toggleSection(cat)} className="flex items-center gap-2 mb-2 w-full text-left">
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wide">{cat}</span>
                <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{items.length}</span>
                <span className="text-xs text-slate-400 ml-auto">{isCollapsed ? '▶' : '▼'}</span>
              </button>
              {!isCollapsed && (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  {items.map(p => (
                    <PromptRow key={p.id} prompt={p}
                      onToggle={handleToggle} onEdit={handleEdit} onDelete={handleDelete} />
                  ))}
                  <AddPromptRow category={cat} clientId={clientId} onAdd={handleAdd} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
