import { describe, expect, it } from 'vitest'
import {
  PILLAR_SCORE_VERSION,
  PILLAR_WEIGHTS,
  calculatePillarScores,
  isPillarScoreSnapshot,
  resolvePillarScores,
} from '@/lib/pillar-scores'

function resultsWithStatus(status: 'pass' | 'warn' | 'fail') {
  const keys = new Set(
    Object.values(PILLAR_WEIGHTS).flatMap(weights => Object.keys(weights)),
  )

  return Object.fromEntries(
    [...keys].map(key => [key, { status, message: `${key}_${status}` }]),
  )
}

describe('calculatePillarScores', () => {
  it('normalises each independent pillar to 100 when every mapped check passes', () => {
    const scores = calculatePillarScores(resultsWithStatus('pass'))

    expect(scores.methodologyVersion).toBe(PILLAR_SCORE_VERSION)
    expect(scores.seo).toMatchObject({ score: 100, earned: 50, maximum: 50, checks: 11 })
    expect(scores.aeo).toMatchObject({ score: 100, earned: 50, maximum: 50, checks: 9 })
    expect(scores.geo).toMatchObject({ score: 100, earned: 30, maximum: 30, checks: 6 })
  })

  it('uses the existing warning rule of half credit', () => {
    const scores = calculatePillarScores(resultsWithStatus('warn'))

    expect(scores.seo).toMatchObject({ score: 50, earned: 25, warnings: 11 })
    expect(scores.aeo).toMatchObject({ score: 50, earned: 25, warnings: 9 })
    expect(scores.geo).toMatchObject({ score: 50, earned: 15, warnings: 6 })
  })

  it('treats missing or malformed check results as failures', () => {
    const scores = calculatePillarScores({
      c1_robots: { status: 'pass', message: 'ok' },
      c2_llms_txt: { status: 'unknown', message: 'invalid' },
    })

    expect(scores.seo.score).toBe(24)
    expect(scores.seo.passing).toBe(1)
    expect(scores.seo.failing).toBe(10)
    expect(scores.aeo.score).toBe(0)
    expect(scores.geo.score).toBe(0)
  })
})

describe('resolvePillarScores', () => {
  it('calculates a snapshot for legacy scans that do not have one stored', () => {
    const results = resultsWithStatus('pass')

    expect(resolvePillarScores(results)).toEqual(calculatePillarScores(results))
  })

  it('preserves a valid stored snapshot and its historical methodology version', () => {
    const stored = {
      ...calculatePillarScores(resultsWithStatus('pass')),
      methodologyVersion: 'historical.v0',
    }

    expect(isPillarScoreSnapshot(stored)).toBe(true)
    expect(resolvePillarScores({ pillarScores: stored })).toBe(stored)
  })

  it('rejects malformed stored data and recalculates safely', () => {
    const results = {
      ...resultsWithStatus('pass'),
      pillarScores: { methodologyVersion: 'broken', seo: { score: 100 } },
    }

    const resolved = resolvePillarScores(results)
    expect(resolved.methodologyVersion).toBe(PILLAR_SCORE_VERSION)
    expect(resolved.seo.score).toBe(100)
  })
})
