/**
 * Baseline comparison for the accessibility matrix.
 *
 * Deliberately free of any Playwright or axe import, so the logic that decides
 * whether the gate passes can be unit-tested without a browser.
 *
 * Counts, not selectors. An earlier version keyed each accepted violation on
 * axe's `node.target`, which is not stable: axe generates only as much selector
 * specificity as it needs to disambiguate, so the same element was observed as
 * `.gap-1\.5.inline-flex:nth-child(1)` on one run and
 * `.gap-1\.5.inline-flex.items-center:nth-child(1)` on another. That flaked
 * roughly one run in nine, and a gate that fails on unrelated PRs gets switched
 * off. Storing a count per rule per cell cannot drift, because it never records
 * a selector at all. The cost is that a failure names the rule and the cell
 * rather than the element -- the attached axe report has the element.
 *
 * The baseline is recorded from CI, and CI is the authority. Counts are not
 * fully portable across operating systems: measured 2026-09-03, `color-contrast`
 * at `/en/pricing | dark | 768` is 18 on CI's Linux runner and 19 on Windows,
 * reproducibly -- two independent CI runs on the same commit gave 18 both times,
 * so this is a rendering difference, not flake. Only that one cell of eighty
 * differs; the other seven `pricing | dark` cells agree at 19 on both platforms.
 * The practical consequence is that a Windows developer running the matrix
 * locally will see that single cell fail as "exceeded". Do not "fix" it by
 * raising the number -- that would turn the cell red on CI, which is the run
 * that gates merges. Re-record baselines from a CI run, not a local one.
 */

export type A11yTheme = 'light' | 'dark'

/** axe rule id -> number of violating nodes. */
export type RuleCounts = Record<string, number>

/** cell id -> the counts accepted for it. */
export type Baseline = Record<string, RuleCounts>

/**
 * Viewport is part of the identity because counts legitimately differ by width:
 * a responsive layout can hide at 375 what it shows at 1440. Including it means
 * a single cell owns all of its keys, so one test can check both directions.
 */
export function cellId(route: string, theme: A11yTheme, viewport: string): string {
  return `${route} | ${theme} | ${viewport}`
}

export type CountDelta = { rule: string, accepted: number, observed: number }

export type CountComparison = {
  /** Count rose, or the rule is new. New accessibility debt. */
  exceeded: CountDelta[]
  /** Count fell, or the rule stopped firing. The baseline must be lowered. */
  improved: CountDelta[]
}

/**
 * Compares one cell's observed rule counts against the counts accepted for it.
 *
 * Both directions fail. `improved` is not a nicety: a baseline that never has to
 * shrink accumulates dead allowances until it permits anything, which is the
 * same failure as the `critical || serious` filter this whole gate replaced.
 */
export function compareCounts(observed: RuleCounts, accepted: RuleCounts): CountComparison {
  const rules = new Set([...Object.keys(observed), ...Object.keys(accepted)])
  const exceeded: CountDelta[] = []
  const improved: CountDelta[] = []

  for (const rule of [...rules].sort()) {
    const seen = observed[rule] ?? 0
    const allowed = accepted[rule] ?? 0
    if (seen > allowed) exceeded.push({ rule, accepted: allowed, observed: seen })
    else if (seen < allowed) improved.push({ rule, accepted: allowed, observed: seen })
  }

  return { exceeded, improved }
}
