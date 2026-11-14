import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { MultiSourceOutcomeWindows } from '@/components/outcomes/MultiSourceOutcomeWindows'
import { OutcomeReadError, OutcomeWindows } from '@/components/outcomes/OutcomeWindows'
import { getCheckActionCopy } from '@/lib/checkExplanations'
import { evaluateMultiSourceOutcomes, multiSourceOutcomeContext, parseMultiSourceOutcomeResponse } from '@/lib/outcomes/multi-source'
import type { MultiSourceOutcomeInput } from '@/lib/outcomes/multi-source'
import { OUTCOME_REASON_CODES } from '@/lib/outcomes/types'
import type { SafeEvidence } from '@/lib/outcomes/types'
import type { DraftSnapshotV1 } from '@/lib/opportunities/types'
import { approvedMultiSourceVersion, scanSnapshot } from '../delivery/multi-source-fixtures'
import { approvedVersion, REQUEST_ID } from '../delivery/fixtures'
import { input } from '../outcomes/fixtures'
import { outcomes } from './c9f-fixtures'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

// Match the existing pure/freezer Node tests: stub only Next's boundary marker,
// not the freezer, projection, evaluator, decoder, clock or rendered component.
vi.mock('server-only', () => ({}))

const baselineAt = '2026-09-01T00:00:00.123456Z'
function scan(at: string | null = baselineAt): DraftSnapshotV1 {
  const snapshot = scanSnapshot()
  if (snapshot.evidence.kind !== 'scan-check') throw new Error('Expected real scan rule output')
  return { ...snapshot, evidence: { ...snapshot.evidence, collectedAt: at, recordedAt: baselineAt } }
}
function baseline(snapshot: DraftSnapshotV1): SafeEvidence {
  const evidence = snapshot.evidence
  return evidence.kind === 'scan-check'
    ? { source: { kind: evidence.kind, id: evidence.scanId, checkKey: evidence.checkKey }, collectedAt: evidence.collectedAt, recordedAt: evidence.recordedAt, verdict: evidence.check.assessment, reasons: ['final-path-identity-withheld'] }
    : { source: { kind: evidence.kind, id: evidence.id, checkKey: null }, collectedAt: null, recordedAt: evidence.recordedAt, verdict: evidence.result, reasons: ['collection-time-unknown', 'pulse-provenance-incomplete'] }
}
function observation(base: SafeEvidence): SafeEvidence {
  return { ...base, source: { ...base.source, id: 'observed-scan' }, collectedAt: '2026-09-14T01:00:00.000001Z', recordedAt: '2026-09-14T02:00:00.123456Z', verdict: 'pass' }
}
/** Real Node freezer/hash + actual V2 policy and strict context decoder; never hand-write a final window. */
function packet(snapshots: DraftSnapshotV1[] = [scan(), approvedVersion().evidenceSnapshot, scan()], change?: (value: MultiSourceOutcomeInput) => void) {
  const version = approvedMultiSourceVersion(null, snapshots)
  const { evaluatedAt, anchorState, anchor } = input()
  const value: MultiSourceOutcomeInput = {
    schemaVersion: 2, clientId: REQUEST_ID, itemId: version.workItemId, versionId: version.id, contentHash: version.contentHash,
    evaluatedAt, anchorState, anchor,
    sources: version.evidenceSnapshots.map((snapshot, sourceIndex) => {
      const frozen = baseline(snapshot)
      return { sourceIndex, baseline: frozen, candidates: frozen.source.kind === 'scan-check' ? [observation(frozen)] : [], sourceState: 'ok', truncated: false }
    }),
  }
  change?.(value)
  const response = evaluateMultiSourceOutcomes(value)
  const decoded = parseMultiSourceOutcomeResponse(JSON.parse(JSON.stringify(response)), multiSourceOutcomeContext(value))
  expect(decoded).toEqual(response)
  return { value: decoded, snapshots: version.evidenceSnapshots }
}
const render = (node: React.ReactNode, lang: string) => renderToString(<NextIntlClientProvider locale={lang} messages={lang === 'en' ? en : zh} timeZone="UTC">{node}</NextIntlClientProvider>)
// No nested disclosures in this renderer. This models default-visible SSR text,
// not browser computed styles, hydration, keyboard behavior, axe or reflow.
const visible = (html: string) => html.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, '')
const windows = (html: string) => [...html.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/g)].map(match => match[0])
const cards = (html: string) => [...html.matchAll(/<section\b[^>]*>[\s\S]*?<\/section>/g)].map(match => match[0])

