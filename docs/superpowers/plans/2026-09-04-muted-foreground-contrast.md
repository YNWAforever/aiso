# `--muted-foreground` contrast fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `--muted-foreground` clear WCAG AA in both themes, and give the a11y baseline a way to be regenerated.

**Architecture:** Four hex values change. Because the baseline guard fails in both directions, a genuine improvement fails the gate — so an explicit opt-in update mode is added to the a11y spec, which the harness has never had.

**Tech Stack:** Tailwind CSS v4, Playwright 1.60, axe-core 4.12.

**Spec:** `docs/superpowers/specs/2026-09-04-muted-foreground-contrast-design.md`

**Branch:** `claude/plan-2.3-dark-mode-surfaces` — PR #10's branch. This slice folds into it; do not open a new PR.

---

## Background the implementer needs

`#5c5c6e` serves as **both** `--muted-foreground` and `--dash-muted` in dark mode, and fails WCAG AA
against all three dark surfaces (2.79 / 2.95 / 3.10 against `--muted` / `--card` / `--background`).
`#64748b` serves as both in light mode and has one marginal failure (4.34 against `--muted`).

Eleven of thirteen token pairs already pass comfortably — `--foreground` at 14–15:1,
`--primary-foreground / --primary` at 11.45:1. **Do not touch anything else.**

The four declarations, by line number as of `360bad9`:

| line | block | token | current |
|---|---|---|---|
| 22 | `:root` | `--muted-foreground` | `#64748b` |
| 61 | `:root` | `--dash-muted` | `#64748b` |
| 132 | `.dark` | `--muted-foreground` | `#5c5c6e` |
| 164 | `.dark` | `--dash-muted` | `#5c5c6e` |

**Anchor on the value and the enclosing block, not the line number** — this file has been edited
twice in recent slices.

Current baseline: **80 cells, 607 violating nodes** — `color-contrast` 367, `region` 160,
`page-has-heading-one` 48, `landmark-one-main` 32. (The spec says 608; 607 is the actual figure.)
The `color-contrast` count is the one this slice should move.

**Out of scope, and do not "also fix":** the "MOST POPULAR" badge (`text-white` on `#00d4ff`,
1.77:1 — real, pre-existing, already accepted, needs a different fix), `text-white` elsewhere,
`components/`'s 64 hardcoded colours, `app/admin/`'s palette, and every other token.

**`git add -A` is forbidden. Name every file explicitly in every commit.**

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `app/globals.css` | The four token values | Modify |
| `tests/e2e/a11y/scan.spec.ts` | Opt-in baseline update mode | Modify |
| `scripts/a11y/rebuild-baseline.mjs` | Merge observed cells into a baseline | Create |
| `.gitignore` | Ignore the intermediate directory | Modify |
| `tests/e2e/a11y/baseline.json` | Regenerated counts | Modify |

---

### Task 1: Change the four values

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Replace all four, with per-site assertions**

```bash
python - <<'PY'
import re
p = 'app/globals.css'
lines = open(p, encoding='utf-8').read().split("\n")
dark = next(i for i, l in enumerate(lines) if l.startswith('.dark {'))
n = 0
for i, l in enumerate(lines):
    m = re.match(r'(\s*--(?:muted-foreground|dash-muted):\s*)(#[0-9a-fA-F]{6})(\s*;.*)$', l)
    if not m:
        continue
    want, new = ('#5c5c6e', '#88889a') if i > dark else ('#64748b', '#5e6e85')
    assert m.group(2).lower() == want, 'line %d: expected %s, found %s' % (i + 1, want, m.group(2))
    lines[i] = m.group(1) + new + m.group(3)
    n += 1
assert n == 4, 'expected 4 declarations, changed %d' % n
open(p, 'w', encoding='utf-8', newline='\n').write("\n".join(lines))
print('changed %d declarations' % n)
PY
```

Expected output: `changed 4 declarations`

Each site asserts its *current* value before writing, so a file in an unexpected state fails loudly
rather than being silently mangled. The `.dark {` line index is what separates light from dark.

- [ ] **Step 2: Recompute every pair — arithmetic on the file, so it is exact**

