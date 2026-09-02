# Accessibility and Responsive Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the `e2e-accessibility` job from a check on three English pages in light theme into a real gate — every impact level, `target-size` enabled, both locales, both themes, four viewports — without CI going red on inherited debt.

**Architecture:** A matrix-driven axe scan over `{route, locale, theme, viewport}`, with accepted violations recorded in a checked-in baseline. A violation absent from the baseline fails; a baseline entry that no longer fires also fails, so the file cannot rot into a permanent amnesty. The comparison logic is a pure function unit-tested without a browser.

**Tech Stack:** Playwright 1.60, `@axe-core/playwright` 4.12.1, axe-core 4.12.1, Vitest 4, TypeScript 5.9.

**Spec:** `docs/superpowers/specs/2026-09-02-a11y-responsive-baseline-design.md`

---

## Read this first

**One deviation from the spec, deliberate.** The spec says `tests/e2e/a11y/` "replaces the single spec". It does **not**. `tests/e2e/accessibility.spec.ts` carries keyboard-reachability assertions (`expectReachableByTab`, which checks tab order *and* accessible name) and one interaction state — the result page after magic-link unlock. Axe checks neither, and a matrix over static routes cannot reach the second. Deleting it would trade real coverage for a tidier file layout. It stays, and is excluded from the new viewport projects so it does not multiply.

**Do not change how CI invokes Playwright.** `__tests__/ci/pr-gate-workflow.test.ts:34` asserts the workflow contains the exact string `npm run e2e -- --reporter=html,json,junit`, and `:36-37` assert the e2e job contains `node scripts/ci/classify-playwright.mjs` and does *not* contain `--skipped 0`. No workflow change is needed: `playwright.config.ts:16` has `testMatch: ['tests/e2e/**/*.spec.ts', 'e2e/**/*.spec.ts']`, so a new `tests/e2e/a11y/` directory is picked up automatically.

**Two axe facts that decide whether this works.**

1. `target-size` is `enabled: false` in axe-core 4.12.1 (`node_modules/axe-core/axe.js:33042-33045`, `impact: 'serious'`). Enable it with `.options({ rules: { 'target-size': { enabled: true } } })` — **never** `.withRules(['target-size'])`, which runs *only* that rule and silently disables every other check. That is the same class of bug this slice exists to end.
2. Dark theme is selected with `page.emulateMedia({ colorScheme: 'dark' })`. This works because `app/layout.tsx`'s inline script reads `localStorage.getItem('theme')` and falls back to `prefers-color-scheme` when the key is unset. Nothing needs seeding.

**Routes are constrained by fixture mode.** `lib/auth.ts:7` returns `null` from `getProfile()` when `E2E_FIXTURE_MODE === '1'`, which CI sets. `requireAuth` therefore always redirects, so **every dashboard and admin URL resolves to the login page** under this environment. Authenticated surfaces are unreachable, not merely unscanned. `/[lang]/r/[slug]` needs a live DB and an HMAC and is not visitable. `/auth/complete`, `/auth/google` and `/auth/logout` render but mutate their own DOM on mount, so they are unstable to scan.

**Two sources of flakiness were found during Task 4, and both are fixed in `scan()`.**

1. *Animations race the scan.* `waitUntil: 'networkidle'` waits for the network, not for CSS
   transitions. The onboarding progress bar has a 500ms `transition-all`
   (`components/onboarding/OnboardingWizard.tsx:228`), and axe scanned it mid-flight on roughly
   half of runs, reporting a different node each time. `emulateMedia({ reducedMotion: 'reduce' })`
   settles it — `app/globals.css:241` already forces `transition-duration: 0.01ms` under that
   media query — and it also exercises the reduced-motion state the base plan requires, which
   nothing else in the matrix covered.

