import { describe, expect, it } from 'vitest'
import { compareOutcome } from '@/lib/outcomes/evaluate'
import type { SafeEvidence } from '@/lib/outcomes/types'

/**
 * The adapter that used to be a hole.
 *
 * Every path through evaluateOutcomes ended at 'no-comparable-adapter', so an
 * owner who applied a change could never be told whether the finding moved.
 * These cases pin the two decisions that keep that honest: whether the two
 * records may be compared at all, and — separately — what changed.
 *
 * They are separate on purpose. A real movement observed under conditions that
 * cannot be fully proven is still worth showing, provided the caller says which
 * it is; collapsing them would force a choice between hiding the change and
 * overstating it.
 */

const scan = (over: Partial<SafeEvidence> = {}): SafeEvidence => ({
  source: { kind: 'scan-check', id: 'scan-1', checkKey: 'c1_robots' },
  recordedAt: '2026-09-01T00:00:00Z',
  collectedAt: '2026-09-01T00:00:00Z',
  verdict: 'fail',
  reasons: [],
  ...over,
})

const pulse = (over: Partial<SafeEvidence> = {}): SafeEvidence => ({
  source: { kind: 'pulse-metric', id: 'pulse-1', checkKey: null },
  recordedAt: '2026-09-01T00:00:00Z',
  collectedAt: null,
  verdict: 'success',
  reasons: ['pulse-provenance-incomplete'],
  ...over,
})

describe('compareOutcome: what changed', () => {
  it.each([
    ['fail', 'pass', 'improved'],
    ['fail', 'warn', 'improved'],
    ['warn', 'pass', 'improved'],
    ['pass', 'pass', 'unchanged'],
    ['fail', 'fail', 'unchanged'],
    ['pass', 'fail', 'regressed'],
    ['warn', 'fail', 'regressed'],
    ['pass', 'warn', 'regressed'],
  ] as const)('reads %s -> %s as %s', (before, after, outcome) => {
    const result = compareOutcome(scan({ verdict: before }), scan({ verdict: after }))

    expect(result.outcome).toBe(outcome)
    expect(result.status).toBe('comparable')
    expect(result.baselineVerdict).toBe(before)
    expect(result.observedVerdict).toBe(after)
  })

  it.each([
    ['not-applicable', 'pass'],
    ['pass', 'not-applicable'],
    ['not-verifiable', 'fail'],
    ['fail', 'not-verifiable'],
  ] as const)('will not rank %s against %s', (before, after) => {
    // These are the absence of a verdict rather than a worse or better one.
    // Ranking them would turn "we could not look" into "it got worse".
    expect(compareOutcome(scan({ verdict: before }), scan({ verdict: after })).outcome).toBe('cannot_determine')
  })

  it('never compares content, only the verdict and the conditions', () => {
    // Same method, same target, different collection time. The page's content is
    // expected to differ, and nothing here looks at it.
    const before = scan({ verdict: 'fail', collectedAt: '2026-09-01T00:00:00Z' })
    const after = scan({ verdict: 'pass', collectedAt: '2026-09-19T00:00:00Z' })

    expect(compareOutcome(before, after)).toEqual({
      status: 'comparable', outcome: 'improved', baselineVerdict: 'fail', observedVerdict: 'pass',
    })
  })
})

describe('compareOutcome: whether it may be compared at all', () => {
  it('hedges to partially comparable when page identity is withheld', () => {
    // The change is real and worth showing; what cannot be shown is that both
    // runs landed on the same page.
    const result = compareOutcome(
      scan({ verdict: 'fail', reasons: ['final-path-identity-withheld'] }),
      scan({ verdict: 'pass' }),
    )

    expect(result.status).toBe('partially_comparable')
    expect(result.outcome).toBe('improved')
  })

  it.each(['different-methods-or-scope', 'different-source-subject'])(
    'refuses outright on %s, and states no outcome',
    reason => {
      const result = compareOutcome(scan({ reasons: [reason] }), scan({ verdict: 'pass' }))

      expect(result.status).toBe('not_comparable')
      expect(result.outcome).toBe('cannot_determine')
    },
  )

  it.each(['incomplete-collection', 'source-malformed', 'unknown-evidence', 'collection-time-unknown'])(
    'treats %s as insufficient evidence rather than a refusal',
    reason => {
      // Different from the case above: the work matches, but one side cannot be
      // trusted. "Not yet" and "never" must not render the same way.
      const result = compareOutcome(scan(), scan({ verdict: 'pass', reasons: [reason] }))

      expect(result.status).toBe('insufficient_evidence')
      expect(result.outcome).toBe('cannot_determine')
    },
  )

  it('takes the reason from either side', () => {
    expect(compareOutcome(scan({ reasons: ['incomplete-collection'] }), scan()).status).toBe('insufficient_evidence')
    expect(compareOutcome(scan(), scan({ reasons: ['incomplete-collection'] })).status).toBe('insufficient_evidence')
  })

  it('refuses when the subject differs, even if both sides look clean', () => {
    const other = scan({ source: { kind: 'scan-check', id: 'scan-2', checkKey: 'c8_sitemap' }, verdict: 'pass' })

    expect(compareOutcome(scan(), other).status).toBe('not_comparable')
  })
})

describe('compareOutcome: nothing to compare', () => {
  it('reports not yet observed when the window holds no candidate', () => {
    const result = compareOutcome(scan(), null)

    expect(result).toEqual({
      status: 'insufficient_evidence', outcome: 'not_yet_observed',
      baselineVerdict: 'fail', observedVerdict: null,
    })
  })

  it('reports insufficient evidence with no baseline at all', () => {
    expect(compareOutcome(null, scan({ verdict: 'pass' }))).toEqual({
      status: 'insufficient_evidence', outcome: 'cannot_determine',
      baselineVerdict: null, observedVerdict: 'pass',
    })
  })

  it('has no adapter for a Pulse baseline, and says so rather than guessing', () => {
    // success/incomplete describe whether the observation completed, not whether
    // it went well. Ranking them would read a collection state as a result.
    const result = compareOutcome(pulse(), pulse({ verdict: 'incomplete' }))

    expect(result.status).toBe('not_comparable')
    expect(result.outcome).toBe('cannot_determine')
  })
})
