// components/pulse/SuggestQuestionsPanel.tsx
'use client'
import { useState } from 'react'
import { X, Sparkles, Check } from 'lucide-react'

interface Suggestion {
  question: string
  category: string
}

interface Props {
  clientId: string
  onClose: () => void
  onAccepted: (question: string, category: string) => void
}

export function SuggestQuestionsPanel({ clientId, onClose, onAccepted }: Props) {
  const [loading, setLoading] = useState(false)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [editing, setEditing] = useState<Record<number, string>>({})
  const [dismissed, setDismissed] = useState<Set<number>>(new Set())
  const [fetched, setFetched] = useState(false)

  async function fetchSuggestions() {
    setLoading(true)
    const res = await fetch('/api/pulse/suggest-questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, count: 5 }),
    })
    const data = await res.json()
    setSuggestions(data.suggestions ?? [])
    setFetched(true)
    setLoading(false)
  }

  async function accept(i: number) {
    const question = editing[i] ?? suggestions[i]?.question ?? ''
    const category = suggestions[i]?.category ?? 'brand_query'
    await fetch(`/api/dashboard/clients/${clientId}/prompts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, category, language: 'en' }),
    })
    onAccepted(question, category)
    setDismissed(prev => new Set([...prev, i]))
  }

  const visible = suggestions.filter((_, i) => !dismissed.has(i))

  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-sm bg-white border-l border-slate-200 shadow-2xl z-50 flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <span className="font-bold text-slate-900 text-sm">AI Question Suggestions</span>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700 transition-colors">
          <X className="size-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {!fetched ? (
          <div className="text-center py-8">
            <p className="text-sm text-slate-500 mb-4">Generate 5 new question ideas based on your brand, industry, and existing questions.</p>
            <button
              onClick={fetchSuggestions}
              disabled={loading}
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground font-semibold px-6 py-2.5 rounded-xl text-sm hover:bg-primary/90 transition disabled:opacity-60"
            >
              {loading ? 'Generating…' : '✨ Generate suggestions'}
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="text-center py-8 text-sm text-slate-400">All suggestions have been accepted or dismissed.</div>
        ) : (
          <div className="space-y-3">
            {suggestions.map((s, i) => {
              if (dismissed.has(i)) return null
              const currentText = editing[i] ?? s.question
              return (
                <div key={i} className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">{s.category.replace('_', ' ')}</div>
                  <textarea
                    value={currentText}
                    onChange={e => setEditing(prev => ({ ...prev, [i]: e.target.value }))}
                    rows={2}
                    className="w-full text-sm text-slate-700 bg-white border border-slate-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary/40 mb-3"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => accept(i)}
                      className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-500 text-white font-semibold text-xs py-1.5 rounded-lg hover:bg-emerald-600 transition"
                    >
                      <Check className="size-3" /> Accept
                    </button>
                    <button
                      onClick={() => setDismissed(prev => new Set([...prev, i]))}
                      className="flex items-center justify-center gap-1 bg-slate-200 text-slate-600 font-semibold text-xs px-3 py-1.5 rounded-lg hover:bg-slate-300 transition"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
