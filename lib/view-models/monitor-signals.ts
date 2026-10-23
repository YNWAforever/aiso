import type { PlatformCell } from '@/components/visuals/PlatformDots'
import type { PulseView } from '@/lib/view-models/pulse'

/**
 * Display names for the runtime platform keys stored in pulse_metrics.platform
 * (lib/pulse/platforms.ts, vocabulary 2). Product names, not translated. Gemini
 * is named as Gemini: it is the model Pulse asks, not Google's AI Overviews.
 */
const PLATFORM_NAMES: Record<string, string> = {
  'gpt-4o': 'ChatGPT',
  'perplexity-sonar': 'Perplexity',
  'perplexity-sonar-pro': 'Perplexity Pro',
  'gemini-flash': 'Gemini',
  'claude-haiku': 'Claude',
}
const ORDER = Object.keys(PLATFORM_NAMES)

export const GRID_WEEKS = 8

export type PlatformGrid = {
  platforms: { id: string; name: string }[]
  weeks: string[]
  cells: Record<string, PlatformCell[]>
}

/**
 * Platform × last eight weeks. Mentioned when the brand appeared in any
 * classified answer that week, absent when it appeared in none, not run when
 * there was no classified answer. "Cited" is never claimed: the weekly series
 * carries mention rates, not citations.
 */
export function buildPlatformGrid(series: PulseView['observations']['series']): PlatformGrid | null {
  const perPlatform = series.filter((s): s is typeof s & { platform: string } => typeof s.platform === 'string')
  if (!perPlatform.length) return null
  const weeks = (perPlatform[0]!.points.map(p => p.week)).slice(-GRID_WEEKS)
  const rank = (id: string) => (ORDER.indexOf(id) + ORDER.length + 1) % (ORDER.length + 1)
  const platforms = perPlatform
    .map(s => ({ id: s.platform, name: PLATFORM_NAMES[s.platform] ?? s.platform }))
    .sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id))
  const cells = Object.fromEntries(perPlatform.map(s => [s.platform, weeks.map(week => {
    const sov = s.points.find(p => p.week === week)?.sov ?? null
    return (sov === null ? 'notRun' : sov > 0 ? 'mentioned' : 'absent') as PlatformCell
  })]))
  return { platforms, weeks, cells }
}

export type CompetitorBar = { name: string | null; share: number; mentions: number }

/**
 * Brand and competitors by share of classified answers that named them, over
 * the last four weeks with data. The brand always stays in the chart; at most
 * five competitors join it. Null when there were no classified answers.
 */
export function buildCompetitorBars(rows: { name: string | null; mentions: number; answers: number }[] | undefined): CompetitorBar[] | null {
  const answers = rows?.[0]?.answers ?? 0
  if (!rows || answers <= 0) return null
  const share = (mentions: number) => Math.round((1000 * mentions) / answers) / 10
  const brand = rows.find(row => row.name === null)
  const competitors = rows.filter(row => row.name !== null && row.mentions > 0)
    .sort((a, b) => b.mentions - a.mentions || a.name!.localeCompare(b.name!))
    .slice(0, 5)
  return [brand ?? { name: null, mentions: 0, answers }, ...competitors]
    .map(row => ({ name: row.name, mentions: row.mentions, share: share(row.mentions) }))
}

export type MonitorStatus = { state: 'running' | 'stale' | 'never'; lastWeek: string | null }

/**
 * Whether weekly tracking is actually producing results. Pulse rolls up weekly;
 * a latest week more than 14 days old means the schedule has stopped (or never
 * started), whatever the configuration says.
 */
export function monitorStatus(latestWeek: string | null, now: Date): MonitorStatus {
  if (!latestWeek) return { state: 'never', lastWeek: null }
  const age = now.getTime() - Date.parse(`${latestWeek}T00:00:00Z`)
  return { state: Number.isFinite(age) && age <= 14 * 86_400_000 ? 'running' : 'stale', lastWeek: latestWeek }
}
