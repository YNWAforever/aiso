# `--input` role split — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the scan form's and onboarding wizard's input borders visible, and stop the invisible-border bug returning.

**Architecture:** Guard first. It fails by listing all ten offending usages, so its failure output is the bug report. Then the ten replacements make it pass.

**Tech Stack:** Tailwind CSS v4, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-09-03-input-token-role-design.md`

**Branch:** `claude/plan-2.2-input-token-role`, already cut from `origin/main`.

---

## Background the implementer needs

`--input` is `#ffffff` in light and `#0d0d18` in dark. `--card` is **the same two values**. So
`border-input bg-card` draws a border in exactly the colour of its own fill — invisible, both
themes. `--background` (`#f8fafc` / `#050510`) is one shade off, so `border-input bg-background` is
effectively invisible too.

`--input` is used for two roles:

- **`bg-input` — correct.** 4 usages: `components/ui/input.tsx:11`,
  `components/dashboard/AddBrandWizard.tsx:156`, `components/pulse/AlertsTab.tsx:70,86`.
  **Do not touch these.** `--input` remains the fill token.
- **`border-input` — the bug.** Exactly 10 usages, one per line, listed in Task 2.

`--border` is `#e2e8f0` / `#1e1e30` — distinguishable from both `--card` and `--background` in both
themes. That is the correct token for a border.

**Do not change any token's value.** `--input` keeps `#ffffff` / `#0d0d18`. The fix is at the usage
site, not the definition.

Two repo conventions:

- **`git add -A` is forbidden here.** Name files explicitly in every commit.
- The two usages at `OnboardingWizard.tsx:207` and `:370` are **buttons**, not inputs. They want a
  visible edge for the same reason; change them too.

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `__tests__/config/input-token-role.test.ts` | Assert `border-input` appears nowhere | Create |
| `components/home/ScanForm.tsx` | 3 replacements | Modify |
| `components/onboarding/OnboardingWizard.tsx` | 7 replacements | Modify |
| `app/globals.css` | Document `--input` as fill-only, both modes | Modify |

---

### Task 1: The guard, written first and watched failing

**Files:**
- Create: `__tests__/config/input-token-role.test.ts`

- [ ] **Step 1: Write it**

```ts
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * `--input` is the input FILL colour and nothing else.
 *
 * It is byte-identical to `--card` in both themes (#ffffff light, #0d0d18
 * dark), so `border-input` draws a border the exact colour of the surface it
 * sits on -- invisible, with no error, no lint failure and no failing test.
 * That is how ten of them survived in the public scan form and the onboarding
 * wizard. Use `border-border` for borders.
 *
 * A source-text scan is the right shape here, unlike the guards in
 * playwright-projects.test.ts and check-explanations-parity.test.ts which
 * deliberately avoid reading source. In those the text was correct and the
 * semantics were wrong, so text could not see the bug. Here the assertion IS
 * about text: "this class string does not appear". A rendering-based version
 * would be slower, flakier, and blind to any file no test renders.
 *
 * This also guards the next slice: the donor repo resolves `--input` to a LINE
 * colour and 16 of its components/ui files use `border-input`, so copying one
 * in would silently reintroduce this.
 */
/**
 * NOTE: this file itself contains the string `border-input` -- in the comment
 * above and in the check below. It passes only because __tests__/ is not
 * scanned. Do NOT broaden ROOTS to include __tests__ without excluding this
 * file, or the guard fails on itself and reads as a false positive.
 */
const ROOTS = ['app', 'components']

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) out.push(full)
    }
  }
  walk(dir)
  return out
}

describe('--input is the fill token only', () => {
  it('no file uses border-input', () => {
    const offenders: string[] = []
    for (const root of ROOTS) {
      for (const file of sourceFiles(join(process.cwd(), root))) {
        readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
          if (line.includes('border-input')) {
            const rel = file.slice(process.cwd().length + 1).replace(/\\/g, '/')
            offenders.push(`${rel}:${i + 1}`)
          }
        })
      }
    }
    expect(offenders).toEqual([])
  })
})
```

- [ ] **Step 2: Run it and WATCH IT FAIL**

Run: `npx vitest run __tests__/config/input-token-role.test.ts`

Expected: FAIL, listing **exactly 10** locations — 3 in `components/home/ScanForm.tsx` (151, 191,
209) and 7 in `components/onboarding/OnboardingWizard.tsx` (205, 207, 297, 305, 344, 364, 370).

**Record that list verbatim.** It is both the proof the guard works and the inventory Task 2 fixes.
If the count is not 10, stop and report — the file is not in the state this plan was written
against.

- [ ] **Step 3: Commit the failing guard**

Commit it now, failing, so the history shows the bug it caught.

