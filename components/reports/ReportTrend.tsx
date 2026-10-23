'use client'

import { useLocale, useTranslations } from 'next-intl'
import type { ReportTrendPoint } from '@/lib/reports/types'
import { formatScanScore } from '@/lib/score-display'

const W = 600
const H = 160

/**
 * The frozen score history on a fixed 0–100 axis, so a small move never looks
 * like a cliff. A segment into a point collected a different way is dashed and
 * that point hollow, with a note under the chart: the move may be the method.
 * Labels are HTML so they keep their size when the plot stretches; a visually
 * hidden table carries every value.
 */
export function ReportTrend({ trend, methodChanged, animate }: {
  trend: ReadonlyArray<ReportTrendPoint>
  methodChanged: boolean
  animate: boolean
}) {
  const t = useTranslations('reportPage')
  const locale = useLocale()
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' })
  const x = (i: number) => (W * i) / (trend.length - 1)
  const y = (score: number) => H * (1 - Math.max(0, Math.min(100, score)) / 100)
  const first = trend[0]!
  const last = trend[trend.length - 1]!
  const summary = t('trend_summary', { count: trend.length, first: formatScanScore(first.score), last: formatScanScore(last.score) })

  return (
    <div className="relative" {...(animate ? { 'data-reveal': '' } : {})}>
      <p className="text-sm font-semibold tabular-nums">{formatScanScore(first.score)} → {formatScanScore(last.score)}</p>
      <div className="mt-3 flex gap-2">
        <div aria-hidden="true" className="flex h-32 flex-col justify-between text-right text-xs tabular-nums text-muted-foreground print:h-28">
          <span>100</span><span>50</span><span>0</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="reveal-line-x relative h-32 print:h-28">
            <svg role="img" aria-label={summary} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="size-full overflow-visible">
              {[0, 50, 100].map(v => (
                <line key={v} x1={0} x2={W} y1={y(v)} y2={y(v)} strokeWidth={1} vectorEffect="non-scaling-stroke" className="stroke-border" />
              ))}
              {trend.slice(1).map((point, i) => (
                <line
                  key={point.date}
                  x1={x(i)} y1={y(trend[i]!.score)} x2={x(i + 1)} y2={y(point.score)}
                  strokeWidth={2.5} strokeLinecap="round" vectorEffect="non-scaling-stroke"
                  strokeDasharray={point.comparable ? undefined : '6 5'}
                  className="stroke-primary"
                />
              ))}
            </svg>
            {/* Round markers in HTML: the plot stretches, so SVG circles would turn into ellipses. */}
            {trend.map((point, i) => (
              <span
                key={point.date}
                aria-hidden="true"
                className={`absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary ${point.comparable ? 'bg-primary' : 'bg-card'}`}
                style={{ left: `${(100 * x(i)) / W}%`, top: `${(100 * y(point.score)) / H}%` }}
              />
            ))}
          </div>
          <div aria-hidden="true" className="mt-1 flex justify-between text-xs tabular-nums text-muted-foreground">
            <span>{date.format(new Date(first.date))}</span>
            <span>{date.format(new Date(last.date))}</span>
          </div>
        </div>
      </div>
      {methodChanged && <p className="mt-3 text-xs leading-5 text-muted-foreground">{t('trend_method_note')}</p>}
      <table className="sr-only">
        <caption>{t('trend_title')}</caption>
        <thead><tr><th scope="col">{t('trend_date')}</th><th scope="col">{t('trend_score')}</th><th scope="col">{t('trend_method')}</th></tr></thead>
        <tbody>
          {trend.map((point, i) => (
            <tr key={point.date}>
              <td>{date.format(new Date(point.date))}</td>
              <td>{formatScanScore(point.score)}</td>
              <td>{i === 0 ? '' : point.comparable ? t('trend_method_same') : t('trend_method_changed')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
