import { afterAll, describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { OutcomeReadError, OutcomeWindows } from '@/components/outcomes/OutcomeWindows'
import { OutcomeWorkspace } from '@/components/outcomes/OutcomeWorkspace'
import { OUTCOME_REASON_CODES, type OutcomeComparison, type SafeEvidence } from '@/lib/outcomes/types'
import { parseOutcomeResponse } from '@/lib/outcomes/dto'
import { outcome, outcomes, smeComparisonCases, smeOutcomes } from './c9f-fixtures'
import { fixtureProps, smeProps, smeV2Props, smeSingleV2Props } from './c9e-fixtures'
import { C9EVersionWorkspaceFixture } from './c9e-workspace-fixture'
import { journeyOutcomeFixture } from './c9f-journey-fixtures.node'
import { parseSelectedOutcome, selectedOutcomeExpectation } from '@/lib/outcomes/client-context'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeC9cFixture } from './c9c-fixture-writer'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
vi.mock('server-only', () => ({}))
const render = (node: React.ReactNode, lang: string) => renderToString(<NextIntlClientProvider locale={lang} messages={lang === 'en' ? en : zh} timeZone="UTC">{node}</NextIntlClientProvider>)
describe('stored outcomes rendering', () => {
  it('requires exact bilingual keys and the full reason vocabulary', () => {
    expect(Object.keys(en.outcomes).sort()).toEqual(Object.keys(zh.outcomes).sort())
    expect(Object.keys(en.outcomes.reasons).sort()).toEqual([...OUTCOME_REASON_CODES].sort())
    expect(Object.keys(zh.outcomes.reasons).sort()).toEqual([...OUTCOME_REASON_CODES].sort())
    for (const key of ['anchorStates', 'timeStates', 'evidenceStates', 'sources', 'verdicts'] as const) expect(Object.keys(en.outcomes[key]).sort()).toEqual(Object.keys(zh.outcomes[key]).sort())
  })
  for (const [name, value] of Object.entries(outcomes)) it.each(['en', 'zh-HK'])(`${name} has valid wire data and honest localized output %s`, lang => {
    expect(parseOutcomeResponse(value)).toEqual(value)
    expect(value.contentHash).toBe(fixtureProps.initialVersion.contentHash)
    const html = render(<OutcomeWindows value={value} />, lang)
    expect(html).toContain(value.evaluatedAt)
    expect(html).toContain('UTC')
    expect(html).not.toMatch(/href=|text-green|bg-green|rawAnswer|undefined/)
    expect(html).not.toMatch(/>outcomes\.[a-z]/)
    if (value.anchor) { expect(html).toContain(value.anchor.id); expect(html).toContain('D56'); expect(html).toContain('.123456Z') }
    if (value.baseline) expect(html).toContain(value.baseline.source.id)
  })
  it('rejects malformed outcome fixture data', () => {
    expect(() => parseOutcomeResponse({ ...outcomes.scan, rawAnswer: 'forbidden' })).toThrow()
    expect(() => parseOutcomeResponse({ ...outcomes.scan, windows: [] })).toThrow()
  })
})
// SSR proves the rendered information, not hydration, async reads, axe or reflow.
describe('SME stored comparison presentation', () => {
  const baseline: SafeEvidence = { source: { kind: 'scan-check', id: 'saved-baseline', checkKey: 'c4' }, collectedAt: '2026-09-01T00:00:00.123456Z', recordedAt: '2026-09-01T08:00:00.123456+08:00', verdict: 'fail', reasons: ['sampled-single-page'] }
  const selected: SafeEvidence = { ...baseline, source: { ...baseline.source, id: 'saved-observation' }, collectedAt: '2026-09-14T01:00:00.123456Z', verdict: 'pass', reasons: ['no-page-or-provider-excerpts'] }
  const comparisons = [
    { name: 'comparable improvement', baseline, selected, status: 'comparable', change: 'improved' },
    { name: 'comparable unchanged', baseline, selected: { ...selected, verdict: 'fail' }, status: 'comparable', change: 'unchanged' },
    { name: 'comparable regression', baseline: { ...baseline, verdict: 'pass' }, selected: { ...selected, verdict: 'fail' }, status: 'comparable', change: 'regressed' },
    { name: 'partial improvement', baseline: { ...baseline, reasons: ['final-path-identity-withheld'] }, selected, status: 'partially_comparable', change: 'improved' },
    { name: 'different method', baseline, selected: { ...selected, reasons: ['different-methods-or-scope'] }, status: 'not_comparable', change: 'cannot_determine' },
    { name: 'incomplete evidence', baseline, selected: { ...selected, reasons: ['incomplete-collection'] }, status: 'insufficient_evidence', change: 'cannot_determine' },
    { name: 'not observed yet', baseline, selected: null, status: 'insufficient_evidence', change: 'not_yet_observed' },
  ] satisfies Array<{ name: string; baseline: SafeEvidence; selected: SafeEvidence | null; status: OutcomeComparison['status']; change: OutcomeComparison['outcome'] }>
  for (const lang of ['en', 'zh-HK']) {
    const copy = lang === 'en' ? en.outcomes : zh.outcomes
    const visible = (html: string) => html.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, '')
    it(`preserves omitted and false legacy output for every existing state in ${lang}`, () => {
      for (const value of Object.values(outcomes)) {
        const html = render(<OutcomeWindows value={value} />, lang)
        expect(render(<OutcomeWindows value={value} smeCopilot={false} />, lang)).toBe(html)
        expect(html).not.toContain(copy.sme.context)
        expect(html).not.toContain('<details')
        expect(html).toContain(value.windows.length ? copy.comparisonLimitation : copy.baselineProvenance)
      }
      const props = { clientId: outcomes.scan.clientId, itemId: outcomes.scan.itemId, version: fixtureProps.initialVersion, viewerKey: fixtureProps.outcomeViewerKey, refreshKey: 0 }
      const legacy = render(<OutcomeWorkspace {...props} />, lang)
      expect(render(<OutcomeWorkspace {...props} smeCopilot={false} />, lang)).toBe(legacy)
      const sme = render(<OutcomeWorkspace {...props} version={smeV2Props.initialVersion!} smeCopilot />, lang)
      expect(sme).toContain(copy.loading)
      expect(sme).not.toContain(copy.sme.multiSourceUnavailable)
      expect(sme).toContain('min-h-11')
      expect(sme).toContain('whitespace-normal')
      expect(sme).toContain('focus-visible:outline-2')
      expect(sme).not.toMatch(/href=|type="submit"/)
    })
    for (const example of comparisons) it(`keeps basis, movement, verdicts and limits visible for ${example.name} in ${lang}`, () => {
      const value = outcome({ baseline: example.baseline, candidates: example.selected ? [example.selected] : [] })
      const html = render(<OutcomeWindows value={value} smeCopilot />, lang)
      const firstWindow = html.match(/<article\b[^>]*>[\s\S]*?<\/article>/)?.[0] ?? ''
      const shown = visible(firstWindow)
      const status = example.status === 'not_comparable' ? copy.sme.notComparable : copy.comparisonStatuses[example.status]
      expect(shown).toContain(status)
      expect(shown).toContain(copy.comparisonOutcomes[example.change])
      expect(shown).toContain(copy.comparisonBaseline)
      expect(shown).toContain(copy.verdicts[example.baseline.verdict as keyof typeof copy.verdicts])
      expect(shown).toContain(copy.comparisonObserved)
      expect(shown).toContain(example.selected ? copy.verdicts[example.selected.verdict as keyof typeof copy.verdicts] : copy.unknown)
      expect(shown).toContain(copy.sme.comparisonLimitation)
      expect(shown).not.toContain(copy.comparisonLimitation)
      expect(html).toContain(copy.sme.intervalPolicy)
      expect(html).not.toMatch(/>outcomes\.|undefined|text-green|bg-green/)
      if (example.selected) expect(shown).toContain(copy.provisional)
      if (example.status === 'partially_comparable') {
        expect(visible(html)).toContain(copy.sme.pathLimitation)
        expect(html).not.toContain(copy.reasons['final-path-identity-withheld'])
      }
      if (example.status === 'not_comparable') {
        expect(shown).toContain(copy.reasons['different-methods-or-scope'])
        expect(shown).not.toContain(copy.comparisonStatuses.comparable)
        expect(shown).not.toContain(copy.comparisonStatuses.partially_comparable)
      }
    })
    it(`shows each actual UTC interval, missing timing, unavailable evidence and unranked Pulse in ${lang}`, () => {
      for (const value of Object.values(outcomes)) {
        const html = render(<OutcomeWindows value={value} smeCopilot />, lang)
        const shown = visible(html)
        for (const window of value.windows) {
          const article = html.match(new RegExp(`<article[^>]*aria-label="D${window.day}[^>]*>[\\s\\S]*?<\\/article>`))?.[0] ?? ''
          const displayed = visible(article)
          expect(displayed).toContain(window.startsAt)
          expect(displayed).toContain(window.endsAt)
          expect(displayed).toContain(copy.timeStates[window.timeState])
          expect(displayed).toContain(copy.evidenceStates[window.evidenceState])
          expect(displayed).toContain(copy.comparisonOutcomes[window.comparison.outcome])
          if (!window.selected) expect(displayed).toContain(copy.sme.noSelectedEvidence)
        }
        if (value.baseline?.collectedAt === null) expect(shown).toContain(copy.collectionUnknown)
        if (value.baseline?.source.kind === 'pulse-metric') {
          expect(shown).toContain(copy.sme.pulseUnranked)
          expect(shown).not.toContain(copy.comparisonOutcomes.improved)
          expect(shown).not.toContain(copy.comparisonOutcomes.regressed)
        }
        if (value.anchor) {
          expect(shown).toContain(value.anchor.deliveredAt)
          expect(shown).toContain(value.anchor.recordedAt)
          expect(shown).toContain(copy.sme.anchorLimitation)
          expect(shown).not.toContain(copy.deliveredAt)
          expect(shown).not.toContain(copy.reasons['self-reported-delivery'])
        }
        for (const reason of value.reasons.filter(reason => !['self-reported-delivery', 'no-delivery', 'anchor-withdrawn'].includes(reason))) expect(shown).toContain(copy.reasons[reason as keyof typeof copy.reasons])
        expect(html).not.toMatch(/>outcomes\.|undefined|NaN/)
      }
    })
    it(`retains escaped technical identifiers, evaluation metadata and full offset precision in ${lang}`, () => {
      const value = outcome({ baseline: { ...baseline, source: { ...baseline.source } }, candidates: [selected] })
      value.versionId = '<script>version</script>'
      value.anchor!.id = '<img src=x onerror=alert(1)>'
      value.baseline!.source.id = '<b>baseline-id</b>'
      const html = render(<OutcomeWindows value={value} smeCopilot />, lang)
      expect(html).toContain('&lt;script&gt;version&lt;/script&gt;')
      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
      expect(html).toContain('&lt;b&gt;baseline-id&lt;/b&gt;')
      expect(html).not.toMatch(/<script>|<img|<b>baseline/)
      for (const text of [value.contentHash, value.clientId, value.itemId, value.policyVersion, value.evaluatedAt, baseline.recordedAt!, selected.source.id, copy.sme.schema, copy.sme.truncated, copy.sme.no]) expect(html).toContain(text)
      expect(html).toContain('<details')
      expect(html).not.toContain('<details open')
      expect(visible(html)).toContain(copy.reasons['sampled-single-page'])
      expect(visible(html)).toContain(copy.reasons['no-page-or-provider-excerpts'])
    })
    it(`limits the multi-source unavailable explanation to SME V2 failed reads, preserving auth errors in ${lang}`, () => {
      expect(render(<OutcomeReadError error="unavailable" smeCopilot versionSchema={2} />, lang)).toContain(copy.sme.multiSourceUnavailable)
      for (const error of ['unauthenticated', 'denied'] as const) {
        const html = render(<OutcomeReadError error={error} smeCopilot versionSchema={2} />, lang)
        expect(html).toContain(copy[error])
        expect(html).not.toContain(copy.sme.multiSourceUnavailable)
      }
      for (const props of [{}, { smeCopilot: false, versionSchema: 2 as const }, { smeCopilot: true, versionSchema: 1 as const }]) {
        const html = render(<OutcomeReadError error="unavailable" {...props} />, lang)
        expect(html).toContain(copy.unavailable)
        expect(html).not.toContain(copy.sme.multiSourceUnavailable)
      }
    })
  }
})

