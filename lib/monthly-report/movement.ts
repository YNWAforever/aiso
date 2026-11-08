/**
 * Retainer OS Slice C: Q1, the movement rule.
 *
 * Weekly Pulse on a handful of platforms is noisy — a month holds about four
 * points per platform, and one good week flips a share-of-voice number. The
 * rule's job is therefore to refuse a verdict more often than it gives one:
 * a direction is only reported when at least three consecutive weeks move the
 * same way, every week has enough answers behind it, and the weekly readings
 * are actually consecutive calendar weeks. Everything else is
 * "not enough data yet", which is a valid and expected result, never a zero.
 *
 * Pure: the inputs are the stored weekly rollups and the two recorded month
 * snapshots, and nothing here reads or writes the database.
 */

/** Bump when the thresholds change: a frozen report records which rule produced it. */
export const MOVEMENT_RULE_VERSION = 1
/** A verdict needs four weekly readings, so three week-to-week comparisons. */
export const MOVEMENT_MIN_WEEKS = 4
/**
 * Answers (queries) a week must hold to count. A week with one or two answers
 * moves share of voice by whole percentage points for no reason.
 */
export const MOVEMENT_MIN_ANSWERS_PER_WEEK = 5
/** Smaller week-to-week changes count as flat; sov_score is a percentage (0–100). */
export const MOVEMENT_MIN_DELTA = 0.5
/** The most recent this many usable weeks are judged; older ones cannot rescue a verdict. */
export const MOVEMENT_WEEK_WINDOW = 5
/** Three same-direction comparisons out of the window is the verdict. */
export const MOVEMENT_MIN_CONSISTENT_DELTAS = 3

/** One platform's weekly rollup, as stored in `pulse_weekly_summary`. */
export type PulseWeekReading = { week: string; sov: number | null; answers: number | null }
/** The same reading with the platform it belongs to, which is what the section groups by. */
export type PulsePlatformWeek = PulseWeekReading & { platform: string }

export type MovementReason =
  | 'insufficient_weeks'   // not four consecutive usable weeks
  | 'insufficient_answers' // enough weeks, but too few answers behind them
  | 'no_clear_trend'       // enough data, but the weeks disagree

export type MovementVerdict = {
  /** `null` means "not enough data yet"; `reason` says why. */
  direction: 'up' | 'down' | null
  reason: MovementReason | null
  /** Usable weeks inside the judged window. */
  weeks: number
}

const DAY_MS = 86_400_000
const weekIndex = (week: string) => Math.floor(Date.parse(`${week}T00:00:00Z`) / DAY_MS)
const round2 = (value: number) => Math.round(value * 100) / 100

/** Consecutive calendar weeks only: a missing week breaks the chain rather than being spanned. */
function deltasOf(readings: readonly PulseWeekReading[]): number[] {
  const deltas: number[] = []
  for (let index = 1; index < readings.length; index += 1) {
    const previous = readings[index - 1], current = readings[index]
    if (weekIndex(current.week) - weekIndex(previous.week) !== 7) continue
    deltas.push(round2((current.sov ?? 0) - (previous.sov ?? 0)))
  }
  return deltas
}

/**
 * The rule, in the brief's words: at least 3 of the 4 weeks must move the same
 * way, each week must hold at least MOVEMENT_MIN_ANSWERS_PER_WEEK answers, and
 * the weeks must be consecutive. Anything short of that is `not_enough_data`.
 */