```bash
python - <<'PY'
import re
lines = open('app/globals.css', encoding='utf-8').read().split("\n")
root  = next(i for i, l in enumerate(lines) if l.startswith(':root {'))
dark  = next(i for i, l in enumerate(lines) if l.startswith('.dark {'))
theme = next(i for i, l in enumerate(lines) if l.startswith('@theme inline'))

def toks(lo, hi):
    d = {}
    for l in lines[lo:hi]:
        m = re.match(r'\s*--([A-Za-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;', l)
        if m and m.group(1) not in d:
            d[m.group(1)] = m.group(2)
    return d

def lum(h):
    h = h.lstrip('#'); o = []
    for i in (0, 2, 4):
        v = int(h[i:i+2], 16) / 255
        o.append(v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4)
    return 0.2126 * o[0] + 0.7152 * o[1] + 0.0722 * o[2]

def ratio(a, b):
    l1, l2 = lum(a), lum(b)
    return (max(l1, l2) + 0.05) / (min(l1, l2) + 0.05)

PAIRS = [('muted-foreground', 'muted'), ('muted-foreground', 'card'),
         ('muted-foreground', 'background'),
         ('dash-muted', 'dash-surface'), ('dash-muted', 'dash-bg')]
bad = 0
for label, t in (('LIGHT', toks(root, dark)), ('DARK', toks(dark, theme))):
    for fg, bg in PAIRS:
        if fg in t and bg in t:
            v = ratio(t[fg], t[bg]); ok = v >= 4.5
            if not ok: bad += 1
            print('%-6s %-34s %5.2f  %s' % (label, fg + ' / ' + bg, v, 'PASS' if ok else 'FAIL'))
print('\nfailing pairs: %d  (must be 0)' % bad)
PY
```

Expected: every row `PASS`, and `failing pairs: 0`.

If any row fails, **report it** — do not nudge the hex until it passes. The spec's values were
computed with headroom for exactly this reason.

- [ ] **Step 3: Static checks**

Run each and record the exit code:

```bash
npm run lint
```
```bash
npm run typecheck
```
```bash
npm run test:unit
```
```bash
npm run build
```

Expected: all four exit 0. `test:unit` should report the same file/test counts as before — this
change touches no TypeScript.

- [ ] **Step 4: Verify on the live page, by computed style**

A screenshot is not evidence here — the question is a numeric ratio, and an image needs interpreting.

Start the preview (`.claude/launch.json`'s `dev` entry has `autoPort`, so it will take an assigned
port if 3000 is held), load `/en/pricing`, emulate `prefers-color-scheme: dark`, and read the
**computed** colours of the muted text that was failing:

- find elements carrying `text-muted-foreground`
- read `getComputedStyle(el).color` and the effective background behind them
- compute the ratio with the same relative-luminance formula as Step 2

Expected: the previously-failing text now measures **above 4.5:1** — around 5.2 against `--card`.

Then repeat in light mode and confirm it also exceeds 4.5:1 (around 4.8 against `--muted`).

Report the measured `rgb()` values and ratios, not "looks fine". If the measured ratio disagrees
with Step 2's arithmetic, the token is being overridden somewhere and that is the finding — report
it rather than proceeding.

- [ ] **Step 5: Commit**

