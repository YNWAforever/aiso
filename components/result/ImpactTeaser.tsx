'use client'
import { TrendingUp, AlertTriangle } from 'lucide-react'
import { useLocale } from 'next-intl'
import type { ImpactReport, HeadlineStat } from '@/lib/impact'

interface Props {
  impact: ImpactReport
  score: number
}

/** zh-HK headline rendered from typed data — never from the English `text` field */
function headlineZhHk(stat: HeadlineStat): string {
  switch (stat.type) {
    case 'platforms_blocked':
      return `你的網站對 ${stat.count} 個主要 AI 平台完全隱形（共 ${stat.total} 個）`
    case 'low_readable':
      return `AI 引擎只能使用你大約 ${stat.percent}% 的內容`
    case 'benchmark_gap':
      return `你的分數比同行業平均低 ${stat.gap} 分`
    case 'score_uplift':
      return stat.delta > 0
        ? `快速修復可令你的分數提升 ${stat.delta} 分，達到 ${stat.projectedScore}（${stat.projectedGrade}）`
        : '你的網站在 AI 搜尋方面狀態良好'
  }
}

/**
 * Locked-phase impact tease — one headline stat + projected-score pill.
 * Shown between the #1 issue card and the locked preview to give the
 * email gate a concrete payoff.
 */
export function ImpactTeaser({ impact, score }: Props) {
  const locale = useLocale()
  const isZh = locale === 'zh-HK'
  const { headlineStat, projectedScore, projectedGrade } = impact
  const delta = Math.round((projectedScore - score) * 10) / 10
  const isAlarm = headlineStat.type !== 'score_uplift'
  const headline = isZh ? headlineZhHk(headlineStat) : headlineStat.text
  const unlockCopy = isZh
    ? `修復後你的分數可達 ${projectedScore}（${projectedGrade}）——解鎖即可查看方法`
    : `Your score could be ${projectedScore} (${projectedGrade}) after fixes — unlock to see how`

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
            {headline}
          </p>
          {delta > 0 && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold bg-emerald-100 text-emerald-700 px-2.5 py-1 rounded-full">
              <TrendingUp className="size-3" />
              {unlockCopy}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
