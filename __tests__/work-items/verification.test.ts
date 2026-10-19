import { describe, expect, it } from 'vitest'
import { evaluateWorkVerification } from '@/lib/work-items/verification'

const baseline = {
  source: 'report-v2:c1_robots',
  observedAt: '2026-10-18T09:00:00.000Z',
  target: 'https://example.test',
  issuePresent: true as const,
}
const observation = (issuePresent: boolean | null, observedAt: string | null = '2026-10-20T09:00:00.000Z') => ({
  id: '44444444-4444-4444-8444-444444444444',
  source: 'synthetic-retest',
  observedAt,
  target: 'https://example.test',
  methodCompatible: true,
  issuePresent,
})

describe('work item verification evidence', () => {
  it('classifies synthetic post-report observations without claiming attribution', () => {
    const improved = evaluateWorkVerification({
      baseline,
      reportedAt: '2026-10-19T09:00:00.000Z',
      observations: [observation(false)],
    })
    const unchanged = evaluateWorkVerification({
      baseline,
      reportedAt: '2026-10-19T09:00:00.000Z',
      observations: [observation(true)],
    })
    const insufficient = evaluateWorkVerification({
      baseline,
      reportedAt: '2026-10-19T09:00:00.000Z',
      observations: [
        observation(null),
        { ...observation(false), methodCompatible: false },
        observation(false, '2026-10-18T10:00:00.000Z'),
      ],
    })
    const manualReportOnly = evaluateWorkVerification({
      baseline,
      reportedAt: '2026-10-19T09:00:00.000Z',
      observations: [],
    })

    expect(improved).toMatchObject({
      state: 'observed_improvement',
      selectedObservationId: observation(false).id,
      attribution: 'not_established',
    })
    expect(unchanged).toMatchObject({ state: 'no_observed_improvement', attribution: 'not_established' })
    expect(insufficient).toMatchObject({
      state: 'insufficient_evidence',
      selectedObservationId: null,
      attribution: 'not_established',
    })
    expect(manualReportOnly).toMatchObject({
      state: 'insufficient_evidence',
      selectedObservationId: null,
      reasons: ['no_observation'],
      attribution: 'not_established',
    })
  })
})