```bash
git add app/globals.css && git commit -F- <<'EOF'
fix(a11y): make --muted-foreground clear WCAG AA in both themes

#5c5c6e served as both --muted-foreground and --dash-muted in dark mode and
failed AA against all three dark surfaces: 2.79 vs --muted, 2.95 vs --card,
3.10 vs --background. #64748b did the same in light mode, with one marginal
failure at 4.34 vs --muted.

Dark becomes #88889a (5.23-5.83), light becomes #5e6e85 (4.74-5.19). Both
computed rather than picked: the bare minimums (#7e7e90 at 4.57, #607087 at
4.60) clear the threshold by under 0.1, too thin given axe rounds and any
future surface tweak would break it. Muted text stays clearly secondary --
5.55:1 against --foreground's 14.75:1.

Eleven of the thirteen token pairs already passed and are untouched.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Give the baseline an update mode

**Files:**
- Modify: `tests/e2e/a11y/scan.spec.ts`
- Create: `scripts/a11y/rebuild-baseline.mjs`
- Modify: `.gitignore`

**Why this task exists.** The harness has never had an update mode: `scan.spec.ts` reads
`baseline.json` and compares, and never writes. So a genuine improvement fails the gate with no way
to record the new numbers except hand-editing 80 cells of JSON out of error messages — which is how
a burn-down gets abandoned. The spec assumed regeneration was possible; it is not, yet.

- [ ] **Step 1: Read the existing spec first**

Read `tests/e2e/a11y/scan.spec.ts` and `tests/e2e/a11y/baseline.ts` in full before editing. Note
how `cellId(route, theme, viewport)` composes its key and how the spec currently reaches
`compareCounts`. The update path must reuse `cellId` — a second, parallel way of naming cells would
drift from the comparison path.

- [ ] **Step 2: Add the opt-in write path**

When `process.env.A11Y_UPDATE_BASELINE === '1'`, each cell writes its observed `RuleCounts` to
`tests/e2e/a11y/.observed/<cellId with non-alphanumerics replaced by _>.json` and **returns before
asserting**, so the run passes.

Every one of these is load-bearing:

- **One file per cell.** The four viewport projects run in parallel; a single shared file would race
  and silently lose cells.
- **Never the default.** With the variable unset, behaviour must be byte-for-byte unchanged. An
  update mode that can fire accidentally is a mechanism for silencing regressions.
- **Reuse `cellId`.** Do not build the key a second way.
- Print one line per cell (`console.log`) so the run is auditable in CI output.
- Create the directory with `mkdirSync(..., { recursive: true })` — parallel workers will race to
  create it, and `recursive: true` makes that a no-op rather than an error.

Add to `.gitignore`:

```
tests/e2e/a11y/.observed/
```

- [ ] **Step 3: Add the merge script**

Create `scripts/a11y/rebuild-baseline.mjs`. It must:

1. Read every `*.json` in `tests/e2e/a11y/.observed/`.
2. **Assert it found exactly 80 cells.** Fewer means a project did not run; it must `process.exit(1)`
   with the count rather than write a partial baseline. A partial baseline is worse than none — the
   missing cells would be recorded as having no accepted violations, so the gate would then "accept"
   them as clean.
3. Write `tests/e2e/a11y/baseline.json` with the same shape (`{ accepted: { … } }`), cells sorted by
   id and rules sorted within each cell, and the **same indentation the current file uses** — check
   it before writing, so the diff shows only real count changes rather than a reformat.
4. Print the total violating-node count before exiting.

- [ ] **Step 4: Prove the default path is unchanged**

This is the step that makes the update mode safe to have. Run the a11y suite **without** the env var
while `baseline.json` is still the old one and Task 1's change is in place. Expected: it **fails**,
in the improvement direction ("Accessibility improved").

Then:

```bash
git diff --stat tests/e2e/a11y/baseline.json
```

Expected: **empty**. A run without the variable must not have written anything.

- [ ] **Step 5: Static checks**

```bash
npm run lint
```
```bash
npm run typecheck
```

Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/a11y/scan.spec.ts scripts/a11y/rebuild-baseline.mjs .gitignore && git commit -F- <<'EOF'
test(a11y): add an opt-in baseline update mode

The baseline guard fails in both directions by design, so a genuine
accessibility improvement fails the gate. The harness had no way to record the
new numbers, which meant every burn-down needed 80 cells hand-edited out of
error messages -- a reliable way to get a ratchet abandoned.

A11Y_UPDATE_BASELINE=1 writes each cell's observed counts and skips the
assertion. One file per cell, because the four viewport projects run in
parallel and a shared file would race. The merge script refuses to write
unless all 80 cells are present: a partial run would otherwise produce a
baseline that accepts the missing cells as clean.

Never the default -- with the variable unset, behaviour is unchanged, verified
by running the suite without it and confirming baseline.json stayed untouched.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Regenerate the baseline, and report the direction

**Files:**
- Modify: `tests/e2e/a11y/baseline.json`

- [ ] **Step 1: Record the before totals**

```bash
node -e '
const b = require("./tests/e2e/a11y/baseline.json").accepted;
let t = 0, c = 0; const byRule = {};
for (const k in b) { c++; for (const r in b[k]) { t += b[k][r]; byRule[r] = (byRule[r]||0) + b[k][r] } }
console.log("cells", c, "total", t, JSON.stringify(byRule));'
```

Expected: `cells 80 total 607 {"color-contrast":367,"landmark-one-main":32,"page-has-heading-one":48,"region":160}`

If it differs, the branch is not where this plan assumes — stop and report.

- [ ] **Step 2: Regenerate through CI's own server**

```bash
A11Y_UPDATE_BASELINE=1 CI=true E2E_FIXTURE_MODE=1 BASE_URL=http://127.0.0.1:3000 \
DATABASE_URL=postgresql://fixture:fixture@127.0.0.1:5432/fixture \
NEON_AUTH_BASE_URL=https://fixture.invalid \
NEON_AUTH_COOKIE_SECRET=fixture-neon-auth-cookie-secret-for-ci-only-00000001 \
NEXT_PUBLIC_SUPABASE_URL=https://fixture.invalid NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-anon-key \
SUPABASE_SERVICE_ROLE_KEY=fixture-service-key NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000 \
REPORT_SHARE_SECRET=fixture-report-share-secret-for-local-only-0001 \
npx playwright test --project=a11y-375 --project=a11y-768 --project=a11y-1024 --project=a11y-1440
```

**`CI=true` is required, not cosmetic.** It selects `scripts/start-playwright-ci-server.cjs`, which
copies the repo to `.playwright-ci-server/` **excluding `*.local`** — so the run does not load the
broken `.env.local`. A plain local run produces different numbers and would bake local-only failures
into the baseline permanently.

Then:

```bash
node scripts/a11y/rebuild-baseline.mjs
```

Expected: it reports 80 cells and a total.

- [ ] **Step 3: Report the after totals and the direction**

Re-run Step 1's command. **Report before and after side by side, per rule.**

Expected: `color-contrast` drops materially; `region`, `page-has-heading-one` and
`landmark-one-main` unchanged, since this slice touches no landmarks or headings.

**If a non-contrast rule moved, stop and report** — that means something unintended changed.

**If the total went UP, do not commit.** That would mean the palette change made things worse, and
reading the numbers before touching this file is the entire point.

- [ ] **Step 4: Confirm the gate passes on its own**

Re-run the four a11y projects from Step 2 **without** `A11Y_UPDATE_BASELINE=1`.

Expected: all 80 cells pass, exit 0.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/a11y/baseline.json && git commit -F- <<'EOF'
test(a11y): regenerate the baseline after the contrast fix

Lowering the baseline is correct here and would have been wrong for the
pricing change alone. Same mechanism, opposite verdict -- the only difference
is which way the counts moved, which is why this plan required reading them
before touching this file.

Regenerated through CI's own isolated-workspace server, which excludes *.local,
so these are the numbers the gate will see rather than local-environment
artefacts.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Update PR #10 in place, and verify

- [ ] **Step 1: Push**

```bash
git push
```

- [ ] **Step 2: Retitle and rewrite the PR body**

PR #10 now carries both the pricing tokenisation and the palette fix. The palette fix is the
headline; retitle accordingly.

Write the body to the **scratchpad**, not the repository:
`C:\Users\laich\AppData\Local\Temp\claude\C--Users-laich-Documents-Aiso\b522ef06-a30d-45a3-8d0a-edc29c32eccf\scratchpad\pr10-body-v2.md`

```bash
gh pr edit 10 --title "fix(a11y): make --muted-foreground clear WCAG AA, and tokenise pricing surfaces" --body-file "<the scratchpad path above>"
```

The body must state, at minimum:

- that the pricing tokenisation **exposed** rather than caused the defect — before it, that text sat
  on hardcoded white at ~6.5:1;
- the audit: 11 of 13 pairs already passing, and every failure tracing to one colour under two names;
- the four declarations with before/after ratios;
- that both replacement values were computed, and why the bare minimums were rejected;
- **the baseline before/after totals, per rule**, from Task 3 Step 3;
- that lowering the baseline is correct here and would not have been for the pricing change alone;
- that the update mode is opt-in, never default, and how that was verified;
- the "MOST POPULAR" badge as a known, untouched, pre-existing failure at 1.77:1;
- the earlier prediction that this shift would just mean "update the baseline" — and that it was
  wrong. Recording it is worth more than a clean narrative.

End with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 3: Verify CI against the real HEAD**

```bash
git rev-parse HEAD
```
```bash
gh run list --limit 5 --json headSha,conclusion,status,workflowName
```

**A green run whose `headSha` is not this branch's HEAD is not evidence.** Match the SHAs before
reporting anything.

`e2e-accessibility` must now **pass**, and `pr-gate` with it. Report all seven jobs.

If `e2e-accessibility` fails, report the failing cells and counts. **Do not touch `baseline.json`
again.** A second regeneration to chase a green tick is exactly how a ratchet becomes an amnesty.
