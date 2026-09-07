import { expect, test } from 'vitest'
import { evaluateOutcomes } from '@/lib/outcomes/evaluate'
import { input, evidence } from './fixtures'
test.each(['no-delivery', 'withdrawn'] as const)('disables windows for %s', anchorState => expect(evaluateOutcomes(input({ anchorState, anchor: null })).windows).toEqual([]))
test('creates three ordered windows with honest time states', () => {
  const result = evaluateOutcomes(input())
  expect(result.windows.map(w => w.day)).toEqual([7,28,56])
  expect(result.windows.map(w => w.timeState)).toEqual(['awaiting-evidence','not-due','not-due'])
  expect(evaluateOutcomes(input({ evaluatedAt: '2026-09-21T00:00:00Z' })).windows[0].timeState).toBe('missing-evidence')
})
test.each([
  ['2026-09-13T23:59:59.999999Z', false], ['2026-09-14T00:00:00Z', true],
  ['2026-09-20T23:59:59.999999Z', true], ['2026-09-21T00:00:00Z', false],
] as const)('half-open boundary %s', (at, selected) => expect(!!evaluateOutcomes(input({ evaluatedAt: '2026-09-22T00:00:00Z', candidates: [evidence('a', at)] })).windows[0].selected).toBe(selected))
test('earliest failed candidate wins, exact ties use ID; selection is provisional', () => {
  const result = evaluateOutcomes(input({ candidates: [{ ...evidence('z','2026-09-14T00:00:00.000001Z'), verdict: 'pass' }, evidence('b','2026-09-14T00:00:00Z'), evidence('a','2026-09-14T00:00:00Z')] }))
  expect(result.windows[0]).toMatchObject({ selected: { source: { id: 'a' }, verdict: 'fail' }, provisional: true, evidenceState: 'not-comparable' })
  expect(JSON.stringify(result)).not.toContain('delta')
})
test('excludes future collection but permits late ingestion on fresh read', () => {
  const late = { ...evidence('late','2026-09-16T00:00:00Z'), recordedAt: '2026-09-23T00:00:00Z' }
  expect(evaluateOutcomes(input({ candidates: [late] })).windows[0].selected).toBeNull()
  expect(evaluateOutcomes(input({ candidates: [late], evaluatedAt: '2026-09-24T00:00:00Z' })).windows[0]).toMatchObject({ selected: { source: { id: 'late' } }, provisional: false })
})
test('unknown collection is diagnostic, never recorded-time selection', () => {
  const untimed = { ...evidence('legacy', null), recordedAt: '2026-09-14T00:00:00Z' }
  expect(evaluateOutcomes(input({ candidates: [untimed] }))).toMatchObject({ diagnostics: [untimed], windows: [{ selected: null, evidenceState: 'timing-unknown' }, {}, {}] })
})
test.each([null, evidence('after','2026-09-07T00:00:00.000001Z')])('invalid baseline does not become zero', baseline => expect(evaluateOutcomes(input({ baseline })).windows[0].evidenceState).toBe('invalid-baseline'))
test('baseline at delivery is eligible', () => expect(evaluateOutcomes(input({ baseline: evidence('at','2026-09-07T00:00:00Z'), candidates: [evidence('a','2026-09-14T00:00:00Z')] })).windows[0].evidenceState).toBe('not-comparable'))
test.each([{ sourceState: 'unavailable' as const, truncated: false, state: 'unavailable' },{ sourceState: 'ok' as const, truncated: true, state: 'evidence-limited' }])('suppresses certainty for $state', ({ state, ...overrides }) => expect(evaluateOutcomes(input({ ...overrides, candidates: [evidence('a','2026-09-14T00:00:00Z')] })).windows[0]).toMatchObject({ selected: null, evidenceState: state }))
test('mixed source kind or check key never selects', () => {
  for (const source of [{ kind: 'pulse-metric' as const, id: 'p', checkKey: null },{ kind: 'scan-check' as const, id: 's', checkKey: 'c2_llms_txt' }]) expect(evaluateOutcomes(input({ candidates: [{ ...evidence('a','2026-09-14T00:00:00Z'), source }] })).windows[0].selected).toBeNull()
})
test('replacement recomputes windows', () => expect(evaluateOutcomes(input({ anchor: { id: 'replacement', deliveredAt: '2026-09-08T00:00:00Z', recordedAt: '2026-09-08T00:00:00Z' }, candidates: [evidence('a','2026-09-14T00:00:00Z')] })).windows[0]).toMatchObject({ startsAt: '2026-09-15T00:00:00.000000Z', selected: null }))
test('Pulse provenance gaps remain explicit', () => {
  const pulse = { ...evidence('pulse',null), source: { kind: 'pulse-metric' as const, id: 'pulse', checkKey: null }, reasons: ['pulse-provenance-incomplete'] }
  expect(evaluateOutcomes(input({ baseline: pulse, candidates: [pulse] })).windows[0].evidenceState).toBe('timing-unknown')
})

test.each([28,56])('preserves D%s half-open endpoints and anchor precision', day => {
  const anchor = { id: 'micro-anchor', deliveredAt: '2026-09-07T00:00:00.000001Z', recordedAt: '2026-09-07T01:00:00Z' }
  const start = day === 28 ? '2026-10-05T00:00:00.000001Z' : '2026-11-02T00:00:00.000001Z'
  const end = day === 28 ? '2026-10-12T00:00:00.000001Z' : '2026-11-09T00:00:00.000001Z'
  const result = evaluateOutcomes(input({ anchor, evaluatedAt: '2026-11-10T00:00:00Z', candidates: [evidence('start',start), evidence('end',end)] }))
  expect(result.windows.find(w => w.day === day)).toMatchObject({ startsAt: start, endsAt: end, selected: { source: { id: 'start' } }, provisional: false })
  expect(evaluateOutcomes(input({ anchor, evaluatedAt: '2026-11-10T00:00:00Z', candidates: [evidence('end',end)] })).windows.find(w => w.day === day)?.selected).toBeNull()
})
test('an overflow witness suppresses selection even if caller omitted truncation', () => {
  const candidates = Array.from({ length: 201 }, (_, index) => evidence(`scan-${index}`, '2026-09-14T00:00:00Z'))
  expect(evaluateOutcomes(input({ candidates }))).toMatchObject({ truncated: true, windows: [{ selected: null, evidenceState: 'evidence-limited' }, {}, {}] })
})
