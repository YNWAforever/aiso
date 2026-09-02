import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import { compareToBaseline, violationSignature, type A11yFinding, type A11yTheme } from './baseline'
import { A11Y_LOCALES, A11Y_ROUTES, A11Y_THEMES } from './matrix'

const BASELINE_PATH = join(process.cwd(), 'tests', 'e2e', 'a11y', 'baseline.json')

/**
 * Reads the accepted list. Throws rather than defaulting to [] -- an unreadable
 * baseline must never be treated as "no accepted violations", which would let a
 * broken file pass vacuously.
 */
function readBaseline(): string[] {
  const parsed: unknown = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
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
 * `target` is the axe node's own target array joined -- the closest thing axe
 * gives to a stable element identity, and not a hand-written DOM selector.
 */
function toFindings(violations: AxeViolations, route: string, theme: A11yTheme): A11yFinding[] {
  return violations.flatMap((violation) =>
    violation.nodes.map((node) => ({
      rule: violation.id,
      route,
      theme,
      target: node.target.join(' '),
    })),
  )
}

async function scan(page: import('@playwright/test').Page, path: string, theme: A11yTheme) {
  await page.emulateMedia({ colorScheme: theme })
  await page.goto(path, { waitUntil: 'networkidle' })
  // options({rules}) rather than withRules(): withRules runs ONLY the named
  // rules, which would silently disable every other check. target-size is
  // enabled:false by default in axe-core 4.12.1, so the 44px requirement is
  // never evaluated without this.
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
