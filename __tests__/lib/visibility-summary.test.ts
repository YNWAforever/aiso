import { describe, expect, it } from 'vitest'
import type { PulseCoverageView } from '@/lib/view-models/pulse'
import type { PulseView } from '@/lib/view-models/pulse'
import { buildVisibilityOverview } from '@/lib/view-models/visibility-summary'

function coverage(overrides: Partial<PulseCoverageView> = {}): PulseCoverageView {
  return {
    expected: 50,
    recorded: 49,
    collected: 49,
    classified: 49,
    mentioned: 34,
    collectionRate: 1,
    classificationRate: 1,
    mentionRate: 0.69,
    provenance: 'ledger',
    ...overrides,
  }
}

function view(overrides: Partial<PulseView> = {}): PulseView {
  return {
    client: { id: 'client-1', brand_name: 'FOTOMAX', domain: 'fotomax.com.hk' },
    observations: {
      state: 'complete',
      coverage: coverage(),
      latestKpi: { sovScore: 69.4, brandMentions: 34, totalQueries: 49, platformCount: 5, scanWeek: '2026-11-16' },
      latestWeek: '2026-11-16',
      series: [
        {
          platform: null,
          points: [
            { week: '2026-11-02', sov: 60, state: 'complete' },
            { week: '2026-11-09', sov: 65.3, state: 'complete' },
            { week: '2026-11-16', sov: 69.4, state: 'complete' },
          ],
        },
        {
          platform: 'ChatGPT',
          points: [
            { week: '2026-11-02', sov: null, state: 'empty' },
            { week: '2026-11-09', sov: null, state: 'empty' },
            { week: '2026-11-16', sov: 80, state: 'complete' },
          ],
        },
      ],
    },
    missed: {
      state: 'ready',
      data: [
        { platform: 'ChatGPT', question: 'FOTOMAX 邊度有分店？', competitors_mentioned: ['Instax'], scan_week: '2026-11-16' },
        { platform: 'Perplexity', question: 'FOTOMAX 邊度有分店？', competitors_mentioned: ['Instax', '快圖美'], scan_week: '2026-11-16' },
        { platform: 'Gemini', question: '邊間沖印店最好？', competitors_mentioned: [], scan_week: '2026-11-16' },
      ],
    },
    prompts: {
      state: 'ready',
      data: [
        { id: '1', question: 'a', category: 'brand_query', language: 'zh-HK', is_active: true },
        { id: '2', question: 'b', category: 'category_query', language: 'zh-HK', is_active: false },
      ],
    },
    ...overrides,
  } as PulseView
}

describe('buildVisibilityOverview', () => {
  it('reports the latest mention rate and a comparable delta', () => {
    const overview = buildVisibilityOverview(view())
    expect(overview.state).toBe('ready')
    expect(overview.latestWeek).toBe('2026-11-16')
    expect(overview.sov).toBe(69.4)
    expect(overview.delta).toBe(4.1)
    expect(overview.previousWeek).toBe('2026-11-09')
    expect(overview.platformCount).toBe(5)
    expect(overview.activeQuestions).toBe(1)
  })

  it('does not compare against a partial week', () => {
    const overview = buildVisibilityOverview(view({
      observations: {
        ...view().observations,
        series: [{
          platform: null,
          points: [
            { week: '2026-11-09', sov: 65.3, state: 'partial' },
            { week: '2026-11-16', sov: 69.4, state: 'complete' },
          ],
        }],
      },
    }))
    expect(overview.sov).toBe(69.4)
    expect(overview.delta).toBeNull()
    expect(overview.previousWeek).toBeNull()
  })

  it('never compares when the latest week itself is partial', () => {
    const overview = buildVisibilityOverview(view({
      observations: {
        ...view().observations,
        state: 'partial',
        series: [{
          platform: null,
          points: [
            { week: '2026-11-09', sov: 65.3, state: 'complete' },
            { week: '2026-11-16', sov: 69.4, state: 'partial' },
          ],
        }],
      },
    }))
    expect(overview.state).toBe('partial')
    expect(overview.delta).toBeNull()
  })

  it('reports partial when some recorded answers were not classified', () => {
    const overview = buildVisibilityOverview(view({
      observations: { ...view().observations, coverage: coverage({ classified: 40 }) },
    }))
    expect(overview.state).toBe('partial')
  })

  it('returns empty without inventing a zero', () => {
    const overview = buildVisibilityOverview(view({
      observations: {
        state: 'empty',
        coverage: null,
        latestKpi: null,
        latestWeek: null,
        series: [],
      },
      prompts: { state: 'empty', data: [] },
    }))
    expect(overview.state).toBe('empty')
    expect(overview.sov).toBeNull()
    expect(overview.delta).toBeNull()
    expect(overview.platformCount).toBe(0)
    expect(overview.activeQuestions).toBeNull()
  })

  it('returns error and no numbers when the observation read failed', () => {
    const overview = buildVisibilityOverview(view({
      observations: {
        state: 'error',
        coverage: null,
        latestKpi: null,
        latestWeek: null,
        series: [],
      },
    }))
    expect(overview.state).toBe('error')
    expect(overview.sov).toBeNull()
    expect(overview.missedGroups).toEqual([])
  })

  it('counts only missed rows from the latest week', () => {
    const overview = buildVisibilityOverview(view({
      missed: {
        state: 'ready',
        data: [
          ...view().missed.data,
          { platform: 'Gemini', question: '舊問題', competitors_mentioned: ['Instax'], scan_week: '2026-11-09' },
        ],
      },
    }))
    expect(overview.missedGroups.map(group => group.question)).toEqual(['FOTOMAX 邊度有分店？', '邊間沖印店最好？'])
    expect(overview.missedGroups.every(group => group.week === '2026-11-16')).toBe(true)
  })

  it('groups missed answers by question, newest week and unique competitors', () => {
    const overview = buildVisibilityOverview(view())
    expect(overview.missedGroups).toEqual([
      {
        question: 'FOTOMAX 邊度有分店？',
        platforms: ['ChatGPT', 'Perplexity'],
        competitors: ['Instax', '快圖美'],
        week: '2026-11-16',
        count: 2,
      },
      {
        question: '邊間沖印店最好？',
        platforms: ['Gemini'],
        competitors: [],
        week: '2026-11-16',
        count: 1,
      },
    ])
  })

  it('counts only platforms with a value in the latest week when the KPI omits it', () => {
    const overview = buildVisibilityOverview(view({
      observations: {
        ...view().observations,
        latestKpi: { sovScore: 69.4, brandMentions: 34, totalQueries: 49 } as unknown as PulseView['observations']['latestKpi'],
      },
    }))
    expect(overview.platformCount).toBe(1)
  })
})
