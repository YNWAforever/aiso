import { describe, expect, it } from 'vitest'
import { CORE_PTS, EXT_PTS, GEO_PTS } from '@/lib/scoring'
import { CHECK_SLOTS, bucketPoints, geoScale, matchesFilter, potentialScore, rankFixes, visualStatus } from '@/lib/result/view-model'
import { calculateGeoScore } from '@/lib/scoring'
import type { CheckAssessment } from '@/lib/view-models/check-priority'

describe('result view model', () => {
  it('lists all 20 checks once, in scoring order and weight', () => {
    expect(CHECK_SLOTS).toHaveLength(20)
    expect(CHECK_SLOTS.map(slot => slot.key)).toEqual([...Object.keys(CORE_PTS), ...Object.keys(EXT_PTS), ...Object.keys(GEO_PTS)])
    expect(CHECK_SLOTS.reduce((sum, slot) => sum + slot.weight, 0)).toBe(100)
  })

  it('ranks fixes by points to gain, then quicker effort, and skips unverified checks', () => {
    const assessments: Record<string, CheckAssessment> = {
      c1_robots: 'fail', c2_llms_txt: 'warn', c3_bot_access: 'unknown', c19_topical_authority: 'fail', c11_faq: 'fail',
      c8_sitemap: 'pass', c6_llms_full_txt: 'not-applicable',
    }
    const fixes = rankFixes(assessments)
    expect(fixes.map(fix => fix.key)).not.toContain('c3_bot_access')
    expect(fixes.map(fix => fix.key)).not.toContain('c6_llms_full_txt')
    for (let i = 1; i < fixes.length; i++) expect(fixes[i - 1]!.points).toBeGreaterThanOrEqual(fixes[i]!.points)
    const c1 = fixes.find(fix => fix.key === 'c1_robots')!
    expect(c1.points).toBe(CORE_PTS.c1_robots)
    expect(fixes.find(fix => fix.key === 'c2_llms_txt')!.points).toBe(CORE_PTS.c2_llms_txt / 2)
  })

  it('keeps the potential score at two decimals and never above 100', () => {
    expect(potentialScore(63.5, rankFixes({ c1_robots: 'fail' }))).toBe(63.5 + CORE_PTS.c1_robots)
    expect(potentialScore(99, rankFixes({ c1_robots: 'fail' }))).toBe(100)
    expect(potentialScore(10.335, [])).toBe(10.34)
  })

  it('earns full points for a pass, half for a warning and none for unverified checks', () => {
    const points = bucketPoints({ c1_robots: 'pass', c2_llms_txt: 'warn', c3_bot_access: 'unknown' })
    expect(points.core).toEqual({ earned: CORE_PTS.c1_robots + CORE_PTS.c2_llms_txt / 2, max: 45 })
    expect(points.extended.max).toBe(30)
    expect(points.geo).toEqual({ earned: 0, max: 25 })
  })

  it('reads not-applicable and missing verdicts as not checked', () => {
    expect(visualStatus('not-applicable')).toBe('unknown')
    expect(visualStatus(undefined)).toBe('unknown')
    expect(matchesFilter('not-applicable', 'unknown')).toBe(true)
    expect(matchesFilter('fail', 'all')).toBe(true)
    expect(matchesFilter('fail', 'pass')).toBe(false)
  })

  it('rescales GEO fixes and points over the assessed GEO checks, as the scanner scores them', () => {
    // c18 could not be assessed: the scanner drops it and rescales the other three to 25.
    const assessments: Record<string, CheckAssessment> = { c17_citation_density: 'fail', c18_factual_density: 'unknown', c19_topical_authority: 'pass', c20_chunkability: 'pass' }
    const before = calculateGeoScore({
      c17_citation_density: { status: 'fail', message: '' }, c18_factual_density: { status: 'fail', message: 'factual_density_unavailable' },
      c19_topical_authority: { status: 'pass', message: '' }, c20_chunkability: { status: 'pass', message: '' },
    })
    const after = calculateGeoScore({
      c17_citation_density: { status: 'pass', message: '' }, c18_factual_density: { status: 'fail', message: 'factual_density_unavailable' },
      c19_topical_authority: { status: 'pass', message: '' }, c20_chunkability: { status: 'pass', message: '' },
    })
    const c17 = rankFixes(assessments).find(fix => fix.key === 'c17_citation_density')!
    expect(c17.points).toBeCloseTo(after - before, 1)
    expect(c17.points).toBe(9.21)
    expect(bucketPoints(assessments).geo.earned).toBeCloseTo(before, 1)
    expect(geoScale({})).toBe(1)
  })
})