2. *Cold compilation serves a page without its layout.* **KNOWN, ACCEPTED, NOT FIXED.** Both
   local runs and CI serve the suite from `next dev` (`scripts/start-playwright-ci-server.cjs:64`;
   the e2e job never builds first), which compiles a route on first request. One local run in six
   produced 32 simultaneous `region` and `landmark-one-main` violations across every `login` and
   `result` cell, on generic nodes like `html` and a bare `h1` — the shape of a layout-less render.

   A `test.beforeAll` warmup was tried and **reverted**. `beforeAll` inherits Playwright's 30s
   default timeout and runs once per worker, so six workers each firing ten cold `networkidle`
   navigations at one dev server timed out five of them and left **36 of 80 tests never running**,
   while doubling wall-clock from 1.3m to 3.1m. It traded a rare failure for a deterministic one.

   It is accepted rather than fixed because the trigger is local parallelism, not CI: `workers:
   isCi ? 1 : undefined` (`playwright.config.ts:19`) serialises CI requests, so the first
   navigation to a route blocks until its compile finishes and no second request races a
   half-built page. If this ever does fire in CI, the cheap next thing to try is warming the
   routes with plain `fetch` in `globalSetup` — once in total, no browser, no per-worker
   duplication — rather than a per-worker hook.

Neither is cosmetic. **An intermittent violation is unrepresentable in this design**: inside the
baseline the stale check fails on runs where it does not fire, outside it the unexpected check
fails on runs where it does. The anti-rot rule is what makes flakiness intolerable rather than
merely annoying, so flakiness has to be removed at the source.

**Codebase conventions to match** (from `tests/e2e/auth.spec.ts` and `tests/e2e/pages/HomePage.ts`): no semicolons, single quotes, 2-space indent, numeric separators (`8_000`). Locale matrices are `as const` arrays iterated with a plain `for` loop, not `test.each`. Relative imports inside `tests/` carry a `.js` extension (`'../constants.js'`); `@/` resolves for lib imports.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `tests/e2e/a11y/matrix.ts` | Create | The matrix as data: routes, locales, themes, viewports |
| `tests/e2e/a11y/baseline.ts` | Create | Pure compare logic + signature derivation. No Playwright import |
| `tests/e2e/a11y/baseline.json` | Create | Accepted violations, checked in |
| `tests/e2e/a11y/scan.spec.ts` | Create | Drives the matrix, runs axe, applies the baseline |
| `__tests__/e2e/a11y-baseline.test.ts` | Create | Unit tests for `baseline.ts`, no browser |
| `playwright.config.ts` | Modify | Four viewport projects scoped to `tests/e2e/a11y/` |

`tests/e2e/accessibility.spec.ts`, `.github/workflows/pr-gate.yml` and `scripts/ci/classify-playwright.mjs` are **not** modified.

---

### Task 1: Baseline comparison logic

Pure functions first, tested without a browser. This is the logic that decides whether the gate passes, so it must be testable in isolation.

**Files:**
- Create: `tests/e2e/a11y/baseline.ts`
- Test: `__tests__/e2e/a11y-baseline.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/e2e/a11y-baseline.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/e2e/a11y-baseline.test.ts`

Expected: the file fails to collect, with an error resolving `../../tests/e2e/a11y/baseline` — the module does not exist yet.

- [ ] **Step 3: Write the module**

Create `tests/e2e/a11y/baseline.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/e2e/a11y-baseline.test.ts`

Expected: **8 passed**. If the number differs, report the real one rather than adjusting to it.

- [ ] **Step 5: Lint and typecheck**

```bash
npm run lint
```
Expected: no output.

```bash
npm run typecheck
```
Expected: `Types generated successfully`, no `error TS` lines.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/a11y/baseline.ts __tests__/e2e/a11y-baseline.test.ts
git commit -m "test(a11y): baseline comparison that fails in both directions"
```

---

### Task 2: The matrix

**Files:**
- Create: `tests/e2e/a11y/matrix.ts`

- [ ] **Step 1: Write the matrix**

Create `tests/e2e/a11y/matrix.ts`:

```ts
import { TEST_SCAN_ID } from '../../constants.js'
import type { A11yTheme } from './baseline'

export type SupportedLang = 'en' | 'zh-HK'