it.each(smeComparisonCases)('validates mounted outcome fixture $name against the real comparison policy', example => {
  const value = smeOutcomes[example.name]
  expect(parseOutcomeResponse(value)).toEqual(value)
  expect(value.windows[0].comparison).toMatchObject({ status: example.status, outcome: example.change })
})
describe('Node-produced C9F selected-version packets', () => {
  for (const lang of ['en', 'zh-HK'] as const) {
    it.each(['v2-mixed', 'v2-one-scan'] as const)('retains actual commits and projected source states for %s in ' + lang, kind => {
      const packet = journeyOutcomeFixture(lang, kind), stored = packet.values['mature-d7'].stored
      expect(packet.props.initialVersion!.schemaVersion).toBe(2)
      if (stored.schemaVersion !== 2) throw Error('Expected actual V2 projection')
      expect(stored.sources).toHaveLength(kind === 'v2-mixed' ? 3 : 1)
      expect(stored.sources[0].windows[0]).toMatchObject({ provisional: false, comparison: { status: 'partially_comparable', outcome: 'improved' } })
      for (const states of Object.values(packet.values)) for (const value of Object.values(states)) {
        expect(value.anchor?.id).toBe(stored.anchor!.id)
        expect(value.contentHash).toBe(packet.props.initialVersion!.contentHash)
      }
      const unavailable = packet.values['mature-d7']['unavailable-scan']
      if (unavailable.schemaVersion !== 2) throw Error('Expected actual V2 projection')
      expect(unavailable.sources[0].windows[0].evidenceState).toBe('unavailable')
      if (kind === 'v2-mixed') {
        expect(unavailable.sources[1].baseline!.source.kind).toBe('pulse-metric')
        const diagnostics = packet.values['mature-d7']['diagnostic-heavy']
        if (diagnostics.schemaVersion !== 2) throw Error('Expected actual V2 projection')
        expect(diagnostics.sources.reduce((count, source) => count + source.diagnostics.length, 0)).toBe(400)
      }
    })
    it('keeps two genuine first-submission alternatives distinct from history in ' + lang, () => {
      const original = journeyOutcomeFixture(lang, 'v2-mixed'), alternative = journeyOutcomeFixture(lang, 'v2-mixed', true)
      expect(original.props.initial!.versions).toHaveLength(1)
      expect(alternative.props.initial!.versions).toHaveLength(1)
      expect(original.props.initialVersion!.id).toBe(alternative.props.initialVersion!.id)
      expect(original.props.initialVersion!.contentHash).not.toBe(alternative.props.initialVersion!.contentHash)
      expect(() => parseSelectedOutcome(alternative.values['mature-d7'].stored,
        selectedOutcomeExpectation(original.props.clientId, original.props.workItemId, original.props.initialVersion!))).toThrow()
    })
    it('provides genuine schema alternatives for direct child-context fencing in ' + lang, () => {
      const original = journeyOutcomeFixture(lang, 'v2-mixed'), legacy = journeyOutcomeFixture(lang, 'v1-scan')
      expect(original.props.initialVersion!.id).toBe(legacy.props.initialVersion!.id)
      expect(legacy.values['mature-d7'].stored.schemaVersion).toBe(1)
      expect(() => parseSelectedOutcome(legacy.values['mature-d7'].stored,
        selectedOutcomeExpectation(original.props.clientId, original.props.workItemId, original.props.initialVersion!))).toThrow()
    })
  }
})

