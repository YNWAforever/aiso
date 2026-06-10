'use client'
import { TrendingUp, AlertTriangle } from 'lucide-react'
import type { ImpactReport } from '@/lib/impact'

interface Props {
  impact: ImpactReport
  score: number
}

/**
 * Locked-phase impact tease — one headline stat + projected-score pill.
 * Shown between the #1 issue card and the locked preview to give the
 * email gate a concrete payoff.
 */
export function ImpactTeaser({ impact, score }: Props) {
  const { headlineStat, projectedScore, projectedGrade } = impact
  const delta = Math.round((projectedScore - score) * 10) / 10
  const isAlarm = headlineStat.type !== 'score_uplift'

  return (
    <div className={`rounded-2xl border p-6 ${isAlarm ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'}`}>
      <div className="flex items-start gap-3">
        <div className={`shrink-0 size-9 rounded-lg flex items-center justify-center ${isAlarm ? 'bg-red-100' : 'bg-emerald-100'}`}>
          {isAlarm
            ? <AlertTriangle className="size-4.5 text-red-600" />
            : <TrendingUp className="size-4.5 text-emerald-600" />}
        </div>
        <div className="min-w-0">
          <p className={`text-sm font-bold leading-snug ${isAlarm ? 'text-red-900' : 'text-slate-900'}`}>
            {headlineStat.text}
          </p>
          {delta > 0 && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold bg-emerald-100 text-emerald-700 px-2.5 py-1 rounded-full">
              <TrendingUp className="size-3" />
              Your score could be {projectedScore} ({projectedGrade}) after fixes — unlock to see how
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