/**
 * Routes that are safe to scan under E2E_FIXTURE_MODE=1.
 *
 * Excluded on purpose:
 *  - every /[lang]/dashboard/** and /admin route: lib/auth.ts:7 returns null
 *    from getProfile() in fixture mode, so requireAuth always redirects to
 *    login. They are unreachable, not merely unscanned.
 *  - /[lang]/r/[slug]: needs a live database row and an HMAC signature.
 *  - /[lang]/auth/{complete,google,logout}: each mutates its own DOM on mount
 *    (session exchange, social redirect, sign-out), so a scan races the page.
 *  - /[lang]/admin/authority and /[lang]/pulse/[clientId]: featureUnavailable
 *    stubs that render a translated heading, one body paragraph and a back
 *    link. They are public and would scan cleanly, but 32 extra matrix cells
 *    for three static elements buys no coverage. Add them if either ever
 *    becomes a real page.
 */
export const A11Y_ROUTES = [
  { id: 'home', path: (lang: SupportedLang) => `/${lang}` },
  { id: 'pricing', path: (lang: SupportedLang) => `/${lang}/pricing` },
  { id: 'login', path: (lang: SupportedLang) => `/${lang}/auth/login` },
  { id: 'onboarding', path: (lang: SupportedLang) => `/${lang}/onboarding` },
  { id: 'result', path: (lang: SupportedLang) => `/${lang}/result/${TEST_SCAN_ID}` },
] as const

export const A11Y_LOCALES = ['en', 'zh-HK'] as const satisfies readonly SupportedLang[]

export const A11Y_THEMES = ['light', 'dark'] as const satisfies readonly A11yTheme[]
```

Viewports are deliberately **not** declared here. A width is a Playwright *project*
concern -- the spec never reads it, the browser just is that wide -- so it lives
in `playwright.config.ts` alone (Task 4). Declaring it in both places would let
the two drift, and importing this module from the config would drag
`lib/e2e-fixtures` into the config load path for no benefit.

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: `Types generated successfully`, no `error TS` lines. This is the only meaningful check here — the file has no behaviour of its own yet.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/a11y/matrix.ts
git commit -m "test(a11y): declare the scan matrix as data"
```

---

### Task 3: The scan spec

**Files:**
- Create: `tests/e2e/a11y/scan.spec.ts`
- Create: `tests/e2e/a11y/baseline.json`

- [ ] **Step 1: Create an empty baseline**

Create `tests/e2e/a11y/baseline.json` with exactly:

```json
{
  "accepted": []
}
```

Task 4 fills it from a real run. Starting empty is deliberate: the first run must show the true violation count rather than one that was quietly pre-accepted.

- [ ] **Step 2: Write the spec**

Create `tests/e2e/a11y/scan.spec.ts`:

```ts
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
```

This spec checks only the `unexpected` direction. Stale entries cannot be judged from one cell — a signature absent here may fire in another — so that check needs a test that sees every cell, added in Task 5.

- [ ] **Step 3: Lint and typecheck**

```bash
npm run lint
```
Expected: no output.

