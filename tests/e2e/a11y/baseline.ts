/**
 * Baseline comparison for the accessibility matrix.
 *
 * Deliberately free of any Playwright or axe import, so the logic that decides
 * whether the gate passes can be unit-tested without a browser.
 */

export type A11yTheme = 'light' | 'dark'

export type A11yFinding = {
  rule: string
  route: string
  theme: A11yTheme
  /** A stable description of the offending element -- NOT a hand-written selector. */
  target: string
}

export type BaselineComparison = {
  /** Observed but not accepted. These fail the gate. */
  unexpected: A11yFinding[]
  /** Accepted but no longer observed. These also fail -- see below. */
  stale: string[]
}

/**
 * A signature identifying one piece of accessibility debt.
 *
 * Viewport and locale are excluded on purpose: the same control failing at 375
 * and at 768 is one problem, not two, and an entry per matrix cell would make
 * the file unreadable and churn on every breakpoint change. Theme IS included,
 * because a contrast failure in dark mode is a genuinely different defect from
 * the same element passing in light. Route is included because it carries the
 * locale prefix already.
 */
export function violationSignature(finding: A11yFinding): string {
  return `${finding.rule} | ${finding.route} | ${finding.theme} | ${finding.target}`
}

/**
 * Compares observed violations against accepted ones, in BOTH directions.
 *
 * `stale` is not a nicety. An entry that no longer fires means the debt was
 * fixed, and leaving it recorded lets the file accumulate dead exemptions until
 * it is a blanket amnesty -- the same shape as the `critical || serious` filter
 * this replaces. Failing on it forces the file to shrink as things improve.
 *
 * `scanned: false` suppresses stale reporting: a run that scanned nothing has
 * not proved anything was fixed, and must not be allowed to empty the baseline.
 */
export function compareToBaseline(
  observed: A11yFinding[],
  baseline: string[],
  options: { scanned?: boolean } = {},
): BaselineComparison {
  const scanned = options.scanned ?? true
  const accepted = new Set(baseline)
  const seen = new Set(observed.map(violationSignature))

  return {
    unexpected: observed.filter((f) => !accepted.has(violationSignature(f))),
    stale: scanned ? baseline.filter((entry) => !seen.has(entry)) : [],
  }
}
