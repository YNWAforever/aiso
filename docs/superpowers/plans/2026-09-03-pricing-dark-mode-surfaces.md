# Pricing dark-mode surfaces — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the pricing page actually dark in dark mode.

**Architecture:** Guard first, so its failure lists the ten offending lines. Then eleven token replacements in one file, applied in a **specific order** because the patterns nest. Then screenshots, because a passing test cannot show that a page looks right.

**Tech Stack:** Tailwind CSS v4, Vitest 4, the Browser pane for visual confirmation.

**Spec:** `docs/superpowers/specs/2026-09-03-pricing-dark-mode-surfaces-design.md`

**Branch:** `claude/plan-2.3-dark-mode-surfaces`, already cut from `main`.

---

## Background the implementer needs

`app/[lang]/pricing/page.tsx` hardcodes ten surfaces as white. `--background` is `#050510` in dark
mode, so the page renders white cards on near-black. The home page does not: it uses
`bg-background/95` and `bg-card`.

Token values, both themes:

| token | light | dark |
|---|---|---|
| `--card` | `#ffffff` | `#0d0d18` |
| `--background` | `#f8fafc` | `#050510` |
| `--muted` | `#f1f5f9` | `#141422` |

Because `--card` is `#ffffff` in light mode, **light-mode rendering should not change at all.** If it
does, something mapped wrongly.

**Three exclusions, all deliberate. Do not "also fix" them:**

- **`text-white` — 17 occurrences in `app/`, not defects.** Mostly white text on saturated brand
  backgrounds, correct in both themes.
- **`app/[lang]/r/[slug]/page.tsx:172` is `print:bg-white` — correct.** Printing a dark page wastes
  ink. That file needs **no** change.
- **`app/admin/` and `components/`** — separate slices.

**`git add -A` is forbidden here.** Name files explicitly.

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `__tests__/config/dark-mode-surfaces.test.ts` | Assert no hardcoded surface colour under `app/[lang]/` | Create |
| `app/[lang]/pricing/page.tsx` | Eleven token replacements on ten lines | Modify |

---

### Task 1: The guard, written first and watched failing

**Files:**
- Create: `__tests__/config/dark-mode-surfaces.test.ts`

- [ ] **Step 1: Write it**

```ts
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Public pages must paint surfaces with tokens, never hardcoded white or black.
 *
 * `--background` is #050510 in dark mode, so a hardcoded surface white renders
 * a white card on a near-black page. The a11y gate cannot catch this: white
 * surfaces carry dark text, contrast passes, and the page is simply not dark.
 *
 * SCOPE IS DELIBERATELY NARROW, and widening it will break the guard:
 *
 *   - `text-white` is ALLOWED. There are 17 in app/, nearly all white text on
 *     saturated brand backgrounds, which is correct in both themes. Banning it
 *     fails on 17 non-defects.
 *   - The `print:` variant is ALLOWED. app/[lang]/r/[slug]/page.tsx uses it on
 *     purpose -- printing a dark page wastes ink.
 *
 * A guard that cries wolf gets deleted, and then the real defect returns with
 * nothing watching for it.
 */
const ROOT = join('app', '[lang]')

// Surface utilities only: backgrounds and gradient stops. Not text.
const FORBIDDEN = /\b(bg|from|via|to)-(white|black)\b/

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.tsx')) out.push(full)
    }
  }
  walk(dir)
  return out
}

describe('public pages paint surfaces with tokens', () => {
  it('no hardcoded white or black surface under app/[lang]/', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(join(process.cwd(), ROOT))) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        // Strip print: variants before testing, so they are exempt wherever
        // they appear rather than only when adjacent to something else.
        if (FORBIDDEN.test(line.replace(/print:[a-z-]+(\/\d+)?/g, ''))) {
          const rel = file.slice(process.cwd().length + 1).replace(/\\/g, '/')
          offenders.push(`${rel}:${i + 1}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })
})
```

- [ ] **Step 2: Run it and WATCH IT FAIL**

Run: `npx vitest run __tests__/config/dark-mode-surfaces.test.ts`

Expected: FAIL listing **exactly 10** lines, all in `app/[lang]/pricing/page.tsx`:
220, 262, 278, 279, 345, 367, 409, 412, 435, 444.

**`app/[lang]/r/[slug]/page.tsx:172` must NOT appear.** If it does, the `print:` exemption is not
working — fix the regex, not the source file. If the count is not 10, or any other file appears,
stop and report.

Record the list verbatim.

- [ ] **Step 3: Commit the failing guard**

```bash
git add __tests__/config/dark-mode-surfaces.test.ts && git commit -F- <<'EOF'
test(design): guard that public surfaces use tokens, not hardcoded white

Committed while failing, listing the ten offending lines, so the history
records the defect rather than only its fix.

Scope is deliberately narrow. text-white is allowed -- 17 in app/, nearly all
white text on brand backgrounds, correct in both themes. The print: variant is
allowed -- r/[slug] uses it on purpose. A guard that fails on 18 non-defects
gets deleted, and then the real defect returns unwatched.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 2: The eleven replacements — ORDER MATTERS

**Files:**
- Modify: `app/[lang]/pricing/page.tsx`

Eleven tokens across ten lines (line 435 carries two). **The patterns nest:**
`hover:bg-white/90` contains `bg-white/90`, which contains `bg-white`. Replacing the bare form first
corrupts the other two. Apply in exactly this order.

- [ ] **Step 1: Replace, in order**

