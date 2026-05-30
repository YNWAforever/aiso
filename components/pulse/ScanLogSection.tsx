// components/pulse/ScanLogSection.tsx
'use client'
import { useState, useMemo } from 'react'
import { QuestionRow } from './QuestionRow'
import type { PulseMetric } from '@/lib/types'

interface Props {
  metrics: PulseMetric[]
  scanWeek: string
  brandName: string
  onEditQuestion?: (question: string) => void
}

type Filter = 'all' | 'not_mentioned'

export function ScanLogSection({ metrics, scanWeek, brandName, onEditQuestion }: Props) {
  const [filter, setFilter] = useState<Filter>('all')

  // Group metrics by question
  const byQuestion = useMemo(() => {
    const map = new Map<string, PulseMetric[]>()
    for (const m of metrics) {
      const key = m.question
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(m)
    }
    return map
  }, [metrics])

  // Apply filters
  const filteredQuestions = useMemo(() => {
    return Array.from(byQuestion.entries()).filter(([, ms]) => {
      if (filter === 'not_mentioned' && ms.some(m => m.brand_mentioned)) return false
      return true
    })
  }, [byQuestion, filter])

  const totalMentioned = Array.from(byQuestion.values())
    .filter(ms => ms.some(m => m.brand_mentioned)).length
  const total = byQuestion.size

  if (metrics.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
        <p className="text-sm font-semibold text-slate-500">No scan data yet</p>
        <p className="text-xs text-slate-400 mt-1">Questions will appear here after the next weekly scan runs.</p>
      </div>
    )
  }

  return (
    <div id="scan-log">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest">This Week's Scans</h2>
          <p className="text-xs text-slate-400 mt-0.5">Week of {scanWeek} · {totalMentioned}/{total} questions mentioned {brandName}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {[
          { key: 'all' as Filter, label: 'All questions' },
          { key: 'not_mentioned' as Filter, label: 'Not mentioned only' },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`text-xs px-3 py-1.5 rounded-full font-semibold transition-colors ${filter === f.key ? 'bg-primary text-primary-foreground' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {filteredQuestions.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-400">No questions match this filter.</div>
        ) : (
          filteredQuestions.map(([question, ms]) => (
            <QuestionRow
              key={question}
              question={question}
              metrics={ms}
              onEditClick={onEditQuestion ? () => onEditQuestion(question) : undefined}
            />
          ))
        )}
      </div>
    </div>
  )
}
