import { describe, expect, it } from 'vitest'
import { CORE_PTS, EXT_PTS, GEO_PTS } from '@/lib/scoring'
import { CHECK_SLOTS, bucketPoints, matchesFilter, potentialScore, rankFixes, visualStatus } from '@/lib/result/view-model'
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
})