```bash
python - <<'PY'
p = 'app/[lang]/pricing/page.tsx'
s = open(p, encoding='utf-8').read()
steps = [
    # 1. most specific first -- contains bg-white/90, which contains bg-white
    ('hover:bg-white/90',        'hover:bg-card/90',        1),
    # 2. the sticky nav. Home renders this element as bg-background/95.
    ('bg-white/90',              'bg-background/90',        1),
    # 3. the gradient. from-slate-50 is hardcoded too; tokenising half a
    #    gradient would be worse than either extreme.
    ('from-slate-50 to-white',   'from-muted to-background', 1),
    # 4. everything left is a card, panel, table, button or footer surface.
    ('bg-white',                 'bg-card',                 8),
]
for old, new, expected in steps:
    n = s.count(old)
    assert n == expected, 'expected %d of %r, found %d' % (expected, old, n)
    s = s.replace(old, new)
    print('%-26s -> %-26s x%d' % (old, new, n))
open(p, 'w', encoding='utf-8', newline='\n').write(s)
PY
```

Expected output, in order: `hover:bg-white/90 x1`, `bg-white/90 x1`,
`from-slate-50 to-white x1`, `bg-white x8`. **Eleven replacements total.**

Each step asserts its own count, so a wrong order fails loudly rather than silently mangling a
class. If any assertion trips, `git checkout "app/[lang]/pricing/page.tsx"` and report — do not
adjust the counts to make it pass.

- [ ] **Step 2: The guard now passes**

Run: `npx vitest run __tests__/config/dark-mode-surfaces.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 3: Confirm the exclusions survived**

```bash
grep -c "text-white" "app/[lang]/pricing/page.tsx"
grep -n "print:bg-white" "app/[lang]/r/[slug]/page.tsx"
git status --porcelain
```

Expected: the `text-white` count is unchanged from before your edit — record what it was first;
`print:bg-white` is still present at `r/[slug]:172`; and `git status` shows **only**
`app/[lang]/pricing/page.tsx` modified. If any other file changed, revert it.

- [ ] **Step 4: Static verification**

- `npm run lint` — exit 0
- `npm run typecheck` — exit 0
- `npm run test:unit` — exit 0, report file and test counts
- `npm run build` — exit 0

- [ ] **Step 5: Commit**

```bash
git add "app/[lang]/pricing/page.tsx" && git commit -F- <<'EOF'
fix(design): make the pricing page dark in dark mode

Ten surfaces were hardcoded white against a #050510 background: the sticky nav,
both tier cards, two buttons, the comparison table, the FAQ panel, a gradient
stop and the footer. The page rendered white-on-near-black.

The a11y gate could not catch it -- pricing passes in dark theme at all four
viewports because white surfaces carry dark text and the contrast is fine. The
page was not inaccessible, it was simply not dark.

The nav becomes bg-background/90 rather than bg-card, matching the element home
renders as bg-background/95, so the two pages stop diverging.

Light mode is unchanged: --card is #ffffff there.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Look at it

A passing test cannot show that a page looks right. This task is the one that actually verifies the
fix, and it must not be skipped or replaced with reasoning.

- [ ] **Step 1: Start the dev server**

Use `preview_start` with `.claude/launch.json`'s dev-server entry if one exists; otherwise create one
with `runtimeExecutable: "npm"`, `runtimeArgs: ["run","dev"]`, `port: 3000`. **Never run the dev
server through Bash.**

- [ ] **Step 2: Screenshot dark mode**

Navigate to `/en/pricing`, set `colorScheme: 'dark'` via `resize_window`, and screenshot.

Expected: cards, nav, table, FAQ panel and footer all render **dark** (`#0d0d18` surfaces on a
`#050510` page). Nothing white except text and brand accents.

- [ ] **Step 3: Screenshot light mode**

Set `colorScheme: 'light'`, reload, screenshot.

Expected: **visually identical to before this change**, because `--card` is `#ffffff` in light mode.
If light mode looks different, a token was mapped wrongly — report it rather than adjusting to taste.

- [ ] **Step 4: Report both screenshots**

Send them with `SendUserFile`, or describe precisely what each shows. State plainly whether dark mode
is fixed and whether light mode is unchanged. **Do not claim the fix works without having looked.**

---

### Task 4: Open the pull request

- [ ] **Step 1: Confirm state**

`git status --porcelain` — expected empty. `git log --oneline main..HEAD` — expected 3 commits
(spec, failing guard, fix).

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin claude/plan-2.3-dark-mode-surfaces
```

Write the body to the scratchpad — **not** the repository — and open the PR against `main`.

The body must state: that the page rendered white-on-near-black in dark mode; that the a11y gate
could not catch it and why; the exact ten lines and their replacements; that light mode is unchanged
because `--card` is `#ffffff` there; that `text-white`, the `print:` variant, `app/admin/` and
`components/` are deliberately excluded, with the reason for each; and that the guard was committed
failing. **Attach or describe the before/after dark-mode screenshots** — for this slice they are the
primary evidence. End with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 3: Verify CI ran against the real HEAD**

```bash
gh run list --limit 5 --json headSha,conclusion,status,workflowName
```

Compare against `git rev-parse HEAD`. **A green run whose headSha is not this branch's HEAD is not
evidence.**

- [ ] **Step 4: Expect `e2e-accessibility` to move, and read it**

Unlike previous slices, a `color-contrast` shift here is **expected** — dark-mode surfaces genuinely
change, so the contrast between them and their text genuinely changes. The baseline fails in both
directions.

If a cell moves: **report the exact cell and both counts.** Then say whether lowering
`baseline.json` is correct, with reasoning. For this change it may well be — dark text on a dark card
has different contrast than dark text on a white card, and the new value is the honest one. That
judgement is the user's, but unlike previous slices the answer is probably "update the baseline"
rather than "investigate a regression".
