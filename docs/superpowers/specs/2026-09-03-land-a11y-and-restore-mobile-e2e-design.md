# Land slice 2.5 and restore mobile E2E coverage — design

**Status:** Approved 2026-09-03
**Phase:** 2, slice 2.5 (completion). Sub-project B1.
**Scope:** Test harness, CI configuration and one branch/PR hygiene change. No application code, no
design tokens, no donor dependency.

## Why this is next

Four directions were open. Three are gated on something no amount of engineering unblocks:
`aeo_app` has no password on the greenfield project (`rolcanlogin = false`, verified read-only), the
donor repo `aisogpt@52cbcb4` is not present anywhere on this machine (searched by directory name,
git remote and submodule — all negative), and slice 2.10 waits on legal sign-off. This one is
blocked on nothing.

It is also the direction with work already finished and at risk. Slice 2.5 is **20 commits that no
remote contains**. `git ls-tree -r origin/main -- tests/e2e/a11y` returns nothing, and no CI run
exists for any of the 20 — the newest green run is against `9c28af1`, the already-merged tip.
Anyone reading the remote would conclude the slice had never been started.

## What measurement established

The `mobile` Playwright project has been running **zero tests**, silently, while appearing
configured. Measured, not inferred:

| | tracked config | with the fix |
|---|---|---|
| `npx playwright test --project=mobile --list` | `Total: 0 tests in 0 files` | 29 tests in 5 files |
| same for `--project=chromium` | 29 tests in 5 files | unchanged |
| Pixel 5 run, `E2E_FIXTURE_MODE=1` | not runnable | **24 passed, 1 failed, 4 skipped** |
| that 1 failure under `chromium` | — | **also fails** (pre-existing) |
| **new failures introduced** | — | **zero** |

Every failure encountered was a local environment gap, each reproduced on the **unmodified** tracked
config under `chromium`: `.env.local`'s `DATABASE_URL` fails password authentication,
`E2E_FIXTURE_MODE` was unset (so `tests/globalSetup.ts` warns and provides no fixture, and
`/result/<id>` returns 404), and `REPORT_SHARE_SECRET must contain at least 32 random characters`.
CI supplies all three as fixtures (`.github/workflows/pr-gate.yml:164-174`). None of it is a Pixel 5
defect.

Consequence: the "fix the glob, then fix every failure" option is a no-op, and the "quarantine
failures" option has nothing to quarantine. The honest change is one line.

### Root cause

Playwright matches `testIgnore` globs against the **absolute** file path. The entry
`'e2e/**/*.spec.ts'` at `playwright.config.ts:30` was meant to exclude only the repository-root
`e2e/` directory; it also matches the tail of `…/tests/e2e/scan-flow.spec.ts`, so it excluded
everything. The config's existing comment block warns that project-level `testIgnore` *replaces*
rather than merges the top-level array — correct, and not the failure that occurred here.

The fix is `testMatch: 'tests/e2e/**/*.spec.ts'`, which mirrors what the four a11y viewport projects
already do (`playwright.config.ts:37`) and cannot exclude by accident, because it is an allow-list.

## Components

### 1. Fresh branch

Work moves to `claude/plan-2.5-a11y-baseline`, cut at the current HEAD. No cherry-picking: all 20
unpushed commits are the a11y slice. The existing branch `claude/plan-1.3-greenfield-baseline` has
already been merged twice (PRs #2 and #3) under a name describing neither this work nor its own
second use; reusing it a third time is why it reports "2 commits behind" while being
content-complete (`git diff 9c28af1 origin/main` is empty).

### 2. `playwright.config.ts` — the one-line fix

Replace the mobile project's unanchored ignore with an allow-list, and record *why* in a comment so
it is not "simplified" back into a `testIgnore`.

### 3. Untrack `playwright-results.json`

The file is listed in `.gitignore:50` but was committed before that rule existed, so the rule never
applied. Every local `npm run e2e` therefore dirties a tracked file (observed: a 2110-line diff).
`git rm --cached` fixes it; the file must still be *generated*, because
`.github/workflows/pr-gate.yml:158` feeds it to `scripts/ci/classify-playwright.mjs`.

### 4. A regression test

Assert that the `mobile` project discovers more than zero tests. This is the part that matters most:
the bug survived because nothing ever checked, and "configured but running nothing" is invisible by
construction — a green job proved nothing about it. The test must key on *discovery count*, not on
config text, so that any future change producing the same silent outcome fails.

### 5. CLAUDE.md note

Record that mobile E2E coverage did not exist before this change, so the historical config is not
read as evidence that it did.

## Error handling and risk

- **CI blocks on any skip.** `scripts/ci/classify-playwright.mjs` computes
  `blocking = invalidReport || exitCode !== 0 || skipped > 0`. The 4 local skips are env-gated —
  `auth.spec.ts:131` on `NEON_AUTH_BASE_URL`, `email-gate.spec.ts:14` on the Supabase trio — and CI
  sets all of them, which is why `chromium` skips zero there today. The fixed `mobile` project runs
  the identical 29 tests, so it should also skip zero. **This is the main thing to watch on the
  first CI run.**
- **Job runtime roughly triples.** The `e2e-accessibility` job currently runs 29 tests. Afterwards it
  runs 29 chromium + 29 mobile + the four a11y viewport projects over 80 cells, at `workers: 1`.
  Expect several extra minutes. Accepted, not mitigated.
- **The a11y baseline is a standing maintenance obligation.** `compareCounts()` fails in *both*
  directions, so any UI change that fixes a violation also fails the gate until `baseline.json` is
  lowered. Deliberate and documented; restated here because it now applies on every PR.

## Testing

- The discovery-count regression test above.
- A full local run with `E2E_FIXTURE_MODE=1` and a valid `REPORT_SHARE_SECRET` before pushing, to
  confirm green locally rather than discovering it in CI.
- CI itself is the real gate: these 20 commits have never been through it.

## Out of scope

- The pre-existing fixture-result-page failure. It passes in CI and fails locally only for want of
  `REPORT_SHARE_SECRET`.
- Repairing `.env.local` (dead `DATABASE_URL`). It needs a decision about whether local dev targets
  the greenfield project or production, which is its own change.
- Every blocker-list item: donor repo, `aeo_app` password, Vercel bindings, Cloudflare cron worker
  deploy, legal sign-off.
- Fixing any of the 608 accessibility violations the baseline records. Slice 2.5 makes them visible
  and stops new ones; the burn-down is separate work.
