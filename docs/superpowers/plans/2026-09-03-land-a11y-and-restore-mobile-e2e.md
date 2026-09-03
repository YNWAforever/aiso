# Land slice 2.5 and restore mobile E2E coverage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get the finished accessibility baseline onto `origin/main` through CI, and restore the mobile E2E coverage that has silently never run.

**Architecture:** Four small changes on top of 20 already-written commits. A regression guard is written first and watched failing, then the one-line config fix makes it pass. Nothing touches application code.

**Tech Stack:** Playwright 1.60, Vitest 4, TypeScript 5.9, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-03-land-a11y-and-restore-mobile-e2e-design.md`

**Branch:** `claude/plan-2.5-a11y-baseline` — already cut, already carries the 20 a11y commits plus the spec.

---

## Background the implementer needs

`playwright.config.ts` declares six projects. Measured on the current tracked config:

| project | discovers |
|---|---|
| `chromium` | 29 tests |
| `mobile` | **0 tests** |
| `a11y-375` / `-768` / `-1024` / `-1440` | 20 each |

`mobile` has discovered nothing for its entire existence. Playwright matches `testIgnore` globs
against the **absolute** file path, so the entry `'e2e/**/*.spec.ts'` — intended to exclude only the
repository-root `e2e/` directory — also matched the tail of `…/tests/e2e/scan-flow.spec.ts` and
therefore excluded every spec.

Running the 29 specs at Pixel 5 with `E2E_FIXTURE_MODE=1` gives **24 passed, 1 failed, 4 skipped**,
and the single failure reproduces under `chromium` on the unmodified config. **The fix introduces no
new failures.**

Two environment facts, or you will chase ghosts:

- `tests/globalSetup.ts` provides the result-page fixture only when `E2E_FIXTURE_MODE=1`. Without it
  the fixture is absent and `/result/<id>` returns **404**, which surfaces as three
  unrelated-looking assertion failures.
- `REPORT_SHARE_SECRET` must be at least 32 characters or the result page throws server-side.

CI sets both (`.github/workflows/pr-gate.yml:164,174`). Your local `.env.local` does not, and its
`DATABASE_URL` currently fails password authentication. **Do not try to repair `.env.local`** — it is
out of scope. Pass the variables on the command line as shown in Task 4.

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `__tests__/config/playwright-projects.test.ts` | Assert every configured Playwright project discovers at least one test | Create |
| `playwright.config.ts` | Project definitions; line 30 is wrong | Modify |
| `playwright-results.json` | Generated Playwright artifact, wrongly tracked | Untrack, keep on disk |
| `CLAUDE.md` | Record that mobile E2E never ran before now | Modify |
| `docs/superpowers/plans/pr-body-2026-09-03.md` | PR description | Create |

---

### Task 1: Guard that every Playwright project discovers tests

**Files:**
- Create: `__tests__/config/playwright-projects.test.ts`
- Modify: `playwright.config.ts:30`

- [ ] **Step 1: Write the failing test**

Create `__tests__/config/playwright-projects.test.ts`:

```ts
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

type PlaywrightTest = { projectName?: string }
type PlaywrightSpec = { tests?: PlaywrightTest[] }
type PlaywrightSuite = { specs?: PlaywrightSpec[]; suites?: PlaywrightSuite[] }
type PlaywrightListReport = {
  config?: { projects?: { name: string }[] }
  suites?: PlaywrightSuite[]
}

const PLAYWRIGHT_CLI = join(process.cwd(), 'node_modules', '@playwright', 'test', 'cli.js')

/**
 * Ask Playwright itself which tests each project resolves to.
 *
 * Deliberately NOT a string assertion over playwright.config.ts. The `mobile`
 * project discovered zero tests for its entire existence while the config said
 * exactly what its author intended -- the surprise was that `testIgnore` globs
 * are matched against the ABSOLUTE path, so a root-relative-looking pattern
 * also matched the tail of '.../tests/e2e/scan-flow.spec.ts'. No amount of
 * reading the config text reveals that; only Playwright's own resolution does.
 *
 * Invoked through `process.execPath` and the CLI's real path rather than `npx`,
 * which is a `.cmd` shim on Windows and would need a shell.
 *
 * `--list` exits 1 when a project resolves to nothing but still writes a valid
 * JSON report to stdout, so a non-zero exit is caught and the stdout parsed
 * rather than treated as a crash.
 */
