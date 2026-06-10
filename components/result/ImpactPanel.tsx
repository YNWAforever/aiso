'use client'
import { ArrowRight, Clock } from 'lucide-react'
import type { ImpactReport, PlatformStatus, Effort } from '@/lib/impact'

const STATUS_STYLES: Record<PlatformStatus, { dot: string; label: string; text: string }> = {
  visible: { dot: 'bg-emerald-500', label: 'Visible',  text: 'text-emerald-700' },
  partial: { dot: 'bg-amber-500',   label: 'Partial',  text: 'text-amber-700' },
  blocked: { dot: 'bg-red-500',     label: 'Blocked',  text: 'text-red-700' },
}

const EFFORT_STYLES: Record<Effort, { label: string; cls: string }> = {
  minutes: { label: '~10 min',  cls: 'bg-emerald-100 text-emerald-700' },
  hours:   { label: 'hours',    cls: 'bg-blue-100 text-blue-700' },
  days:    { label: 'days+',    cls: 'bg-slate-100 text-slate-600' },
}

interface Props {
  impact: ImpactReport
  score: number
  grade: string
}

/**
 * Unlocked-phase impact breakdown: platform visibility grid,
 * AI-readable gauge, now→after projection, ranked quick wins.
 */
export function ImpactPanel({ impact, score, grade }: Props) {
  const { platformVisibility, aiReadablePercent, quickWins, projectedScore, projectedGrade } = impact
  const delta = Math.round((projectedScore - score) * 10) / 10
  const topWins = quickWins.slice(0, 6)

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-6">
      <div>
        <p className="text-xs font-bold text-slate-500 tracking-widest mb-1">IMPACT ANALYSIS</p>
        <p className="text-xs text-slate-400">What your score means — and what fixing it would gain</p>
      </div>

      {/* Platform visibility */}
      {platformVisibility.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-600 mb-2">AI platform visibility</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {platformVisibility.map(p => {
              const s = STATUS_STYLES[p.status]
              return (
                <div key={p.platform} className="flex items-center gap-2.5 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                  <span className={`size-2 rounded-full shrink-0 ${s.dot}`} />
                  <span className="text-xs font-semibold text-slate-800 shrink-0">{p.label}</span>
                  <span className={`text-2xs font-bold ml-auto shrink-0 ${s.text}`}>{s.label}</span>
                </div>
              )
            })}
          </div>
          {platformVisibility.some(p => p.status !== 'visible') && (
            <p className="text-2xs text-slate-400 mt-1.5">
              {platformVisibility.find(p => p.status === 'blocked')?.reason
                ?? platformVisibility.find(p => p.status === 'partial')?.reason}
            </p>
          )}
        </div>
      )}

      {/* AI-readable gauge */}
      {aiReadablePercent !== null && (
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <p className="text-xs font-semibold text-slate-600">Content AI can actually use</p>
            <p className={`text-sm font-black tabular-nums ${
              aiReadablePercent >= 75 ? 'text-emerald-600' : aiReadablePercent >= 50 ? 'text-amber-600' : 'text-red-600'
            }`}>{aiReadablePercent}%</p>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                aiReadablePercent >= 75 ? 'bg-emerald-500' : aiReadablePercent >= 50 ? 'bg-amber-500' : 'bg-red-500'
              }`}
              style={{ width: `${aiReadablePercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Now → After projection */}
      {delta > 0 && (
        <div className="flex items-center justify-center gap-4 rounded-xl bg-slate-50 border border-slate-100 py-4">
          <div className="text-center">
            <p className="text-2xl font-black text-slate-900 tabular-nums leading-none">{score}</p>
            <p className="text-2xs text-slate-400 font-semibold mt-1">Now · {grade}</p>
          </div>
          <ArrowRight className="size-4 text-slate-300" />
          <div className="text-center">
            <p className="text-2xl font-black text-emerald-600 tabular-nums leading-none">{projectedScore}</p>
            <p className="text-2xs text-emerald-600/70 font-semibold mt-1">After fixes · {projectedGrade}</p>
          </div>
          <span className="text-xs font-bold bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full">+{delta} pts</span>
        </div>
      )}

      {/* Quick wins */}
      {topWins.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-600 mb-2">Highest-impact fixes first</p>
          <div className="space-y-1.5">
            {topWins.map(w => (
              <a
                key={w.key}
                href={`#${w.key}`}
                className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2.5 hover:bg-slate-50 transition group"
              >
                <span className="text-xs font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full shrink-0 tabular-nums">
                  +{w.pointsGain} pts
                </span>
                <span className="text-xs text-slate-700 font-medium min-w-0 truncate group-hover:text-slate-900">
                  {w.label}
                </span>
                <span className={`ml-auto shrink-0 inline-flex items-center gap-1 text-2xs font-semibold px-1.5 py-0.5 rounded ${EFFORT_STYLES[w.effort].cls}`}>
                  <Clock className="size-2.5" />
                  {EFFORT_STYLES[w.effort].label}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
