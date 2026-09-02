import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { compareToBaseline, violationSignature, type A11yFinding, type A11yTheme } from './baseline'
import { A11Y_LOCALES, A11Y_ROUTES, A11Y_THEMES } from './matrix'

const BASELINE_PATH = join(process.cwd(), 'tests', 'e2e', 'a11y', 'baseline.json')

/**
 * Reads the accepted list. Throws rather than defaulting to [] -- an unreadable
 * baseline must never be treated as "no accepted violations", which would let a
 * broken file pass vacuously.
 */
function readBaseline(): string[] {
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
    || !Array.isArray((parsed as { accepted?: unknown }).accepted)
  ) {
    throw new Error(`${BASELINE_PATH} is malformed: expected { "accepted": string[] }`)
  }
  return (parsed as { accepted: string[] }).accepted
}

type AxeViolations = Awaited<ReturnType<AxeBuilder['analyze']>>['violations']

/**
 * React's useId() output is stable only while the render tree is unchanged --
 * it encodes tree position, not element identity. A signature carrying one
 * would go stale (and reappear as new) whenever an unrelated component earlier
 * in the tree starts or stops calling useId, firing both halves of the ratchet
 * on a PR that touched no accessibility at all. Collapse it to a placeholder so
 * the entry tracks the element rather than its render position.
 */
function stableTarget(target: string): string {
  return target.replace(/_R_[0-9a-z]+_/gi, '_R_')
}

/**
 * `target` is the axe node's own target array joined -- the closest thing axe
 * gives to a stable element identity, and not a hand-written DOM selector.
 */
function toFindings(violations: AxeViolations, route: string, theme: A11yTheme): A11yFinding[] {
  return violations.flatMap((violation) =>
    violation.nodes.map((node) => ({
      rule: violation.id,
      route,
      theme,
      target: stableTarget(node.target.join(' ')),
    })),
  )
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
  return toFindings(results.violations, path, theme)
}

for (const locale of A11Y_LOCALES) {
  for (const theme of A11Y_THEMES) {
    for (const route of A11Y_ROUTES) {
      const path = route.path(locale)

      test(`a11y ${route.id} ${locale} ${theme}`, async ({ page }, testInfo) => {
        const observed = await scan(page, path, theme)

        await testInfo.attach(`axe-${route.id}-${locale}-${theme}`, {
          body: Buffer.from(JSON.stringify(observed.map(violationSignature), null, 2)),
          contentType: 'application/json',
        })

        const { unexpected } = compareToBaseline(observed, readBaseline())

        expect(
          unexpected.map(violationSignature),
          `New accessibility violations at ${path} (${theme}). Fix them, or add these `
          + 'signatures to tests/e2e/a11y/baseline.json with a reason.',
        ).toEqual([])
      })
    }
  }
}
