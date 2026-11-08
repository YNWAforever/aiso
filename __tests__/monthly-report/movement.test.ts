import { describe, expect, it } from 'vitest'
import {
  MOVEMENT_MIN_ANSWERS_PER_WEEK, buildVisibility, decideMovement, type PulseWeekReading,
} from '@/lib/monthly-report/movement'

const reading = (day: string, sov: number | null, answers: number | null = 8): PulseWeekReading =>
  ({ week: `2026-11-${day}`, sov, answers })

describe('decideMovement', () => {
  it('needs four usable weeks before it will look at a direction', () => {
    expect(decideMovement([reading('02', 10), reading('09', 11), reading('16', 12)]))
      .toEqual({ direction: null, reason: 'insufficient_weeks', weeks: 3 })
  })

  it('counts a missing week as no chain rather than spanning the gap', () => {
    // 02, 16, 23, 30: every delta that exists is seven days, but 02→16 is a gap,
    // so only three comparisons remain — not the four weeks the rule needs.
    expect(decideMovement([reading('02', 10), reading('16', 11), reading('23', 12), reading('30', 13)]))
      .toMatchObject({ direction: null, reason: 'insufficient_weeks' })
  })

  it('refuses a week with too few answers behind it', () => {
    const few = [reading('02', 10), reading('09', 11), reading('16', 12, MOVEMENT_MIN_ANSWERS_PER_WEEK - 1), reading('23', 13)]
    expect(decideMovement(few)).toMatchObject({ direction: null, reason: 'insufficient_answers' })
  })

  it('reports rising only when three consecutive comparisons move up', () => {
    expect(decideMovement([reading('02', 10), reading('09', 11), reading('16', 12), reading('23', 13)]))
      .toEqual({ direction: 'up', reason: null, weeks: 4 })
  })

  it('reports falling the same way', () => {
    expect(decideMovement([reading('02', 14), reading('09', 12.5), reading('16', 10), reading('23', 8)]))
      .toMatchObject({ direction: 'down', reason: null })
  })

  it('treats sub-threshold changes as flat, not as movement', () => {
    expect(decideMovement([reading('02', 10), reading('09', 10.2), reading('16', 10.1), reading('23', 10.3)]))
      .toMatchObject({ direction: null, reason: 'no_clear_trend' })
  })

  it('calls a genuinely mixed month "no clear trend" rather than picking a side', () => {
    expect(decideMovement([reading('02', 10), reading('09', 14), reading('16', 8), reading('23', 15)]))
      .toMatchObject({ direction: null, reason: 'no_clear_trend' })
  })

  it('judges the most recent five usable weeks, so older comparisons cannot outvote them', () => {
    // Seven consecutive weeks: three down, then three up. Across all six deltas
    // that is a tie (both directions reach three), so a rule that looked at
    // every week would refuse a verdict. The recent window only sees the four
    // up comparisons, which is a rising month.
    const series: PulseWeekReading[] = [
      { week: '2026-10-19', sov: 100, answers: 8 }, { week: '2026-10-26', sov: 90, answers: 8 },
      { week: '2026-11-02', sov: 80, answers: 8 }, { week: '2026-11-09', sov: 70, answers: 8 },
      { week: '2026-11-16', sov: 80, answers: 8 }, { week: '2026-11-23', sov: 90, answers: 8 },
      { week: '2026-11-30', sov: 100, answers: 8 },
    ]
    expect(decideMovement(series)).toEqual({ direction: 'up', reason: null, weeks: 5 })
  })
})

describe('buildVisibility', () => {
  const weekOf = (platform: string, r: PulseWeekReading) => ({ platform, week: r.week, sov: r.sov, answers: r.answers })

  it('says there is no Pulse data instead of drawing an empty table', () => {
    expect(buildVisibility({ weeks: [], opening: [], closing: [] }))
      .toEqual({ state: 'not_enough_data', reason: 'no_pulse_data' })
  })

  it('keeps recorded figures for a platform the rule has no weekly series for', () => {
    const section = buildVisibility({ weeks: [], opening: [{ platform: 'gpt-4o', sovScore: 10 }], closing: [{ platform: 'gpt-4o', sovScore: 14 }] })
    expect(section).toMatchObject({ state: 'recorded', rule: 1, platforms: [
      { platform: 'gpt-4o', opening: 10, closing: 14, delta: 4, direction: null, reason: 'insufficient_weeks', weeks: 0 },
    ] })
  })

  it('records the rule and the thresholds it used with every verdict', () => {
    const weeks = [reading('02', 10), reading('09', 11), reading('16', 12), reading('23', 13)].map(r => weekOf('gpt-4o', r))
    const section = buildVisibility({ weeks, opening: [{ platform: 'gpt-4o', sovScore: 10 }], closing: [{ platform: 'gpt-4o', sovScore: 13 }] })
    expect(section).toMatchObject({ state: 'recorded', rule: 1, minAnswersPerWeek: MOVEMENT_MIN_ANSWERS_PER_WEEK, minDelta: 0.5,
      platforms: [{ platform: 'gpt-4o', opening: 10, closing: 13, delta: 3, direction: 'up', reason: null, weeks: 4 }] })
  })

  it('leaves a missing endpoint as null rather than zero', () => {
    const weeks = [reading('02', 10), reading('09', 11), reading('16', 12), reading('23', 13)].map(r => weekOf('gpt-4o', r))
    expect(buildVisibility({ weeks, opening: [], closing: [{ platform: 'gpt-4o', sovScore: 13 }] }))
      .toMatchObject({ platforms: [{ opening: null, closing: 13, delta: null }] })
  })

  it('sorts platforms so the report order cannot drift between versions', () => {
    const section = buildVisibility({ weeks: [], opening: [{ platform: 'zeta', sovScore: 1 }, { platform: 'alpha', sovScore: 2 }], closing: [] })
    expect(section.state === 'recorded' ? section.platforms.map(p => p.platform) : []).toEqual(['alpha', 'zeta'])
  })
})