const mountedVariants = { sme: smeProps, smeV2: smeV2Props, smeSingleV2: smeSingleV2Props }
afterAll(async () => {
  await writeC9cFixture('C9F', 'C9EVersionWorkspaceFixture', '@/__tests__/components/c9e-workspace-fixture', fixtureProps,
    lang => render(<C9EVersionWorkspaceFixture {...fixtureProps} />, lang),
    Object.fromEntries(Object.entries(mountedVariants).map(([name, props]) => [name, { props, html: (lang: string) => render(<C9EVersionWorkspaceFixture {...props} />, lang) }])), 'outcomes')
  const dir = process.env.C9F_HTML_DIR
  if (!dir) return
  for (const [name, props] of Object.entries(mountedVariants)) for (const lang of ['en', 'zh-HK']) writeFileSync(join(dir, `${lang}-${name}-data.json`), JSON.stringify(props))
  // This remains the single C9F fixture writer. Node-only producers yield paired
  // actual props/DTOs; the existing emitted client entry receives JSON only.
  for (const lang of ['en', 'zh-HK'] as const) {
    const mixed = journeyOutcomeFixture(lang, 'v2-mixed'), single = journeyOutcomeFixture(lang, 'v2-one-scan')
    const alternative = journeyOutcomeFixture(lang, 'v2-mixed', true), legacy = journeyOutcomeFixture(lang, 'v1-scan')
    const packets = {
      v2Mixed: mixed, v2Single: single,
      ctxV2: { ...mixed, props: { ...mixed.props, outcomeOnly: true } },
      ctxV2Alt: { ...alternative, props: { ...alternative.props, outcomeOnly: true } },
      ctxV1: { ...legacy, props: { ...legacy.props, outcomeOnly: true } },
    }
    for (const [name, packet] of Object.entries(packets)) {
      const props = packet.props, messages = lang === 'en' ? en : zh
      writeFileSync(join(dir, `${lang}-${name}-data.json`), JSON.stringify(props))
      writeFileSync(join(dir, `${lang}-${name}-packet.json`), JSON.stringify(packet))
      writeFileSync(join(dir, `${lang}-${name}.html`), `<div id="root">${render(<C9EVersionWorkspaceFixture {...props} />, lang)}</div><script id="fixture-props" type="application/json">${JSON.stringify({ props, messages, lang }).replace(/</g, '\\u003c')}</script>`)
    }
  }
})
