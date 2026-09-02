'use client'
import { useState } from 'react'
import { useLocale } from 'next-intl'
import type { CheckResult } from '@/lib/types'
import type { CheckExplanation } from '@/lib/checkExplanations'

const COPY_EN = {
  question: 'What this checks',
  whyItMatters: 'Why it matters',
  whatWeFound: 'What we found',
  status: 'Status',
  howToFix: 'How to fix',
}

// Typed `typeof COPY_EN` deliberately: adding a key above forces it here too,
// so a label cannot ship untranslated.
const COPY_ZH_HK: typeof COPY_EN = {
  question: '這項檢查甚麼',
  whyItMatters: '為何重要',
  whatWeFound: '掃描發現',
  status: '狀態',
  howToFix: '如何修復',
}

const STATUS_ICON  = { pass: '✅', warn: '⚠️', fail: '❌' } as const
const STATUS_COLOR = {
  pass: 'text-green-700',
  warn: 'text-amber-700',
  fail: 'text-red-700',
} as const
const STATUS_DETAIL_BG = {
  pass: 'bg-green-50  border-green-100',
  warn: 'bg-amber-50  border-amber-100',
  fail: 'bg-red-50    border-red-100',
} as const

interface Props {
  label:       string
  result:      CheckResult
  message:     string
  explanation?: CheckExplanation
}

export function ExpandableCheckItem({ label, result, message, explanation }: Props) {
  const locale = useLocale()
  const c = locale === 'zh-HK' ? COPY_ZH_HK : COPY_EN
  const [open, setOpen] = useState(false)

  return (
    <div className="border-b border-slate-100 last:border-0">
      {/* Row */}
      <button
        onClick={() => explanation && setOpen(o => !o)}
        className={`w-full flex items-center justify-between py-2.5 text-left transition-colors ${explanation ? 'hover:bg-slate-50 cursor-pointer' : 'cursor-default'}`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0">{STATUS_ICON[result.status]}</span>
          <span className="text-sm text-slate-700 truncate">{label}</span>
        </div>
        <div className="flex items-center gap-2 ml-2 shrink-0">
          <span className={`text-xs ${STATUS_COLOR[result.status]}`}>{message}</span>
          {explanation && (
            <svg
              className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          )}
        </div>
      </button>

      {/* Expanded detail */}
      {open && explanation && (
        <div className={`mx-1 mb-3 rounded-lg border p-4 text-sm space-y-3 ${STATUS_DETAIL_BG[result.status]}`}>
          {/* What this checks */}
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">{c.question}</p>
            <p className="text-slate-700 leading-relaxed">{explanation.question}</p>
          </div>

          {/* Why it matters */}
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">{c.whyItMatters}</p>
            <p className="text-slate-700 leading-relaxed">{explanation.why}</p>
          </div>

          {/* What we found */}
          {result.details && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">{c.whatWeFound}</p>
              <p className="text-slate-700 font-mono text-xs bg-white/60 rounded px-2 py-1">{result.details}</p>
            </div>
          )}

          {/* How to fix */}
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">
              {result.status === 'pass' ? c.status : c.howToFix}
            </p>
            <p className="text-slate-700 leading-relaxed">{explanation.fix[result.status]}</p>
          </div>
        </div>
      )}
    </div>
  )
}
