import { describe, expect, it } from 'vitest'
import {
  buildScanEvidence,
  compareScanChecks,
  compareScanEvidence,
  describeEvidenceUrl,
  CHECK_VERSIONS,
  type EvidenceAssessment,
  type EvidenceCheckKey,
} from '@/lib/scan-evidence'

/**
 * The technical recheck contract.
 *
 * Before this existed the product could not state an outcome at all: every path
 * through compareScanEvidence returned comparable:false, including its success
 * path, so `lib/outcomes` always landed on 'no-comparable-adapter'. That was
 * honest but empty — an owner who applied a change could never be told whether
 * the finding had moved.
 *
 * The rule pinned here is that comparability is decided by METHOD, TARGET and
 * CONFIGURATION, never by page content. Content is expected to differ between a
 * baseline and a recheck; if identical content were the bar, every genuine
 * improvement would read as incomparable.
 */

const KEYS = Object.keys(CHECK_VERSIONS) as EvidenceCheckKey[]

const base = () => ({
  requestedUrl: 'https://example.com/private-secret?q=secret#secret',
  evaluatedUrl: 'https://example.com',
  industry: 'general_b2c',
  sitemapSource: 'fetched' as const,
})

/** A page observation whose descriptor redacted nothing: the target was origin root. */
const rootPage = (url = 'https://example.com/') => [{
  collection: 'complete', check: 'page', httpStatus: 200,
  target: describeEvidenceUrl(url), observedAt: '2026-09-05T00:00:00.000Z',
}]

function envelope(options: {
  assessments?: Partial<Record<EvidenceCheckKey, EvidenceAssessment>>
  collection?: string
  page?: ReturnType<typeof rootPage>
  region?: string
  collectedAt?: string
} = {}) {
  const checks = Object.fromEntries(KEYS.map(key => [key, {
    collection: options.collection ?? 'complete',
    assessment: options.assessments?.[key] ?? 'pass',
  }]))
  return buildScanEvidence({
    ...base(),
    region: options.region ?? 'global',
    checks,
    observations: options.page ?? rootPage(),
    collectedAt: options.collectedAt ?? '2026-09-05T00:00:00.000Z',
  })
}

describe('page identity without storing a path', () => {
  it('treats two complete root-target runs of the same method as comparable', () => {
    const before = envelope()
    const after = envelope({ collectedAt: '2026-09-19T00:00:00.000Z' })

    expect(compareScanEvidence(before, after)).toEqual({ comparable: true, reason: null })
  })

  it('withholds comparability when the fetched page was not the origin root', () => {
    // A redacted path could be /en/home on one run and /zh/home on the next, and
    // the origin alone cannot tell them apart.
    const deep = envelope({ page: rootPage('https://example.com/en/home') })

    expect(compareScanEvidence(envelope(), deep)).toEqual({
      comparable: false, reason: 'final-path-identity-withheld',
    })
  })

  it('withholds comparability when no page was fetched at all', () => {
    const noPage = buildScanEvidence({
      ...base(),
      region: 'global',
      checks: Object.fromEntries(KEYS.map(key => [key, { collection: 'complete', assessment: 'pass' }])),
    })

    expect(compareScanEvidence(envelope(), noPage).comparable).toBe(false)
  })
})

describe('compareScanChecks: verdict deltas', () => {
  it('reports an improvement without ever comparing page content', () => {
    const before = envelope({ assessments: { c1_robots: 'fail' } })
    // Same method and target, different collection time. Content is expected to
    // differ between the two, and nothing here inspects it.
    const after = envelope({ collectedAt: '2026-09-19T00:00:00.000Z' })

    const result = compareScanChecks(before, after)

    expect(result.status).toBe('comparable')
    expect(result.reason).toBeNull()
    expect(result.checks!.c1_robots).toEqual({ before: 'fail', after: 'pass', outcome: 'improved' })
    expect(result.changed).toEqual(['c1_robots'])
  })

  it('reports a regression and leaves untouched checks unchanged', () => {
    const result = compareScanChecks(envelope(), envelope({ assessments: { c8_sitemap: 'warn' } }))

    expect(result.checks!.c8_sitemap.outcome).toBe('regressed')
    expect(result.checks!.c1_robots.outcome).toBe('unchanged')
    expect(result.changed).toEqual(['c8_sitemap'])
  })

  it('ranks fail below warn below pass', () => {
    const result = compareScanChecks(
      envelope({ assessments: { c1_robots: 'fail', c2_llms_txt: 'warn', c3_bot_access: 'pass' } }),
      envelope({ assessments: { c1_robots: 'warn', c2_llms_txt: 'pass', c3_bot_access: 'warn' } }),
    )

    expect(result.checks!.c1_robots.outcome).toBe('improved')
    expect(result.checks!.c2_llms_txt.outcome).toBe('improved')
    expect(result.checks!.c3_bot_access.outcome).toBe('regressed')
  })

  it.each([
    ['not-applicable', 'pass'],
    ['pass', 'not-applicable'],
    ['not-verifiable', 'fail'],
    ['fail', 'not-verifiable'],
  ] as const)('cannot determine an outcome from %s to %s', (before, after) => {
    // These are the absence of a verdict, not a worse or better one. Ranking them
    // would turn "we could not look" into "it got worse".
    const result = compareScanChecks(
      envelope({ assessments: { c4_structured_data: before } }),
      envelope({ assessments: { c4_structured_data: after } }),
    )

    expect(result.checks!.c4_structured_data.outcome).toBe('cannot_determine')
  })
})

describe('compareScanChecks: honest refusals', () => {
  it('still shows deltas when only page identity is unproven, and says so', () => {
    const before = envelope({ page: rootPage('https://example.com/en/home'), assessments: { c1_robots: 'fail' } })
    const after = envelope({ page: rootPage('https://example.com/en/home') })

    const result = compareScanChecks(before, after)

    expect(result.status).toBe('partially_comparable')
    expect(result.reason).toBe('final-path-identity-withheld')
    expect(result.checks!.c1_robots.outcome).toBe('improved')
  })

  it('refuses entirely when the method or scope differs', () => {
    const result = compareScanChecks(envelope(), envelope({ region: 'HK' }))

    expect(result).toEqual({
      status: 'not_comparable', reason: 'different-methods-or-scope', checks: null, changed: [],
    })
  })

  it('withholds deltas when a collection was incomplete', () => {
    // A verdict produced from a failed collection is not a verdict, so showing it
    // as a delta would manufacture a result out of a missing observation.
    const result = compareScanChecks(envelope(), envelope({ collection: 'failed' }))

    expect(result.status).toBe('insufficient_evidence')
    expect(result.reason).toBe('incomplete-collection')
    expect(result.checks).toBeNull()
  })

  it('withholds deltas when either envelope is unreadable', () => {
    const result = compareScanChecks(envelope(), { schemaVersion: 1 })

    expect(result.status).toBe('insufficient_evidence')
    expect(result.reason).toBe('unknown-evidence')
    expect(result.checks).toBeNull()
  })

  it('covers every registered check when it reports at all', () => {
    const result = compareScanChecks(envelope(), envelope())

    expect(Object.keys(result.checks!).sort()).toEqual([...KEYS].sort())
    expect(result.changed).toEqual([])
  })
})
