import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { cellId, compareCounts, type A11yTheme, type Baseline, type RuleCounts } from './baseline'
import { A11Y_LOCALES, A11Y_ROUTES, A11Y_THEMES } from './matrix'

const BASELINE_PATH = join(process.cwd(), 'tests', 'e2e', 'a11y', 'baseline.json')

/**
 * Reads the accepted counts. Throws rather than defaulting to {} -- an
 * unreadable baseline must never be treated as "no accepted violations",
 * which would let a broken file pass vacuously.
 */
function readBaseline(): Baseline {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  } catch (error) {
    // A bare SyntaxError from JSON.parse names neither the file nor the fix.
    // Both failure modes here must be equally legible -- see the shape check below.
    throw new Error(
      `${BASELINE_PATH} could not be read or parsed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (
    typeof parsed !== 'object' || parsed === null
    || typeof (parsed as { accepted?: unknown }).accepted !== 'object'
    || (parsed as { accepted?: unknown }).accepted === null
    || Array.isArray((parsed as { accepted?: unknown }).accepted)
  ) {
    throw new Error(`${BASELINE_PATH} is malformed: expected { "accepted": Record<string, RuleCounts> }`)
  }
  return (parsed as { accepted: Baseline }).accepted
}

type AxeViolations = Awaited<ReturnType<AxeBuilder['analyze']>>['violations']

/** axe violations reduced to rule -> number of violating nodes. */
function toRuleCounts(violations: AxeViolations): RuleCounts {
  const counts: RuleCounts = {}
  for (const violation of violations) counts[violation.id] = violation.nodes.length
  return counts
}

async function scan(page: Page, path: string, theme: A11yTheme) {
  // reducedMotion is not only about flakiness, though it fixes a real one: the
  // onboarding progress bar has a 500ms transition (OnboardingWizard.tsx:228)
  // and networkidle does not wait for animations, so axe scanned it mid-flight
  // and reported a different node on different runs. app/globals.css:241
  // already honours the media query with transition-duration: 0.01ms, so this
  // settles the page -- and it also exercises the reduced-motion state the base
  // plan requires and nothing else in the matrix covered.
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
  await page.goto(path, { waitUntil: 'networkidle' })
  // options({rules}) rather than withRules(): withRules runs ONLY the named
  // rules, which would silently disable every other check. target-size is
  // enabled:false by default in axe-core 4.12.1, so touch-target size is never
  // evaluated without this. Note it checks WCAG 2.5.8 AA (minSize 24), NOT the
  // 44px of 2.5.5 AAA -- axe-core does not implement the AAA criterion.
  const results = await new AxeBuilder({ page })
    .options({ rules: { 'target-size': { enabled: true } } })
    .analyze()
  return toRuleCounts(results.violations)
}

for (const locale of A11Y_LOCALES) {
  for (const theme of A11Y_THEMES) {
    for (const route of A11Y_ROUTES) {
      const path = route.path(locale)

      test(`a11y ${route.id} ${locale} ${theme}`, async ({ page }, testInfo) => {
        const observed = await scan(page, path, theme)
        const viewport = testInfo.project.name.replace(/^a11y-/, '')
        const id = cellId(path, theme, viewport)

        await testInfo.attach(`axe-${route.id}-${locale}-${theme}`, {
          body: Buffer.from(JSON.stringify(observed, null, 2)),
          contentType: 'application/json',
        })

        const { exceeded, improved } = compareCounts(observed, readBaseline()[id] ?? {})

        expect(
          exceeded,
          `New accessibility violations at ${id}. Fix them, or raise the count in `
          + 'tests/e2e/a11y/baseline.json.',
        ).toEqual([])

        expect(
          improved,
          `Accessibility improved at ${id} -- lower these counts in `
          + 'tests/e2e/a11y/baseline.json. A baseline that only grows is an amnesty.',
        ).toEqual([])
      })
    }
  }
}
