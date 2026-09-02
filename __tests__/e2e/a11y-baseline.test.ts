import { describe, expect, it } from 'vitest'

import {
  compareToBaseline,
  violationSignature,
  type A11yFinding,
} from '../../tests/e2e/a11y/baseline'

const finding = (over: Partial<A11yFinding> = {}): A11yFinding => ({
  rule: 'color-contrast',
  route: '/en',
  theme: 'light',
  target: 'button.cta',
  ...over,
})

describe('violationSignature', () => {
  it('is stable across runs for the same finding', () => {
    expect(violationSignature(finding())).toBe(violationSignature(finding()))
  })

  it('distinguishes rule, route, theme and target', () => {
    const base = violationSignature(finding())
    expect(violationSignature(finding({ rule: 'region' }))).not.toBe(base)
    expect(violationSignature(finding({ route: '/zh-HK' }))).not.toBe(base)
    expect(violationSignature(finding({ theme: 'dark' }))).not.toBe(base)
    expect(violationSignature(finding({ target: 'a.link' }))).not.toBe(base)
  })
})

describe('compareToBaseline', () => {
  it('passes when observed exactly matches the baseline', () => {
    const observed = [finding()]
    const baseline = observed.map(violationSignature)
    expect(compareToBaseline(observed, baseline)).toEqual({
      unexpected: [],
      stale: [],
    })
  })

  // The gate.
  it('reports a violation that is not in the baseline', () => {
    const result = compareToBaseline([finding()], [])
    expect(result.unexpected).toHaveLength(1)
    expect(result.stale).toEqual([])
  })

  // The anti-rot rule. Without this the file accumulates dead exemptions and
  // becomes the same permanent amnesty as the critical||serious filter it
  // replaced.
  it('reports a baseline entry that no longer fires', () => {
    const stale = violationSignature(finding({ rule: 'region' }))
    const result = compareToBaseline([finding()], [violationSignature(finding()), stale])
    expect(result.unexpected).toEqual([])
    expect(result.stale).toEqual([stale])
  })

  it('reports both directions at once', () => {
    const stale = violationSignature(finding({ rule: 'region' }))
    const result = compareToBaseline([finding()], [stale])
    expect(result.unexpected).toHaveLength(1)
    expect(result.stale).toEqual([stale])
  })

  // A run that scanned nothing must not read as "everything was fixed".
  it('does not report stale entries when nothing was scanned', () => {
    const result = compareToBaseline([], [violationSignature(finding())], { scanned: false })
    expect(result.stale).toEqual([])
  })

  it('does report stale entries when a scan genuinely found nothing', () => {
    const entry = violationSignature(finding())
    const result = compareToBaseline([], [entry], { scanned: true })
    expect(result.stale).toEqual([entry])
  })
})