for (const lang of ['en', 'zh-HK']) {
  const copy = lang === 'en' ? en.outcomes : zh.outcomes
  describe(`V2 ordered source presentation (${lang})`, () => {
    it.each([false, true])('keeps three frozen entries, duplicate subjects and unique source/window labels; SME=%s', smeCopilot => {
      const data = packet(), html = render(<MultiSourceOutcomeWindows {...data} smeCopilot={smeCopilot} />, lang)
      const shown = visible(html), sourceCards = cards(html)
      expect(sourceCards).toHaveLength(3)
      expect(windows(html)).toHaveLength(9)
      for (const number of [1, 2, 3]) expect(sourceCards[number - 1]).toContain(copy.v2.sourceNumber.replace('{number}', String(number)))
      const title = getCheckActionCopy('c1_robots', lang)!.title
      expect(sourceCards[0]).toContain(title)
      expect(sourceCards[2]).toContain(title)
      expect(sourceCards[1]).toContain('Example?')
      expect((shown.match(new RegExp(title, 'g')) ?? []).length).toBe(2)
      const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1])
      expect(ids).toHaveLength(12)
      expect(new Set(ids).size).toBe(ids.length)
      for (const ref of html.matchAll(/aria-labelledby="([^"]+)"/g)) expect(ids).toContain(ref[1])
      expect(shown).not.toContain(REQUEST_ID)
      expect(shown).not.toContain(data.value.contentHash)
      expect(shown).not.toContain('c1_robots')
      expect(html).toContain('min-h-11')
      expect(html).toContain('focus-visible:outline-2')
      expect(html).not.toMatch(/<details[^>]*\bopen\b|href=|type="submit"|text-green|bg-green|>outcomes\./)
      expect(html).toContain(data.value.evaluatedAt)
      expect(html.split(data.value.policyVersion)).toHaveLength(2)
      expect(html.split(copy.sme.intervalPolicy)).toHaveLength(2)
    })

    it('uses instance-local IDs, ordinal source titles and window names across two instances in one SSR tree', () => {
      const data = packet(), html = render(<><MultiSourceOutcomeWindows {...data} /><MultiSourceOutcomeWindows {...data} /></>, lang)
      const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1])
      expect(ids).toHaveLength(24)
      expect(new Set(ids).size).toBe(24)
      for (const window of windows(html)) expect(window).toMatch(/aria-labelledby="[^"]+-source-\d-d(?:7|28|56)"/)
    })

    it('keeps an actual one-source frozen V2 package as one card, not a V1 facade', () => {
      const data = packet([scan()]), html = render(<MultiSourceOutcomeWindows {...data} />, lang)
      expect(data.value.schemaVersion).toBe(2)
      expect(cards(html)).toHaveLength(1)
      expect(windows(html)).toHaveLength(3)
      expect(html).toContain('stored-outcomes.v2')
      expect(html).not.toContain('stored-outcomes.v1')
    })

    it('leads with an invalid baseline even when the actual policy retains a raw improvement', () => {
      const data = packet([scan('2026-09-08T00:00:00.123456Z')])
      expect(data.value.sources[0].windows[0]).toMatchObject({ evidenceState: 'invalid-baseline', comparison: { outcome: 'improved' } })
      const first = windows(render(<MultiSourceOutcomeWindows {...data} smeCopilot />, lang))[0], shown = visible(first)
      expect(shown).toContain(copy.evidenceStates['invalid-baseline'])
      expect(shown).toContain(copy.reasons['baseline-after-delivery'])
      expect(shown).not.toContain(copy.comparisonOutcomes.improved)
      expect(first).toContain(copy.comparisonOutcomes.improved)
      expect(shown.indexOf(copy.evidenceStates['invalid-baseline'])).toBeLessThan(shown.indexOf(copy.comparisonBasis))
    })

    it('keeps valid siblings visible when one actual source policy is unavailable', () => {
      const data = packet(undefined, value => { value.sources[0].sourceState = 'unavailable' })
      const sourceCards = cards(render(<MultiSourceOutcomeWindows {...data} />, lang))
      expect(sourceCards).toHaveLength(3)
      expect(visible(windows(sourceCards[0])[0])).toContain(copy.evidenceStates.unavailable)
      expect(visible(windows(sourceCards[0])[0])).not.toContain(copy.comparisonOutcomes.improved)
      expect(visible(sourceCards[2])).toContain(copy.comparisonOutcomes.improved)
    })

    it('shows the distinct diagnostic limit from the real 400-occurrence allocation, including duplicates', () => {
      const pulse = approvedVersion().evidenceSnapshot
      const data = packet([pulse, structuredClone(pulse), structuredClone(pulse)], value => {
        const rows = Array.from({ length: 200 }, (_, index): SafeEvidence => ({ ...value.sources[0].baseline!, source: { ...value.sources[0].baseline!.source, id: `retained-${index}` } }))
        for (const source of value.sources) source.candidates = rows
      })
      expect(data.value.sources.map(source => source.diagnostics.length)).toEqual([134, 133, 133])
      expect(data.value.sources.reduce((sum, source) => sum + source.diagnostics.length, 0)).toBe(400)
      const html = render(<MultiSourceOutcomeWindows {...data} />, lang), shown = visible(html)
      expect(shown).toContain(copy.v2.reasons['diagnostic-limit-exceeded'])
      expect(shown).toContain(copy.evidenceStates['evidence-limited'])
      expect(shown).not.toContain('retained-0')
      expect(html).toContain('retained-0')
      expect(html).toContain(copy.v2.diagnosticBudget)
      expect(html.match(/<li class="rounded border border-border p-3"/g)).toHaveLength(400)
      expect(html).not.toContain('outcomes.v2.reasons')
    })

    it('keeps the raw candidate bound distinct from diagnostic loss and suppresses movement', () => {
      const data = packet([scan()], value => {
        value.sources[0].candidates = Array.from({ length: 201 }, (_, index) => ({ ...value.sources[0].baseline!, source: { ...value.sources[0].baseline!.source, id: `candidate-${index}` }, collectedAt: null }))
      })
      const shown = visible(render(<MultiSourceOutcomeWindows {...data} />, lang))
      expect(shown).toContain(copy.reasons['candidate-limit-exceeded'])
      expect(shown).not.toContain(copy.v2.reasons['diagnostic-limit-exceeded'])
      expect(shown).not.toContain(copy.comparisonOutcomes.improved)
    })

    it('places provisional status and comparison basis before retained movement', () => {
      const data = packet([scan()]), window = data.value.sources[0].windows[0]
      expect(window).toMatchObject({ provisional: true, comparison: { status: 'partially_comparable', outcome: 'improved' } })
      const shown = visible(windows(render(<MultiSourceOutcomeWindows {...data} />, lang))[0])
      expect(shown).toContain(copy.provisional)
      expect(shown).toContain(copy.comparisonBasis)
      expect(shown).toContain(copy.comparisonOutcomes.improved)
      expect(shown.indexOf(copy.provisional)).toBeLessThan(shown.indexOf(copy.comparisonBasis))
      expect(shown.indexOf(copy.comparisonBasis)).toBeLessThan(shown.indexOf(copy.comparisonOutcomes.improved))
      expect(shown).toContain(copy.comparisonStatuses.partially_comparable)
    })

    it.each([false, true])('does not promise a common comparison method for a V2 package; SME=%s', smeCopilot => {
      const examples = [
        ...(['active', 'no-delivery', 'withdrawn'] as const).map(state => packet([approvedVersion().evidenceSnapshot], value => {
          value.anchorState = state
          if (state !== 'active') value.anchor = null
        })),
        packet([scan()], value => { value.sources[0].sourceState = 'unavailable' }),
        packet([scan()], value => { value.sources[0].candidates[0].reasons.push('different-methods-or-scope') }),
      ]
      for (const data of examples) {
        const shown = visible(render(<MultiSourceOutcomeWindows {...data} smeCopilot={smeCopilot} />, lang))
        expect(shown).toContain(copy.sme.comparisonLimitation)
        expect(shown).not.toContain(copy.comparisonLimitation)
      }
    })

    it('keeps Pulse collection unranked, including when no delivery windows exist', () => {
      for (const state of ['active', 'no-delivery', 'withdrawn'] as const) {
        const data = packet([approvedVersion().evidenceSnapshot], value => {
          value.anchorState = state
          if (state !== 'active') value.anchor = null
        })
        const shown = visible(render(<MultiSourceOutcomeWindows {...data} />, lang))
        expect(shown).toContain(copy.sme.pulseUnranked)
        expect(shown).not.toContain(copy.comparisonOutcomes.improved)
        expect(shown).not.toContain(copy.comparisonOutcomes.regressed)
        if (state !== 'active') expect(windows(shown)).toHaveLength(0)
      }
    })

    it('shows timing uncertainty, future and elapsed-missing windows without client clock recomputation', () => {
      const unknown = packet([scan(null)])
      expect(visible(windows(render(<MultiSourceOutcomeWindows {...unknown} />, lang))[0])).toContain(copy.evidenceStates['timing-unknown'])
      const awaiting = packet([scan()], value => { value.sources[0].candidates = [] })
      expect(visible(windows(render(<MultiSourceOutcomeWindows {...awaiting} />, lang))[0])).toContain(copy.timeStates['awaiting-evidence'])
      const missing = packet([scan()], value => { value.evaluatedAt = '2026-09-22T00:00:00.123456Z'; value.sources[0].candidates = [] })
      const html = render(<MultiSourceOutcomeWindows {...missing} />, lang), entries = windows(html)
      expect(visible(entries[0])).toContain(copy.timeStates['missing-evidence'])
      expect(visible(entries[1])).toContain(copy.timeStates['not-due'])
      expect(html).toContain(missing.value.sources[0].windows[0].startsAt)
      expect(html).toContain(missing.value.sources[0].windows[0].endsAt)
      expect(html).toContain('.000000Z')
    })

    it('renders long frozen Pulse questions as escaped text, not reply-derived HTML or technical titles', () => {
      const pulse = approvedVersion().evidenceSnapshot
      if (pulse.evidence.kind !== 'pulse-metric') throw new Error('Expected Pulse snapshot')
      const question = '<script>doNotRun()</script>' + '保留 question '.repeat(35).trim()
      const data = packet([{ ...pulse, evidence: { ...pulse.evidence, question }, args: { ...pulse.args, question }, initialTitle: 'not-the-current-source-title' }])
      const html = render(<MultiSourceOutcomeWindows {...data} />, lang)
      expect(html).toContain('&lt;script&gt;doNotRun()&lt;/script&gt;')
      expect(html).not.toContain('<script>')
      expect(html).not.toContain('not-the-current-source-title')
      expect(html).toContain('break-words')
    })

    it('keeps existing V1 flag presentations and exact old reason vocabulary while updating only V2 read-failure copy', () => {
      for (const value of Object.values(outcomes)) {
        expect(render(<OutcomeWindows value={value} />, lang)).toBe(render(<OutcomeWindows value={value} smeCopilot={false} />, lang))
        const sme = render(<OutcomeWindows value={value} smeCopilot />, lang)
        expect(sme).not.toContain(copy.v2.readDetails)
      }
      expect(Object.keys(copy.reasons).sort()).toEqual([...OUTCOME_REASON_CODES].sort())
      expect(render(<OutcomeReadError error="unavailable" versionSchema={2} smeCopilot />, lang)).toContain(copy.sme.multiSourceUnavailable)
      expect(copy.sme.multiSourceUnavailable).not.toMatch(/not currently supported|未支援/)
      for (const error of ['unauthenticated', 'denied'] as const) expect(render(<OutcomeReadError error={error} versionSchema={2} smeCopilot />, lang)).toContain(copy[error])
      expect(Object.keys(en.outcomes.v2).sort()).toEqual(Object.keys(zh.outcomes.v2).sort())
      expect(Object.keys(en.outcomes.v2.reasons)).toEqual(['diagnostic-limit-exceeded'])
      expect(Object.keys(zh.outcomes.v2.reasons)).toEqual(['diagnostic-limit-exceeded'])
    })
  })
}
