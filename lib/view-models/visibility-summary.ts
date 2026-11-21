import type { PulseCoverageView, PulseDisplayState, PulsePoint, PulseView } from './pulse'

/**
 * What the first "What AI says" tab can say from the stored Pulse view.
 *
 * The visibility tab used to hide every number inside a collapsed disclosure;
 * this projection keeps the presentation decision separate from the raw view so
 * the empty, partial and error cases can be tested without rendering JSX.
 *
 * Delta is only reported when both weeks are complete: a partial week has fewer
 * classified answers, so comparing it with a complete week would call sampling
 * loss a visibility change.
 */
export type VisibilityMissedGroup = {
  question: string
  promptId?: string
  platforms: string[]
  competitors: string[]
  week: string | null
  count: number
}

export type VisibilityOverview = {
  state: 'ready' | Exclude<PulseDisplayState, 'complete'>
  latestWeek: string | null
  runId?: string
  sov: number | null
  /** Percentage points vs the previous comparable week; null when incomparable. */
  delta: number | null
  previousWeek: string | null
  coverage: PulseCoverageView | null
  platformCount: number
  activeQuestions: number | null
  missedGroups: VisibilityMissedGroup[]
  trend: PulsePoint[]
}

function comparable(point: PulsePoint | undefined): point is PulsePoint & { sov: number } {
  return point !== undefined && point.sov !== null && (point.state === undefined || point.state === 'complete')
}

function groupMissed(view: PulseView, latestWeek: string | null): VisibilityMissedGroup[] {
  if (view.missed.state !== 'ready') return []
  const groups = new Map<string, VisibilityMissedGroup>()
  for (const row of view.missed.data) {
    if (latestWeek !== null && row.scan_week !== latestWeek) continue
    const question = row.question
    if (!question.trim()) continue
    const key = JSON.stringify([row.prompt_id ?? null, question])
    const group = groups.get(key) ?? { question, ...(row.prompt_id ? { promptId: row.prompt_id } : {}), platforms: [], competitors: [], week: null, count: 0 }
    if (!group.platforms.includes(row.platform)) group.platforms.push(row.platform)
    for (const competitor of row.competitors_mentioned) {
      if (!group.competitors.includes(competitor)) group.competitors.push(competitor)
    }
    if (row.scan_week && (group.week === null || row.scan_week > group.week)) group.week = row.scan_week
    group.count += 1
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.question.localeCompare(b.question))
}

export function buildVisibilityOverview(view: PulseView): VisibilityOverview {
  const aggregate = view.observations.series.find(series => series.platform === null)
  const trend = aggregate?.points ?? []
  const latestWeek = view.observations.latestWeek
  const kpi = view.observations.latestKpi
  const coverage = view.observations.coverage ?? null

  const observedState = view.observations.state
  let state: VisibilityOverview['state'] = observedState === 'complete' || observedState === 'ready'
    ? kpi === null ? 'partial' : 'ready'
    : observedState
  if (state === 'ready' && coverage !== null && coverage.recorded > 0 && coverage.classified < coverage.recorded) {
    state = 'partial'
  }

  const latestPoint = latestWeek === null ? undefined : trend.find(point => point.week === latestWeek)
  const sov = state === 'error' ? null : latestPoint?.sov ?? kpi?.sovScore ?? null

  let delta: number | null = null
  let previousWeek: string | null = null
  if (state === 'ready' && latestWeek !== null && latestPoint !== undefined && comparable(latestPoint) && sov !== null) {
    const index = trend.indexOf(latestPoint)
    const previous = trend.slice(0, Math.max(0, index)).reverse().find((point): point is PulsePoint & { sov: number } => comparable(point) && point.cohort === latestPoint.cohort)
    if (previous !== undefined && previous.sov !== null) {
      delta = Math.round((sov - previous.sov) * 10) / 10
      previousWeek = previous.week
    }
  }

  // The platform count is a latest-week fact, not the number of platforms that
  // have ever appeared in the forty-week window.
  const platformsWithData = latestWeek === null ? 0 : view.observations.series.filter(series =>
    series.platform !== null && series.points.some(point => point.week === latestWeek && point.sov !== null),
  ).length
  const platformCount = kpi?.platformCount ?? platformsWithData

  const activeQuestions = view.prompts.state === 'ready' ? view.prompts.data.filter(prompt => prompt.is_active).length : null

  return {
    state,
    latestWeek,
    ...(view.observations.canonical && coverage?.provenance === 'ledger' ? { runId: view.observations.canonical.id } : {}),
    sov,
    delta,
    previousWeek,
    coverage,
    platformCount,
    activeQuestions,
    missedGroups: state === 'error' ? [] : groupMissed(view, latestWeek),
    trend,
  }
}