```bash
npm run typecheck
```
Expected: `Types generated successfully`, no `error TS` lines.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/a11y/scan.spec.ts tests/e2e/a11y/baseline.json
git commit -m "test(a11y): matrix scan with target-size enabled and both themes"
```

---

### Task 4: Viewport projects, and the first real measurement

**Files:**
- Modify: `playwright.config.ts:22-25`
- Modify: `tests/e2e/a11y/baseline.json`

- [ ] **Step 1: Add the viewport projects**

In `playwright.config.ts`, replace the `projects` array (lines 22-25) with:

```ts
  projects: [
    // Project-level testIgnore REPLACES the top-level testIgnore rather than
    // merging with it, so each project must re-spread the base `testIgnore`
    // array (worktrees, the CI server dir, and the BASE_URL/fixture gates)
    // alongside its own additions -- omitting it would silently re-enable
    // live-scan-smoke.spec.ts and e2e/client-reports.spec.ts whenever their
    // env gates are unset.
    { name: 'chromium', testIgnore: [...testIgnore, 'tests/e2e/a11y/**'], use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', testIgnore: [...testIgnore, 'e2e/**/*.spec.ts', 'tests/e2e/a11y/**'], use: { ...devices['Pixel 5'] } },
    // The a11y matrix runs at the four widths the base plan's responsive
    // acceptance names, and ONLY there. Without the testIgnore entries above,
    // every a11y test would also run under chromium and mobile -- six passes
    // over each page instead of four.
    ...[375, 768, 1024, 1440].map(width => ({
      name: `a11y-${width}`,
      testMatch: 'tests/e2e/a11y/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width, height: 900 } },
    })),
  ],
```

- [ ] **Step 2: Run the matrix and see the real violation count**

```bash
START_DEV_SERVER=1 E2E_FIXTURE_MODE=1 npx playwright test tests/e2e/a11y --reporter=list
```

Expected: **failures**, and that is the point of this step. The baseline is empty, so every existing violation is reported as unexpected. 5 routes × 2 locales × 2 themes × 4 viewports = **80 tests**.

**Record the actual number of failing tests and of distinct signatures.** This is the first measurement anyone has taken of moderate-impact, dark-theme, or zh-HK accessibility on this codebase, and the number is a result worth reporting on its own.

- [ ] **Step 3: Populate the baseline**

Collect the distinct signatures from the attached `axe-*` artifacts and write them into `tests/e2e/a11y/baseline.json`:

```json
{
  "accepted": [
    "color-contrast | /en | light | button.cta"
  ]
}
```

Sort the array so future diffs stay readable. Do **not** hand-edit signatures — copy them exactly as emitted, or the comparison will never match.

- [ ] **Step 4: Re-run and confirm green**

```bash
START_DEV_SERVER=1 E2E_FIXTURE_MODE=1 npx playwright test tests/e2e/a11y --reporter=list
```

Expected: **80 passed**. If any test still fails, a signature in the baseline does not match the one emitted — compare them character by character rather than loosening the comparison.

- [ ] **Step 5: Confirm the other suites are unaffected**

```bash
START_DEV_SERVER=1 E2E_FIXTURE_MODE=1 npx playwright test --reporter=list
```

Expected: the a11y tests plus every pre-existing E2E test, all passing. Confirm `tests/e2e/accessibility.spec.ts` still runs under `chromium` and `mobile` and is **not** duplicated across the four a11y projects.

- [ ] **Step 6: Commit**

```bash
git add playwright.config.ts tests/e2e/a11y/baseline.json
git commit -m "test(a11y): four viewport projects and the measured baseline"
```

---

### Task 5: The stale check, and proving the gate fires

A guard nobody has watched fail is not known to work.

**Files:**
- Modify: `tests/e2e/a11y/scan.spec.ts`

- [ ] **Step 1: Add the stale check**

Append to `tests/e2e/a11y/scan.spec.ts`:

```ts
/**
 * The anti-rot half of the ratchet, in its own test because it needs every cell.
 *
 * Re-scans the whole matrix and fails on any accepted entry that no longer
 * fires. Without this, fixed violations stay recorded forever and the file
 * becomes a blanket amnesty -- exactly the `critical || serious` filter it
 * replaced, with more ceremony.
 *
 * Running at one viewport is enough: the signature deliberately excludes
 * viewport, so an entry that fires at any width fires here.
 */
test('no accepted violation has been fixed without being removed from the baseline', async ({ page }) => {
  const observed: A11yFinding[] = []

  for (const locale of A11Y_LOCALES) {
    for (const theme of A11Y_THEMES) {
      for (const route of A11Y_ROUTES) {
        observed.push(...await scan(page, route.path(locale), theme))
      }
    }
  }

  const { stale } = compareToBaseline(observed, readBaseline(), { scanned: true })

  expect(
    stale,
    'These baseline entries no longer fire. Delete them from '
    + 'tests/e2e/a11y/baseline.json -- a baseline that only grows is an amnesty.',
  ).toEqual([])
})
```

- [ ] **Step 2: Run it and confirm green**

```bash
START_DEV_SERVER=1 E2E_FIXTURE_MODE=1 npx playwright test tests/e2e/a11y --reporter=list
```

Expected: **84 passed** — 80 matrix tests plus the stale check once per viewport project. The stale test appearing four times is expected and harmless.

- [ ] **Step 3: Prove the gate catches a NEW violation**

Delete the first entry from `tests/e2e/a11y/baseline.json` and re-run:

```bash
START_DEV_SERVER=1 E2E_FIXTURE_MODE=1 npx playwright test tests/e2e/a11y --reporter=list
```

Expected: the matrix test for that route and theme **fails**, naming the signature in its message. Then restore:

```bash
git restore tests/e2e/a11y/baseline.json
```

- [ ] **Step 4: Prove the stale check catches a fixed violation**

Add a signature that cannot possibly fire to the `accepted` array:

```
"region | /en | light | html > body > div.does-not-exist"
```

Re-run. Expected: the **stale** test fails, naming that entry. Then restore:

```bash
git restore tests/e2e/a11y/baseline.json
```

```bash
git diff --stat tests/e2e/a11y/baseline.json
```
Expected: no output.

- [ ] **Step 5: Prove `target-size` is genuinely enabled**

This is the rule that has never run, so confirm it is evaluated rather than merely configured. Change `.options({ rules: { 'target-size': { enabled: true } } })` to `enabled: false` in `scan()`, re-run the matrix with an empty baseline, and compare the number of reported violations against the same run with it enabled.

Expected: the two counts **differ**, or — if every control on every scanned page is large enough — they are identical *and* `target-size` appears in the axe results with zero nodes. If the counts are identical and the rule appears nowhere in the output, the enabling is not working; investigate before proceeding rather than accepting a rule that silently does nothing.

Restore the file afterwards:

```bash
git restore tests/e2e/a11y/scan.spec.ts
```

- [ ] **Step 6: Full gate**

```bash
npm run lint
```
Expected: no output.

```bash
npm run typecheck
```
Expected: `Types generated successfully`.

```bash
npm test
```
Expected: green, including the new `__tests__/e2e/a11y-baseline.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/a11y/scan.spec.ts
git commit -m "test(a11y): fail when an accepted violation stops firing"
```

---

### Task 6: Confirm CI is unchanged and still pinned

**Files:** none changed. This task produces evidence.

- [ ] **Step 1: Confirm the workflow was not touched**

```bash
git diff --stat main -- .github/workflows/pr-gate.yml scripts/ci/classify-playwright.mjs
```

Expected: no output. The new specs are picked up by `testMatch`; no workflow change is required or wanted.

- [ ] **Step 2: Confirm the CI contract tests still pass**

```bash
npx vitest run __tests__/ci/pr-gate-workflow.test.ts
```

Expected: all passing. These assert the exact `npm run e2e -- --reporter=html,json,junit` string and that the e2e job does not contain `--skipped 0`. If they fail, the workflow was modified when it should not have been.

- [ ] **Step 3: Confirm the existing a11y spec is untouched**

```bash
git diff --stat main -- tests/e2e/accessibility.spec.ts
```

Expected: no output. Its keyboard-reachability and post-unlock interaction coverage is not replaced by anything in this plan.

- [ ] **Step 4: Report**

No code change. Report:
- how many tests the matrix adds and the wall-clock the a11y projects take
- the **total accepted entries in the baseline, broken down by rule and by impact** — the first measurement of accessibility debt on this codebase, and the headline result of this slice
- confirmation that all three deliberate failures in Task 5 were observed

---

## Final verification

- [ ] `npm run lint` gives 0 errors, 0 warnings
- [ ] `npm run typecheck` is clean
- [ ] `npm test` is green
- [ ] `START_DEV_SERVER=1 E2E_FIXTURE_MODE=1 npx playwright test` — every E2E test passes, a11y included
- [ ] `git diff --stat main -- .github/workflows/pr-gate.yml` gives **no output**
- [ ] `git diff --stat main -- tests/e2e/accessibility.spec.ts` gives **no output**
- [ ] All three deliberate failures were watched: a removed baseline entry fails the matrix, an impossible entry fails the stale check, and toggling `target-size` changes the reported violation count

## What this does NOT do

- **It does not fix a single accessibility violation.** It makes them visible and stops new ones. The burn-down is separate work, and folding it in would make this slice unbounded.
- Authenticated surfaces stay unscanned — `lib/auth.ts:7` makes them unreachable under `E2E_FIXTURE_MODE=1`, so covering them means changing fixture-mode auth, which is its own change.
- Slices 2.1 (design tokens) and 2.2 (primitives audit) are untouched. 2.1 needs the donor repo.
