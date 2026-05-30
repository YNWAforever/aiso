// components/pulse/QuestionRow.tsx
'use client'
import { useState } from 'react'
import type { PulseMetric } from '@/lib/types'

const PLATFORM_CONFIG: Record<string, { label: string; color: string }> = {
  'perplexity':   { label: 'Perplexity', color: '#6c6eed' },
  'gpt4o':        { label: 'GPT-4o',     color: '#10a37f' },
  'claude-haiku': { label: 'Claude',     color: '#d97706' },
  'gemini-flash': { label: 'Gemini',     color: '#4285f4' },
}

const PLATFORM_ORDER = ['perplexity', 'gpt4o', 'claude-haiku', 'gemini-flash']

interface Props {
  question: string
  metrics: PulseMetric[]   // all metrics for this question (up to 4 platforms)
  onEditClick?: () => void // scroll to question bank
}

export function QuestionRow({ question, metrics, onEditClick }: Props) {
  const [expanded, setExpanded] = useState(false)

  const mentionCount = metrics.filter(m => m.brand_mentioned).length
  const total = PLATFORM_ORDER.length

  // Dot colour per platform
  const dotColor = (platform: string) => {
    const m = metrics.find(m => m.platform === platform)
    if (!m) return '#e2e8f0'           // grey — not scanned
    if (m.brand_mentioned) return '#22c55e'  // green
    if (m.sentiment === 'positive') return '#f59e0b' // amber — indirect
    return '#ef4444'                   // red — not mentioned
  }

  return (
    <div className="border-b border-slate-100 last:border-0">
      {/* Collapsed row */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        {/* Platform dots */}
        <div className="flex gap-1 shrink-0">
          {PLATFORM_ORDER.map(p => (
            <div
              key={p}
              title={PLATFORM_CONFIG[p]?.label ?? p}
              className="size-3.5 rounded-full"
              style={{ background: dotColor(p) }}
            />
          ))}
        </div>

        {/* Question text */}
        <span className="flex-1 text-sm text-slate-700 truncate">{question}</span>

        {/* Mention count */}
        <span className={`text-xs font-bold shrink-0 ${mentionCount === 0 ? 'text-red-500' : mentionCount === total ? 'text-emerald-600' : 'text-amber-600'}`}>
          {mentionCount}/{total}
        </span>

        {/* Expand chevron */}
        <span className="text-slate-400 text-xs shrink-0">{expanded ? '▲' : '▼'}</span>

        {/* Edit button */}
        {onEditClick && (
          <button
            onClick={e => { e.stopPropagation(); onEditClick() }}
            title="Edit question"
            className="text-slate-300 hover:text-slate-600 text-xs shrink-0 px-1 transition-colors"
          >
            ✏️
          </button>
        )}
      </div>

      {/* Expanded — platform answer grid */}
      {expanded && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-4 pb-4">
          {PLATFORM_ORDER.map(platform => {
            const m = metrics.find(m => m.platform === platform)
            const cfg = PLATFORM_CONFIG[platform]
            if (!m) return (
              <div key={platform} className="rounded-xl border border-slate-100 bg-slate-50 p-3 opacity-40">
                <div className="text-xs font-bold text-slate-400 mb-1">{cfg?.label ?? platform}</div>
                <div className="text-xs text-slate-400 italic">Not scanned</div>
              </div>
            )
            const mentioned = m.brand_mentioned
            return (
              <div
                key={platform}
                className={`rounded-xl border p-3 ${mentioned ? 'border-emerald-200 bg-emerald-50' : 'border-red-100 bg-red-50'}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold" style={{ color: cfg?.color }}>{cfg?.label ?? platform}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${mentioned ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                    {mentioned ? '✓ Mentioned' : '✗ Not mentioned'}
                  </span>
                </div>
                {/* Answer snippet with brand highlighted */}
                <p className="text-xs text-slate-600 leading-relaxed line-clamp-4">
                  {m.raw_answer
                    ? m.raw_answer.slice(0, 300).split('%%').map((part, i) =>
                        i % 2 === 1
                          ? <mark key={i} className="bg-yellow-200 text-yellow-900 px-0.5 rounded not-italic">{part}</mark>
                          : <span key={i}>{part}</span>
                      )
                    : <span className="italic text-slate-400">No answer recorded</span>
                  }
                </p>
                {/* Competitors mentioned */}
                {m.competitors_mentioned.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {m.competitors_mentioned.map(c => (
                      <span key={c} className="text-[10px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded-full">{c}</span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