function listAllProjects(): PlaywrightListReport {
  let stdout: string
  try {
    stdout = execFileSync(
      process.execPath,
      [PLAYWRIGHT_CLI, 'test', '--list', '--reporter=json'],
      {
        encoding: 'utf8',
        cwd: process.cwd(),
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    )
  } catch (error) {
    stdout = (error as { stdout?: string }).stdout ?? ''
  }
  if (!stdout.trim()) {
    throw new Error('playwright --list produced no output; project discovery cannot be verified')
  }
  return JSON.parse(stdout) as PlaywrightListReport
}

function countByProject(report: PlaywrightListReport): Record<string, number> {
  const counts: Record<string, number> = {}
  const walk = (suite: PlaywrightSuite): void => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        if (!test.projectName) continue
        counts[test.projectName] = (counts[test.projectName] ?? 0) + 1
      }
    }
    for (const child of suite.suites ?? []) walk(child)
  }
  for (const suite of report.suites ?? []) walk(suite)
  return counts
}

describe('playwright project discovery', () => {
  // A configured-but-empty project is invisible: the suite goes green because
  // it ran nothing. `mobile` was in that state from the day it was added.
  it('every configured project discovers at least one test', () => {
    const report = listAllProjects()
    const configured = (report.config?.projects ?? []).map(project => project.name)
    expect(configured.length).toBeGreaterThan(0)

    const counts = countByProject(report)
    const empty = configured.filter(name => (counts[name] ?? 0) === 0)

    // Asserting "none are empty", never an exact count: pinning the number
    // would fail on every legitimately added spec, which is how a guard gets
    // deleted rather than fixed.
    expect(empty).toEqual([])
  }, 60_000)
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run __tests__/config/playwright-projects.test.ts`

Expected: FAIL, naming the empty project:

```
AssertionError: expected [ 'mobile' ] to deeply equal []
```

If it passes at this step, stop and report — the premise is wrong and something else has changed.

- [ ] **Step 3: Fix the project definition**

In `playwright.config.ts`, replace line 30 exactly. Old:

```ts
    { name: 'mobile', testIgnore: [...testIgnore, 'e2e/**/*.spec.ts', 'tests/e2e/a11y/**'], use: { ...devices['Pixel 5'] } },
```

New:

```ts
    // `testIgnore` globs are matched against the ABSOLUTE path, so the previous
    // entry for the repository-root e2e/ directory also matched the tail of
    // '.../tests/e2e/scan-flow.spec.ts' and excluded everything. This project
    // discovered ZERO tests from the day it was added. An allow-list cannot
    // fail that way, and matches how the a11y projects below are written.
    { name: 'mobile', testMatch: 'tests/e2e/**/*.spec.ts', testIgnore: [...testIgnore, 'tests/e2e/a11y/**'], use: { ...devices['Pixel 5'] } },
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run __tests__/config/playwright-projects.test.ts`

Expected: PASS, 1 test.

- [ ] **Step 5: Confirm no other project changed**

Run: `npx playwright test --list --project=mobile 2>&1 | tail -1`

Expected: `Total: 29 tests in 5 files`

Run: `npx playwright test --list --project=chromium 2>&1 | tail -1`

Expected: `Total: 29 tests in 5 files` — unchanged. If chromium's count moved, the edit hit the wrong line; revert and redo Step 3.

- [ ] **Step 6: Commit**

```bash
git add __tests__/config/playwright-projects.test.ts playwright.config.ts && git commit -F- <<'EOF'
fix(e2e): the mobile Playwright project discovered zero tests

testIgnore globs are matched against the absolute path, so the entry meant to
exclude only the root e2e/ directory also matched the tail of
tests/e2e/scan-flow.spec.ts and excluded every spec. The project has run
nothing since it was added, while appearing configured.

Replaced with an allow-list testMatch, matching how the a11y projects are
already written. Guarded by a test that asks Playwright which tests each
project resolves to, because a string assertion over the config would have
passed throughout the entire period the bug existed.

Measured: 0 tests discovered before, 29 after; a Pixel 5 run gives 24 passed,
1 failed, 4 skipped, and that one failure reproduces under chromium on the
unmodified config.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Untrack the generated Playwright report

**Files:**
- Modify (untrack only): `playwright-results.json`

`playwright-results.json` is listed in `.gitignore:50` but was committed before that rule existed,
and gitignore does not apply to already-tracked files — so every local `npm run e2e` dirties a
tracked file. CI is unaffected: it sets
`PLAYWRIGHT_JSON_OUTPUT_NAME=artifacts/e2e-accessibility/playwright-results.json`
(`.github/workflows/pr-gate.yml:175`), which redirects the reporter away from the repository root, so
the tracked copy is not what the gate reads.

- [ ] **Step 1: Confirm the ignored-but-tracked state**

Run: `git check-ignore -v playwright-results.json`

Expected: `.gitignore:50:playwright-results.json	playwright-results.json`

Run: `git ls-files --error-unmatch playwright-results.json`

Expected: `playwright-results.json` — ignored *and* tracked, which is the bug.

- [ ] **Step 2: Untrack it, keeping the file on disk**

```bash
git rm --cached playwright-results.json
```

Expected: `rm 'playwright-results.json'`

- [ ] **Step 3: Confirm the file survived and git now ignores it**

Run: `ls playwright-results.json && git status --porcelain`

Expected: the filename, then exactly one status line — `D  playwright-results.json` (the staged
deletion). It must NOT reappear as untracked (`??`); if it does, `.gitignore` is not matching and
Step 1's evidence was misread.

- [ ] **Step 4: Commit**

```bash
git commit -F- <<'EOF'
chore(e2e): untrack the generated playwright-results.json

The file has been in .gitignore since line 50, but it was committed before
that rule existed and gitignore does not apply to already-tracked files, so
every local e2e run produced a spurious diff on a tracked artifact.

CI is unaffected: it sets PLAYWRIGHT_JSON_OUTPUT_NAME to a path under
artifacts/, so the repository-root copy is not what the gate reads.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Record the coverage gap in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`, the `## Testing` section

Without this note, the historical config reads as evidence that mobile coverage existed.

- [ ] **Step 1: Add the note**

In `CLAUDE.md`, find this exact line in the `## Testing` section:

```markdown
- E2E: Playwright in `tests/e2e/` with page objects; `npm run e2e`
```

Replace it with:

```markdown
- E2E: Playwright in `tests/e2e/` with page objects; `npm run e2e`
- **The `mobile` (Pixel 5) project discovered ZERO tests from the day it was added until
  2026-09-03**, so there has never been mobile E2E coverage before that date — do not read the
  older config as evidence otherwise. Its `testIgnore` entry for the repository-root `e2e/`
  directory also matched the tail of `tests/e2e/scan-flow.spec.ts`, because Playwright matches
  those globs against the **absolute** path. It now uses an allow-list `testMatch`.
  `__tests__/config/playwright-projects.test.ts` asks Playwright how many tests each configured
  project resolves to and fails if any resolves to none — a configured-but-empty project is
  otherwise invisible, because the suite goes green having run nothing.
```

- [ ] **Step 2: Verify nothing else in the section was disturbed**

Run: `git diff --stat CLAUDE.md`

Expected: `1 file changed, 9 insertions(+), 1 deletion(-)`, give or take one line.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md && git commit -F- <<'EOF'
docs: record that mobile E2E coverage never ran before 2026-09-03

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Full local verification before pushing

Nothing here changes code. The point is to reach CI already knowing the answer, because these 20
commits have never been through it.

- [ ] **Step 1: Static gates**

Run: `npm run lint`

Expected: exit 0, no diagnostic lines.

Run: `npm run typecheck`

Expected: exit 0, `Types generated successfully` then no `error TS` lines.

- [ ] **Step 2: Unit suite**

Run: `npm run test:unit`

Expected: exit 0. The new `playwright-projects` test adds roughly 2 seconds.

- [ ] **Step 3: Full E2E, with the environment CI actually uses**

```bash
E2E_FIXTURE_MODE=1 START_DEV_SERVER=1 REPORT_SHARE_SECRET=fixture-report-share-secret-for-local-only-0001 npx playwright test --reporter=list
```

Expected: all six projects run — `chromium` 29, `mobile` 29, and 20 each for the four `a11y-*`
projects. Some tests may still fail locally for want of `NEON_AUTH_BASE_URL` and the Supabase
fixture variables that CI supplies. Record the exact counts.

**Interpretation rule — do not skip this.** For every failure, re-run that spec under `chromium`
before concluding the mobile change caused it:

```bash
E2E_FIXTURE_MODE=1 START_DEV_SERVER=1 REPORT_SHARE_SECRET=fixture-report-share-secret-for-local-only-0001 npx playwright test --project=chromium <spec-path> --reporter=list
```

If it fails under `chromium` too, it is pre-existing and out of scope. This is exactly how the
"three mobile failures" in the design turned out to be a single environment gap.

- [ ] **Step 4: Report, do not fix**

Write down pass/fail/skip counts per project, and which failures reproduce under `chromium`. Fixing
pre-existing failures is out of scope for this plan.

---

### Task 5: Push and open the pull request

- [ ] **Step 1: Write the PR body**

Create `docs/superpowers/plans/pr-body-2026-09-03.md`. It must contain:

- The measured before/after discovery table from the Background section above.
- The statement that the mobile fix introduces zero new failures, with the `chromium` reproduction
  as the evidence.
- That the a11y baseline records 80 cells and 608 violating nodes, and that `compareCounts()` fails
  in **both** directions — so any accessibility fix must also lower `baseline.json` or the gate goes
  red on an improvement.
- The warning that the `e2e-accessibility` job roughly triples in duration: from 29 tests to 29
  chromium + 29 mobile + 80 a11y cells, at `workers: 1`.
- The counts recorded in Task 4 Step 4.

End the file with exactly:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 2: Confirm what is about to be pushed**

Run: `git log --oneline origin/main..HEAD | wc -l`

Expected: 26 — the 20 a11y commits, 2 spec commits, 1 plan commit, and the 3 from Tasks 1–3.

Run: `git status --porcelain`

Expected: empty.

- [ ] **Step 3: Push the branch**

```bash
git push -u origin claude/plan-2.5-a11y-baseline
```

- [ ] **Step 4: Open the PR**

```bash
gh pr create --base main --head claude/plan-2.5-a11y-baseline --title "feat(e2e): accessibility baseline, and restore mobile E2E coverage" --body-file docs/superpowers/plans/pr-body-2026-09-03.md
```

- [ ] **Step 5: Wait for CI, and check it ran against the right commit**

```bash
gh run list --limit 5 --json headSha,conclusion,status,workflowName
```

**A green run whose `headSha` is not this branch's HEAD is not evidence.** Compare against
`git rev-parse HEAD` before reporting anything. This exact mistake was made earlier in the project:
a green run against an already-merged tip was nearly reported as validation for unpushed work.

- [ ] **Step 6: Watch the skip count specifically**

CI computes `blocking = invalidReport || exitCode !== 0 || skipped > 0` in
`scripts/ci/classify-playwright.mjs`, so **any** skip fails the gate. The 4 skips seen locally are
env-gated — `tests/e2e/auth.spec.ts:131` on `NEON_AUTH_BASE_URL`, `tests/e2e/email-gate.spec.ts:14`
on the Supabase fixture trio — and CI sets all of them, which is why `chromium` skips zero there
today. `mobile` now runs the identical 29 tests, so it should also skip zero. If the gate fails on
`skipped > 0`, this is the first thing to investigate.
