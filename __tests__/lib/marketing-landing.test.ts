import { describe, expect, it } from 'vitest'
import { PLAN_CATALOG } from '@/lib/plans/catalog'
import { CORE_PTS, EXT_PTS, GEO_PTS } from '@/lib/scoring'
import { SAMPLE_CHECKS, landingPricingRows, samplePillarPoints, sampleSummary, sampleTopFixes } from '@/lib/marketing/landing'

describe('landing sample result', () => {
  it('covers every scored check exactly once', () => {
    expect(SAMPLE_CHECKS.map(c => c.key).sort()).toEqual(Object.keys({ ...CORE_PTS, ...EXT_PTS, ...GEO_PTS }).sort())
  })

  it('derives its score, grade and potential from the real weights', () => {
    expect(sampleSummary()).toEqual({ score: 65.5, grade: 'C', potential: 85.5, potentialGrade: 'A' })
    const pillars = (['core', 'extended', 'geo'] as const).map(samplePillarPoints)
    expect(pillars.map(p => p.max)).toEqual([45, 30, 25])
    expect(pillars.reduce((sum, p) => sum + p.earned, 0)).toBe(65.5)
  })

  it('ranks the top fixes by the points a fix would recover', () => {
    expect(sampleTopFixes().map(c => c.key)).toEqual(['c2_llms_txt', 'c19_topical_authority', 'c7_mcp_card'])
  })
})

describe('landing pricing table', () => {
  const rows = Object.fromEntries(landingPricingRows().map(row => [row.key, row.cells]))

  it('claims nothing the catalog does not grant', () => {
    expect(rows.client_report).toEqual({ basic: false, pro: true, enterprise: true })
    expect(rows.csv).toEqual({ basic: PLAN_CATALOG.basic.features.csv_export, pro: PLAN_CATALOG.pro.features.csv_export, enterprise: PLAN_CATALOG.enterprise.features.csv_export })
    expect(rows.brands).toEqual({ basic: { kind: 'brands', count: 1 }, pro: { kind: 'brands', count: 3 }, enterprise: { kind: 'brands', count: 10 } })
  })

  it('does not sell Pulse history while Monitor is hidden', () => {
    expect(rows).not.toHaveProperty('history')
  })
})
