import { describe, expect, it } from 'vitest'
import { buildAssetConvergence, siteFindingsFromEvidence } from '@/lib/view-models/asset-convergence'
import { buildScanEvidence, describeEvidenceUrl, CHECK_VERSIONS, type EvidenceCheckKey } from '@/lib/scan-evidence'

/**
 * Where a website finding and a question opportunity meet.
 *
 * AC-06's asset half, built the way the design decision settled it: the owner
 * registers the pages that matter, a scan finding attaches by ORIGIN, and a
 * question attaches because the owner declared that this page answers it.
 *
 * The load-bearing honesty is the scope label. A scan finding is observed for a
 * site — `origin-only.v1` keeps nothing finer — so when it appears under a page
 * it must still say "site". Rendering it as a page-level observation would be
 * inventing evidence that was never collected, which is the failure the whole
 * evidence envelope exists to prevent.
 *
 * This is the asset half ONLY. The task half is deliberately absent: see
 * __tests__/opportunities/ac-06-convergence.test.ts for why merging two sources
 * onto one work item is a provenance lie rather than a feature.
 */

const asset = (id: string, url: string, label: string) => {
  const origin = new URL(url).origin
  return { id, url, origin, label }
}

const PRICING = asset('asset-1', 'https://example.com/pricing', 'Pricing')
const FAQ = asset('asset-2', 'https://example.com/faq', 'FAQ')
const OTHER_SITE = asset('asset-3', 'https://other.test/pricing', 'Other pricing')

const finding = (origin: string, checkKey: string) => ({ origin, checkKey, status: 'fail' as const })
const declaration = (assetId: string, promptId: string, question: string) => ({ assetId, promptId, question })

describe('buildAssetConvergence', () => {
  it('brings a site finding and a declared question to the same asset', () => {
    const [pricing] = buildAssetConvergence({
      assets: [PRICING],
      findings: [finding('https://example.com', 'c9_meta_desc')],
      declarations: [declaration('asset-1', 'prompt-1', 'Do you offer annual billing?')],
    })

    expect(pricing!.converges).toBe(true)
    expect(pricing!.findings.map(f => f.checkKey)).toEqual(['c9_meta_desc'])
    expect(pricing!.questions.map(q => q.promptId)).toEqual(['prompt-1'])
  })

  it('reports a finding at site scope even though it is listed under a page', () => {
    // The whole point. origin-only.v1 kept no path, so this finding was never
    // observed on /pricing specifically, and the screen must not imply it was.
    const [pricing] = buildAssetConvergence({
      assets: [PRICING],
      findings: [finding('https://example.com', 'c9_meta_desc')],
      declarations: [],
    })

    expect(pricing!.findings[0]!.scope).toBe('site')
  })

  it('reports a declared question at page scope, because the owner said so', () => {
    const [pricing] = buildAssetConvergence({
      assets: [PRICING],
      findings: [],
      declarations: [declaration('asset-1', 'prompt-1', 'Do you offer annual billing?')],
    })

    expect(pricing!.questions[0]!.scope).toBe('page')
  })

  it('attaches one site finding to every registered page on that origin', () => {
    // Not a bug and not deduplication: the finding really does apply to both
    // pages, and hiding it from the second would under-report the site.
    const converged = buildAssetConvergence({
      assets: [PRICING, FAQ],
      findings: [finding('https://example.com', 'c1_robots')],
      declarations: [],
    })

    expect(converged.map(entry => entry.findings.length)).toEqual([1, 1])
  })

  it('does not attach a finding from another origin', () => {
    const converged = buildAssetConvergence({
      assets: [OTHER_SITE],
      findings: [finding('https://example.com', 'c1_robots')],
      declarations: [],
    })

    expect(converged[0]!.findings).toEqual([])
  })

  it('does not attach a question declared for a different asset', () => {
    const converged = buildAssetConvergence({
      assets: [PRICING],
      findings: [],
      declarations: [declaration('asset-2', 'prompt-1', 'Where do you ship?')],
    })

    expect(converged[0]!.questions).toEqual([])
  })

  it.each([
    ['only a question', { findings: [], declarations: [declaration('asset-1', 'p', 'q')] }],
    ['only a finding', { findings: [finding('https://example.com', 'c1_robots')], declarations: [] }],
    ['neither', { findings: [], declarations: [] }],
  ])('does not claim convergence with %s', (_label, input) => {
    const converged = buildAssetConvergence({ assets: [PRICING], ...input })

    expect(converged[0]!.converges).toBe(false)
  })

  it('orders assets by label and their contents deterministically', () => {
    // Two requests must not reorder the page. The store returns rows in whatever
    // order it likes; ordering belongs here, where it can be asserted.
    const converged = buildAssetConvergence({
      assets: [FAQ, PRICING],
      findings: [finding('https://example.com', 'c9_meta_desc'), finding('https://example.com', 'c1_robots')],
      declarations: [
        declaration('asset-1', 'prompt-2', 'Beta question'),
        declaration('asset-1', 'prompt-1', 'Alpha question'),
      ],
    })

    expect(converged.map(entry => entry.asset.label)).toEqual(['FAQ', 'Pricing'])
    expect(converged[1]!.findings.map(f => f.checkKey)).toEqual(['c1_robots', 'c9_meta_desc'])
    expect(converged[1]!.questions.map(q => q.question)).toEqual(['Alpha question', 'Beta question'])
  })

  it('returns an empty list when nothing is registered, rather than failing', () => {
    expect(buildAssetConvergence({ assets: [], findings: [], declarations: [] })).toEqual([])
  })
})

const KEYS = Object.keys(CHECK_VERSIONS) as EvidenceCheckKey[]

function evidence(failing: EvidenceCheckKey[], url = 'https://example.com') {
  return buildScanEvidence({
    requestedUrl: url,
    evaluatedUrl: url,
    industry: 'general_b2c',
    region: 'global',
    sitemapSource: 'fetched',
    checks: Object.fromEntries(
      KEYS.map(key => [key, { collection: 'complete', assessment: failing.includes(key) ? 'fail' : 'pass' }]),
    ),
    observations: [{
      collection: 'complete', check: 'page', httpStatus: 200,
      target: describeEvidenceUrl(`${url}/`), observedAt: '2026-09-05T00:00:00.000Z',
    }],
    collectedAt: '2026-09-05T00:00:00.000Z',
  })
}

describe('siteFindingsFromEvidence', () => {
  it('takes findings from the reviewed priorities projection, carrying the origin', () => {
    const findings = siteFindingsFromEvidence(evidence(['c9_meta_desc']))

    expect(findings).toEqual([{ origin: 'https://example.com', checkKey: 'c9_meta_desc', status: 'fail' }])
  })

  it('reports nothing when the scan found nothing to act on', () => {
    // `all-clear` is not `ready`. An all-clear site must not put a finding on a
    // page, and an empty list here is what keeps `converges` false.
    expect(siteFindingsFromEvidence(evidence([]))).toEqual([])
  })

  it('reports nothing when there is no readable evidence at all', () => {
    expect(siteFindingsFromEvidence(null)).toEqual([])
    expect(siteFindingsFromEvidence({ nonsense: true })).toEqual([])
  })

  it('matches the origin a registered page is keyed on', () => {
    // The join AC-06 rests on: this string is compared for equality against
    // client_assets.origin, which lib/assets/schema.ts produced.
    const [found] = siteFindingsFromEvidence(evidence(['c1_robots'], 'https://example.com'))

    expect(found!.origin).toBe('https://example.com')
  })
})