```bash
git add __tests__/config/input-token-role.test.ts && git commit -F- <<'EOF'
test(design): guard that border-input is never used

Committed while failing, listing all ten offending usages, so the history
records the bug rather than only its fix.

--input is byte-identical to --card in both themes, so border-input draws a
border the exact colour of the surface beneath it. Ten of these survived in the
public scan form and the onboarding wizard because nothing could see them.

A source-text scan is correct here: the assertion is literally that a class
string does not appear. The guards in playwright-projects and
check-explanations-parity avoid reading source because there the text was fine
and the semantics were wrong -- the opposite case.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Replace the ten usages

**Files:**
- Modify: `components/home/ScanForm.tsx` — lines 151, 191, 209
- Modify: `components/onboarding/OnboardingWizard.tsx` — lines 205, 207, 297, 305, 344, 364, 370

- [ ] **Step 1: Replace**

In both files, replace every occurrence of the exact string `border-input` with `border-border`.
Nothing else on those lines changes. Note line 151 reads `border-2 border-input` and becomes
`border-2 border-border` — keep the `border-2`.

```bash
python - <<'PY'
for p in ('components/home/ScanForm.tsx', 'components/onboarding/OnboardingWizard.tsx'):
    s = open(p, encoding='utf-8').read()
    n = s.count('border-input')
    open(p, 'w', encoding='utf-8', newline='\n').write(s.replace('border-input', 'border-border'))
    print('%s: replaced %d' % (p, n))
PY
```

Expected: `ScanForm.tsx: replaced 3` and `OnboardingWizard.tsx: replaced 7`.

- [ ] **Step 2: Confirm `bg-input` was NOT touched**

Run: `grep -rn "bg-input" --include=*.tsx components | wc -l`

Expected: `4`. Those are the correct usages of `--input` and must survive unchanged. If this is not
4, revert and redo — the replacement was too broad.

- [ ] **Step 3: The guard now passes**

Run: `npx vitest run __tests__/config/input-token-role.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 4: Prove the guard still bites**

Reintroduce `border-input` on one line of `ScanForm.tsx`, re-run, confirm it fails naming **that one
location**. Restore, confirm it passes, and confirm `git diff components/home/ScanForm.tsx` shows
only the intended replacements.

- [ ] **Step 5: Commit**

```bash
git add components/home/ScanForm.tsx components/onboarding/OnboardingWizard.tsx && git commit -F- <<'EOF'
fix(design): give scan-form and onboarding inputs a visible border

Ten usages of border-input drew a border in the exact colour of the surface
beneath them: --input is byte-identical to --card (#ffffff light, #0d0d18 dark),
and one shade from --background. The public scan form's three inputs and the
onboarding wizard's seven controls had no visible edge in either theme.

Changed to border-border (#e2e8f0 / #1e1e30), which is distinguishable from
both. The two button usages are included -- they want an edge for the same
reason.

The four bg-input usages are untouched; that is --input's correct and now only
role.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Document the token

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Annotate both declarations**

`--input` appears twice: line 37 in `:root` and line 101 in `.dark`. Add above the `:root` one:

```css
  /* Input FILL only -- never a border. Byte-identical to --card in both
     themes, so `border-input` renders a border the exact colour of the surface
     under it: invisible, silently. Use --border for borders.
     Guarded by __tests__/config/input-token-role.test.ts. */
```

And a one-line reminder above the `.dark` one:

```css
  /* Fill only -- see the note in :root. Same value as --card here too. */
```

Match the file's existing comment style (it uses `/* ── Section ── */` banners and plain `/* */`
notes).

- [ ] **Step 2: Confirm no value changed**

Run: `git diff app/globals.css`

Expected: only added comment lines. **Zero changed declarations.** If any `--` line appears with a
`-` prefix, revert.

- [ ] **Step 3: Commit**

```bash
git add app/globals.css && git commit -F- <<'EOF'
docs(design): record that --input is a fill token, never a border

Comments only, no value changes. --input equals --card in both themes, which is
why border-input was invisible rather than merely faint, and why this needs
saying at the definition rather than only in a test.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Verify and open the pull request

- [ ] **Step 1: Full verification**

Run each and report:

- `npm run lint` — exit 0
- `npm run typecheck` — exit 0
- `npm run test:unit` — exit 0, with file and test counts (the new guard adds 1 file, 1 test)
- `npm run build` — exit 0

- [ ] **Step 2: Confirm the working tree is clean**

Run: `git status --porcelain` — expected empty.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin claude/plan-2.2-input-token-role
```

Write the body to the scratchpad — **not** into the repository — and open the PR against `main`.

The body must state: that `--input` is byte-identical to `--card` in both themes so these borders
were invisible rather than faint; which surfaces were affected and that the scan form is the public
acquisition surface; that no token value changed and the four `bg-input` usages are untouched; that
the guard was committed failing with all ten locations listed; and that this also protects the
future donor-primitive port, since the donor uses `border-input` in 16 files with the opposite
meaning. End with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 4: Verify CI ran against the real HEAD**

```bash
gh run list --limit 5 --json headSha,conclusion,status,workflowName
```

Compare against `git rev-parse HEAD`. **A green run whose headSha is not this branch's HEAD is not
evidence** — that mistake was made earlier in this project.

- [ ] **Step 5: If `e2e-accessibility` fails, read it before assuming a defect**

That job runs 80 a11y cells and the baseline fails in **both** directions. Making ten borders
visible could shift a `color-contrast` count — borders are not text, so it should not, but if it
does, that is the gate working. **Report the exact cell and counts. Do not edit `baseline.json`.**
Whether a newly-visible border is an accessibility improvement or a regression is a judgement for
the human, not a number to be silenced.