export function decideMovement(readings: readonly PulseWeekReading[]): MovementVerdict {
  const ordered = [...readings].sort((a, b) => a.week.localeCompare(b.week))
  const withReading = ordered.filter((reading) => reading.sov !== null)
  const usable = withReading.filter((reading) => (reading.answers ?? 0) >= MOVEMENT_MIN_ANSWERS_PER_WEEK)
  const weeks = Math.min(usable.length, MOVEMENT_WEEK_WINDOW)
  if (usable.length < MOVEMENT_MIN_WEEKS) {
    return { direction: null, weeks,
      reason: withReading.length >= MOVEMENT_MIN_WEEKS ? 'insufficient_answers' : 'insufficient_weeks' }
  }
  const window = usable.slice(-MOVEMENT_WEEK_WINDOW)
  const deltas = deltasOf(window)
  const up = deltas.filter((delta) => delta >= MOVEMENT_MIN_DELTA).length
  const down = deltas.filter((delta) => delta <= -MOVEMENT_MIN_DELTA).length
  if (deltas.length < MOVEMENT_MIN_CONSISTENT_DELTAS) return { direction: null, weeks, reason: 'insufficient_weeks' }
  if (up >= MOVEMENT_MIN_CONSISTENT_DELTAS && down < MOVEMENT_MIN_CONSISTENT_DELTAS) return { direction: 'up', reason: null, weeks }
  if (down >= MOVEMENT_MIN_CONSISTENT_DELTAS && up < MOVEMENT_MIN_CONSISTENT_DELTAS) return { direction: 'down', reason: null, weeks }
  return { direction: null, weeks, reason: 'no_clear_trend' }
}

/** What the report froze for one platform. Figures are the recorded snapshots; the verdict is the rule's. */
export type VisibilityPlatform = {
  platform: string
  /** Share of voice recorded in the month's opening snapshot; null when it was not recorded. */
  opening: number | null
  /** Share of voice recorded in the month's closing snapshot; null when it was not recorded. */
  closing: number | null
  /** closing − opening, when both were recorded. */
  delta: number | null
  direction: 'up' | 'down' | null
  reason: MovementReason | null
  /** Usable weeks considered for this platform. */
  weeks: number
}

export type VisibilitySection =
  /** A stored schema-2 version from before the rule existed. Read-only history. */
  | { state: 'not_enough_data'; reason: 'movement_rule_pending' }
  /** Pulse produced no weekly rollup for this month at all. */
  | { state: 'not_enough_data'; reason: 'no_pulse_data' }
  | { state: 'recorded'; rule: typeof MOVEMENT_RULE_VERSION; minAnswersPerWeek: number; minDelta: number; platforms: VisibilityPlatform[] }

type PlatformSnapshot = { platform: string; sovScore: number | null }

/**
 * Builds the section from the month's weekly rollups plus the two recorded
 * snapshots. Every platform either reading or snapshot knows about appears once:
 * a platform with figures but no weekly series shows its figures and
 * "not enough data yet", which is exactly what the stored rows say.
 */
export function buildVisibility(input: {
  weeks: readonly PulsePlatformWeek[]
  opening: readonly PlatformSnapshot[]
  closing: readonly PlatformSnapshot[]
}): VisibilitySection {
  const byPlatform = new Map<string, PulseWeekReading[]>()
  for (const week of input.weeks) {
    const list = byPlatform.get(week.platform) ?? []
    list.push({ week: week.week, sov: week.sov, answers: week.answers })
    byPlatform.set(week.platform, list)
  }
  const closing = new Map(input.closing.map((p) => [p.platform, p.sovScore]))
  const names = [...new Set([...byPlatform.keys(), ...input.opening.map((p) => p.platform), ...closing.keys()])].sort()
  if (names.length === 0) return { state: 'not_enough_data', reason: 'no_pulse_data' }
  const opening = new Map(input.opening.map((p) => [p.platform, p.sovScore]))
  const platforms: VisibilityPlatform[] = names.map((platform) => {
    const openingSov = opening.get(platform) ?? null
    const closingSov = closing.get(platform) ?? null
    const verdict = decideMovement(byPlatform.get(platform) ?? [])
    return {
      platform,
      opening: openingSov,
      closing: closingSov,
      delta: openingSov !== null && closingSov !== null ? round2(closingSov - openingSov) : null,
      direction: verdict.direction,
      reason: verdict.reason,
      weeks: verdict.weeks,
    }
  })
  return { state: 'recorded', rule: MOVEMENT_RULE_VERSION, minAnswersPerWeek: MOVEMENT_MIN_ANSWERS_PER_WEEK, minDelta: MOVEMENT_MIN_DELTA, platforms }
}
