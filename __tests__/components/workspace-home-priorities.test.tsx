import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkspaceHome } from '@/components/dashboard/WorkspaceHome'
import { buildOwnerPriorities } from '@/lib/view-models/owner-priorities'
import { buildScanEvidence, describeEvidenceUrl, CHECK_VERSIONS, type EvidenceCheckKey } from '@/lib/scan-evidence'
import { getCheckExplanations } from '@/lib/checkExplanations'
import type { WorkspaceHome as HomeDto } from '@/lib/view-models/workspace-home'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'

/**
 * The rendered Home surface. __tests__/workspace-home-page.test.tsx mocks this
 * component away to test routing, so nothing else asserts what an owner sees.
 *
 * What matters is that the three states an owner can land in never look alike:
 * findings to act on, nothing wrong, and "we could not tell". The third is the
 * one that fails quietly — a blocked scan rendered as an empty list reads as
 * "your site is fine".
 */

const KEYS = Object.keys(CHECK_VERSIONS) as EvidenceCheckKey[]

function evidence(
  overrides: Partial<Record<EvidenceCheckKey, { collection: string; assessment: string }>> = {},
  fallback = { collection: 'complete', assessment: 'pass' },
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

const section = <T,>(data: T | null) => ({
  state: (data === null ? 'empty' : 'ready') as 'ready' | 'empty',
  data,
  observedAt: null,
  freshness: 'unknown' as const,
})

function dto(priorities: HomeDto['priorities']): HomeDto {
  return {
    client: { id: 'client-a', brand_name: 'Fixture brand', domain: 'example.com' } as HomeDto['client'],
    priorities,
    siteHealth: section({ scanId: 'scan-a', domain: 'example.com', score: 61, grade: 'C', pillarScores: null }),
    history: section(null),
    visibility: section(null),
    recommendations: { ...section(null), generated: true as const },
  }
}

const render = (priorities: HomeDto['priorities'], lang: string) =>
  renderToStaticMarkup(<WorkspaceHome workspace={dto(priorities)} lang={lang} />)

const copyFor = (lang: string) => (lang === 'zh-HK' ? zhHK : en).workspaceHome.priorities

describe.each(['en', 'zh-HK'])('workspace home priorities in %s', lang => {
  const copy = copyFor(lang)
  const explanations = getCheckExplanations(lang)

  it('shows at most three priorities and marks the first as the next action', () => {
    const html = render(buildOwnerPriorities(evidence({
      c1_robots: { collection: 'complete', assessment: 'fail' },
      c2_llms_txt: { collection: 'complete', assessment: 'fail' },
      c4_structured_data: { collection: 'complete', assessment: 'fail' },
      c9_meta_desc: { collection: 'complete', assessment: 'fail' },
    })), lang)

    expect(html).toContain(copy.title)
    expect(html).toContain(copy.primary)
    // The three heaviest are shown in plain language; the fourth is not.
    expect(html).toContain(explanations.c1_robots!.question)
    expect(html).toContain(explanations.c2_llms_txt!.question)
    expect(html).toContain(explanations.c4_structured_data!.question)
    expect(html).not.toContain(explanations.c9_meta_desc!.question)
    // "3 of 4", so the surface never implies it showed everything.
    expect(html).toContain(copy.findings)
  })

  it('carries the fix wording for the verdict actually observed', () => {
    const html = render(buildOwnerPriorities(evidence({
      c1_robots: { collection: 'complete', assessment: 'warn' },
    })), lang)

    expect(html).toContain(explanations.c1_robots!.fix.warn)
    expect(html).not.toContain(explanations.c1_robots!.fix.pass)
  })

  it('says all-clear only when the evidence was complete', () => {
    const html = render(buildOwnerPriorities(evidence()), lang)

    expect(html).toContain(copy.states['all-clear'])
    expect(html).not.toContain(copy.primary)
  })

  it('never renders a blocked scan as though the site were fine', () => {
    // Every check reads fail, none was collected. This is the failure mode that
    // matters: an empty priority list here would read as "nothing to fix".
    const html = render(buildOwnerPriorities(evidence({}, { collection: 'blocked', assessment: 'fail' })), lang)

    expect(html).toContain(copy.states['insufficient-evidence'])
    expect(html).not.toContain(copy.states['all-clear'])
    expect(html).not.toContain(copy.primary)
    // The unobserved checks are surfaced as gaps, explicitly not as findings.
    expect(html).toContain(copy.needsEvidence)
    expect(html).toContain(copy.needsEvidenceNote)
  })

  it('refuses to rank a scan that predates evidence recording', () => {
    const html = render(buildOwnerPriorities(null), lang)

    expect(html).toContain(copy.states.unavailable)
    expect(html).not.toContain(copy.states['all-clear'])
    expect(html).not.toContain(copy.primary)
  })

  it('keeps the specialist drill-down reachable alongside the priorities', () => {
    const html = render(buildOwnerPriorities(evidence({
      c1_robots: { collection: 'complete', assessment: 'fail' },
    })), lang)

    const workspace = (lang === 'zh-HK' ? zhHK : en).workspaceHome
    expect(html).toContain(workspace.siteHealth)
    expect(html).toContain(workspace.history)
    expect(html).toContain(workspace.tools)
  })
})

describe('workspace home priorities: bilingual equivalence', () => {
  it('renders a different string for the same state in each language', () => {
    const priorities = buildOwnerPriorities(evidence({}, { collection: 'blocked', assessment: 'fail' }))

    expect(copyFor('en').states['insufficient-evidence'])
      .not.toBe(copyFor('zh-HK').states['insufficient-evidence'])
    expect(render(priorities, 'en')).toContain(copyFor('en').states['insufficient-evidence'])
    expect(render(priorities, 'zh-HK')).toContain(copyFor('zh-HK').states['insufficient-evidence'])
  })

  it('declares the same keys in both catalogues', () => {
    const keys = (block: object) => Object.keys(block).sort()
    expect(keys(en.workspaceHome.priorities)).toEqual(keys(zhHK.workspaceHome.priorities))
    expect(keys(en.workspaceHome.priorities.states)).toEqual(keys(zhHK.workspaceHome.priorities.states))
  })
})
