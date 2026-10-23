import { describe, expect, it } from 'vitest'
import { buildOverviewStats, type TrendScan } from '@/lib/view-models/overview-stats'
import { ownerPointsAtStake } from '@/lib/view-models/owner-priorities'
import { buildGettingStarted } from '@/lib/view-models/getting-started'
import { buildScanEvidence, describeEvidenceUrl, CHECK_VERSIONS, type EvidenceCheckKey } from '@/lib/scan-evidence'

const KEYS = Object.keys(CHECK_VERSIONS) as EvidenceCheckKey[]

function evidence(failing: EvidenceCheckKey[] = [], industry = 'general_b2c') {
  return buildScanEvidence({
    requestedUrl: 'https://example.com',
    evaluatedUrl: 'https://example.com',
    industry,
    region: 'global',
    sitemapSource: 'fetched',
    checks: Object.fromEntries(KEYS.map(key => [key, { collection: 'complete', assessment: failing.includes(key) ? 'fail' : 'pass' }])),
    observations: [{ collection: 'complete', check: 'page', httpStatus: 200, target: describeEvidenceUrl('https://example.com/'), observedAt: '2026-09-05T00:00:00.000Z' }],
    collectedAt: '2026-09-05T00:00:00.000Z',
  })
}

const scan = (id: string, score: number | null, ev: unknown, day: string): TrendScan => ({ id, score, grade: 'C', evidence: ev, created_at: `2026-10-${day}T00:00:00.000Z` })

describe('overview stats', () => {
  it('builds three series oldest first and a delta between two comparable scans', () => {
    const stats = buildOverviewStats([
      scan('c', 70, evidence([KEYS[0]!]), '20'),
      scan('b', 60, evidence([KEYS[0]!, KEYS[1]!]), '10'),
      scan('a', 50, evidence([KEYS[0]!, KEYS[1]!, KEYS[2]!]), '01'),
    ])
    expect(stats.score).toEqual({ latest: 70, points: [50, 60, 70], delta: 10 })
    expect(stats.fixesLeft).toEqual({ latest: 1, points: [3, 2, 1], delta: -1 })
    expect(stats.pointsToGain.points).toHaveLength(3)
    expect(stats.pointsToGain.delta).toBeLessThan(0)
    expect(stats.trend.map(p => p.id)).toEqual(['a', 'b', 'c'])
  })

  it('withholds the delta when the latest two scans were collected differently', () => {
    const stats = buildOverviewStats([scan('b', 70, evidence([], 'finance'), '20'), scan('a', 50, evidence(), '10')])
    expect(stats.score.points).toEqual([50, 70])
    expect(stats.score.delta).toBeNull()
    expect(stats.fixesLeft.delta).toBeNull()
  })

  it('leaves a scan with no evidence out of every series instead of counting it as zero', () => {
    const stats = buildOverviewStats([scan('b', 80, null, '20'), scan('a', 50, evidence([KEYS[0]!]), '10')])
    expect(stats.score.latest).toBeNull()
    expect(stats.score.points).toEqual([50])
    expect(stats.fixesLeft.latest).toBeNull()
    expect(stats.trend.map(p => p.id)).toEqual(['a'])
  })

  it('handles no scans', () => {
    expect(buildOverviewStats([])).toEqual({
      score: { latest: null, points: [], delta: null },
      fixesLeft: { latest: null, points: [], delta: null },
      pointsToGain: { latest: null, points: [], delta: null },
      trend: [],
    })
  })
})

describe('points at stake', () => {
  it('sums every finding, is zero when all clear and null without evidence', () => {
    expect(ownerPointsAtStake(evidence())).toBe(0)
    expect(ownerPointsAtStake(evidence(KEYS.slice(0, 5)))).toBeGreaterThan(ownerPointsAtStake(evidence(KEYS.slice(0, 1)))!)
    expect(ownerPointsAtStake(null)).toBeNull()
  })
})

describe('getting started', () => {
  const ok = <T,>(data: T) => ({ status: 'ok' as const, data })
  it('ticks steps from stored state and marks the first open one current', () => {
    expect(buildGettingStarted({ scans: ok([{}]), tasks: ok(0), setup: ok({ active: 0 }) })).toEqual({
      done: 2,
      steps: [
        { key: 'brand', state: 'done' },
        { key: 'scan', state: 'done' },
        { key: 'fixes', state: 'current' },
        { key: 'questions', state: 'todo' },
      ],
    })
  })
  it('disappears once everything is done', () => {
    expect(buildGettingStarted({ scans: ok([{}]), tasks: ok(2), setup: ok({ active: 5 }) })).toBeNull()
  })
  it('is not shown when any read failed or was not made, rather than showing unticked boxes', () => {
    expect(buildGettingStarted({ scans: { status: 'error', data: [] }, tasks: ok(0), setup: ok(null) })).toBeNull()
    expect(buildGettingStarted({ scans: ok([]), tasks: undefined, setup: ok(null) })).toBeNull()
  })
})
