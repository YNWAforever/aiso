import { StatCard } from '@/components/ui/stat-card'
import type { OverviewStat, OverviewStats as Stats } from '@/lib/view-models/overview-stats'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'

/**
 * Three numbers from the stored scans: score (up is good), fixes left and
 * points to gain (down is good). Each carries its trend over the last scans,
 * and an arrow only when the latest two scans can be compared.
 */
export function OverviewStats({ stats, lang, resultsHref }: { stats: Stats; lang: string; resultsHref: string | null }) {
  const copy = (lang === 'zh-HK' ? zhHK : en).workspaceHome.stats
  const format = (value: number) => String(Number(value.toFixed(1)))
  const card = (key: 'score' | 'fixesLeft' | 'pointsToGain', stat: OverviewStat, invert: boolean, unit?: (n: string) => string) => (
    <StatCard
      key={key}
      label={copy[key]}
      value={stat.latest === null ? copy.unknown : format(stat.latest)}
      delta={stat.delta}
      deltaText={stat.delta === null ? undefined : unit ? unit(format(Math.abs(stat.delta))) : format(Math.abs(stat.delta))}
      invertDelta={invert}
      trend={stat.points.length > 1 ? stat.points : undefined}
      href={resultsHref ?? undefined}
      className="bg-dash-surface"
    />
  )
  return (
    <section aria-labelledby="overview-stats-heading" className="mb-8">
      <h2 id="overview-stats-heading" className="sr-only">{copy.title}</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        {card('score', stats.score, false, n => copy.points.replace('{n}', n))}
        {card('fixesLeft', stats.fixesLeft, true)}
        {card('pointsToGain', stats.pointsToGain, true, n => copy.points.replace('{n}', n))}
      </div>
    </section>
  )
}
