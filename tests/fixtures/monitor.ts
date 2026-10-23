import type { PulseView } from '../../lib/view-models/pulse'

/** Synthetic Monitor data for component acceptance; never loaded by routes. */
export function monitorView(latestWeek: string | null): PulseView {
  const weeks = ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']
  return {
    client: { id: 'client-a', brand_name: 'Example Brand' },
    observations: {
      state: latestWeek ? 'complete' : 'empty', latestKpi: null, latestWeek,
      series: latestWeek ? [
        { platform: null, points: weeks.map(week => ({ week, sov: 20 })) },
        { platform: 'gpt-4o', points: weeks.map((week, i) => ({ week, sov: i % 2 ? 25 : 0 })) },
        { platform: 'perplexity-sonar', points: weeks.map(week => ({ week, sov: null })) },
      ] : [],
    },
    missed: { state: 'empty', data: [] },
    prompts: { state: 'empty', data: [] },
    competitors: { state: 'ready', data: latestWeek ? [{ name: null, mentions: 3, answers: 12 }, { name: 'Rival Co', mentions: 6, answers: 12 }] : [] },
    alerts: { state: 'ready', data: { enabled: true, lastAt: '2026-09-29T07:47:00.000Z' } },
  }
}
