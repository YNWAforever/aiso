import type { StudioWeek } from '@/lib/conversation-studio/overview'

export type WeeklySummary = {
  /** Newest first, independent of the order the loader returned. */
  weeks: StudioWeek[]
  latest: StudioWeek
  previous: StudioWeek | null
  /** Percentage points against the previous saved week; null when no honest comparison exists. */
  delta: number | null
}

function roundOne(value: number): number {
  const rounded = Math.round(value * 10) / 10
  return Object.is(rounded, -0) ? 0 : rounded
}

/** A percentage that may be shown. A week with no answers has no percentage, not 0%. */
export function weekPercent(week: StudioWeek): number | null {
  if (!Number.isFinite(week.sovScore) || !Number.isFinite(week.totalQueries) || week.totalQueries <= 0) return null
  return roundOne(week.sovScore)
}

/**
 * Summarises the saved weekly rollup without inventing a comparison.
 *
 * Weeks can be missing, so the delta is explicitly against the previous *saved*
 * week. If either week has no answers, the caller must show the no-comparison
 * state rather than a zero delta.
 */
export function summarizeStudioWeeks(weeks: StudioWeek[]): WeeklySummary | null {
  if (!weeks.length) return null
  const ordered = [...weeks].sort((left, right) => right.week.localeCompare(left.week))
  const latest = ordered[0]
  const previous = ordered[1] ?? null
  const latestPercent = weekPercent(latest)
  const previousPercent = previous ? weekPercent(previous) : null
  const delta = previous && latestPercent !== null && previousPercent !== null
    ? roundOne(latestPercent - previousPercent)
    : null
  return { weeks: ordered, latest, previous, delta }
}
