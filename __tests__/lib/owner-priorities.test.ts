import { describe, expect, it } from 'vitest'
import { buildOwnerPriorities, MAX_PRIORITIES } from '@/lib/view-models/owner-priorities'
import { buildScanEvidence, describeEvidenceUrl, CHECK_VERSIONS, type EvidenceCheckKey } from '@/lib/scan-evidence'

/**
 * Home ranks findings, so the difference between "this failed" and "we could not
 * look at this" has to survive into the ranking. Presenting an unobservable check
 * as work to do invents a problem the owner may not have, and that is exactly
 * what a blocked collection produces.
 */

const KEYS = Object.keys(CHECK_VERSIONS) as EvidenceCheckKey[]

type CheckInput = { collection: string; assessment: string }

function evidence(
  overrides: Partial<Record<EvidenceCheckKey, CheckInput>> = {},
  fallback: CheckInput = { collection: 'complete', assessment: 'pass' },
) {
  return buildScanEvidence({
    requestedUrl: 'https://example.com',
    evaluatedUrl: 'https://example.com',
    industry: 'general_b2c',
    region: 'global',
    sitemapSource: 'fetched',
    checks: Object.fromEntries(KEYS.map(key => [key, overrides[key] ?? fallback])),
    observations: [{
      collection: 'complete', check: 'page', httpStatus: 200,
      target: describeEvidenceUrl('https://example.com/'), observedAt: '2026-09-05T00:00:00.000Z',
    }],
    collectedAt: '2026-09-05T00:00:00.000Z',
  })
}

describe('owner priorities: ranking', () => {
  it('returns at most three, heaviest first, and names the top one as the next action', () => {
    const result = buildOwnerPriorities(evidence({
      c1_robots: { collection: 'complete', assessment: 'fail' },          // 12 pts
      c4_structured_data: { collection: 'complete', assessment: 'fail' }, // 7 pts
      c2_llms_txt: { collection: 'complete', assessment: 'fail' },        // 10 pts
      c9_meta_desc: { collection: 'complete', assessment: 'fail' },       // 2 pts, outside the top three
    }))

    expect(result.state).toBe('ready')
    expect(result.priorities).toHaveLength(MAX_PRIORITIES)
    expect(result.priorities.map(p => p.checkKey)).toEqual(['c1_robots', 'c2_llms_txt', 'c4_structured_data'])
    expect(result.primaryAction?.checkKey).toBe('c1_robots')
    // Four findings observed, three shown, so the surface can say "3 of 4".
    expect(result.observedFindings).toBe(4)
  })

  it('puts only half a warn at stake, because the other half is already earned', () => {
    const result = buildOwnerPriorities(evidence({
      c1_robots: { collection: 'complete', assessment: 'warn' },   // 12 -> 6
      c2_llms_txt: { collection: 'complete', assessment: 'fail' }, // 10 -> 10
    }))

    expect(result.priorities.map(p => [p.checkKey, p.pointsAtStake])).toEqual([
      ['c2_llms_txt', 10],
      ['c1_robots', 6],
    ])
  })

  it('orders equal-weight findings deterministically rather than by insertion', () => {
    // c10_headings and c11_faq are both worth 3.
    const first = buildOwnerPriorities(evidence({
      c10_headings: { collection: 'complete', assessment: 'fail' },
      c11_faq: { collection: 'complete', assessment: 'fail' },
    }))
    const second = buildOwnerPriorities(evidence({
      c11_faq: { collection: 'complete', assessment: 'fail' },
      c10_headings: { collection: 'complete', assessment: 'fail' },
    }))

    expect(first.priorities.map(p => p.checkKey)).toEqual(second.priorities.map(p => p.checkKey))
  })

  it('carries the bucket so a specialist drill-down can group by it', () => {
    const result = buildOwnerPriorities(evidence({
      c1_robots: { collection: 'complete', assessment: 'fail' },
      c8_sitemap: { collection: 'complete', assessment: 'fail' },
      c17_citation_density: { collection: 'complete', assessment: 'fail' },
    }))

    expect(result.priorities.map(p => p.bucket).sort()).toEqual(['core', 'extended', 'geo'])
  })
})

describe('owner priorities: an unobservable check is not a finding', () => {
  it.each(['blocked', 'failed', 'unsupported', 'unknown', 'partial'])(
    'keeps a %s collection out of the priorities and lists it as needing evidence',
    (collection) => {
      const result = buildOwnerPriorities(evidence({
        c1_robots: { collection, assessment: 'fail' },
        c2_llms_txt: { collection: 'complete', assessment: 'fail' },
      }))

      expect(result.priorities.map(p => p.checkKey)).toEqual(['c2_llms_txt'])
      expect(result.needsEvidence).toContainEqual({ checkKey: 'c1_robots', collection })
      expect(result.observedFindings).toBe(1)
    },
  )

  it('reports insufficient evidence rather than all-clear when nothing could be observed', () => {
    // Every check reads `fail`, but none was actually collected. Calling this
    // "all clear", or listing twenty priorities, would both be fabrications.
    const result = buildOwnerPriorities(evidence({}, { collection: 'blocked', assessment: 'fail' }))

    expect(result.state).toBe('insufficient-evidence')
    expect(result.priorities).toEqual([])
    expect(result.primaryAction).toBeNull()
    expect(result.needsEvidence).toHaveLength(KEYS.length)
    expect(result.observedFindings).toBe(0)
  })

  it('says all-clear only when the evidence is complete and nothing is failing', () => {
    const result = buildOwnerPriorities(evidence())

    expect(result.state).toBe('all-clear')
    expect(result.needsEvidence).toEqual([])
    expect(result.primaryAction).toBeNull()
  })
})

describe('owner priorities: no envelope', () => {
  it.each([undefined, null, {}, { schemaVersion: 1 }, { schemaVersion: 99 }])(
    'reports unavailable for %s rather than inventing findings',
    (input) => {
      const result = buildOwnerPriorities(input)

      expect(result.state).toBe('unavailable')
      expect(result.priorities).toEqual([])
      expect(result.primaryAction).toBeNull()
      expect(result.observedFindings).toBe(0)
    },
  )
})
