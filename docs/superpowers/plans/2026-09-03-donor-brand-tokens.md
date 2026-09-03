# Donor brand tokens (slice 2.1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the codebase the donor's brand-token vocabulary without changing any existing token's value.

**Architecture:** Purely additive edits to one file, `app/globals.css`. Plus two genuine bug fixes found while measuring: three dead font references, and two missing Tailwind registrations.

**Tech Stack:** Tailwind CSS v4, `@theme inline`.

**Spec:** `docs/superpowers/specs/2026-09-03-donor-brand-tokens-design.md`

**Branch:** `claude/plan-2.1-donor-tokens`, already cut from `origin/main`.

---

## Background the implementer needs

**This slice does not change how the application looks, and is not meant to.** The donor's appearance
lives in its own `app/globals.css` — 7,325 lines, 1,161 hand-written class selectors — not in its
token names. Do not "improve" anything to make a visual difference.

Structure of `app/globals.css` as it stands:

| line | what |
|---|---|
| 4 | `:root {` opens |
| 63 | `}` closes `:root` |
| 66 | `.dark {` opens — 41 declarations |
| 126 | `@theme inline {` opens |
| 171-172 | `--font-sans` / `--font-mono`, both pointing at undefined `--font-geist-*` |
| 228 | `body { font-family: var(--font-geist-sans), system-ui, sans-serif; }` |

**Those line numbers are as-of-now and Task 2 invalidates them.** Task 2 inserts roughly 42 lines
inside `:root`, so by the time Task 3 runs the font declarations have moved down to about 213-214 and
the body rule to about 270. **Match on content, never on line number.** The steps below are written
that way; if you find yourself counting lines, stop.

Two conventions that will bite you:

- **`git add -A` is forbidden here.** Name files explicitly in every commit.
- Do **not** touch `.dark`, `--radius`, or any `--dash-*` token. All three are out of scope and each
  has a specific reason recorded in the spec.

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `app/globals.css` | All four changes | Modify |

One file, four separate commits, so each change can be reverted independently.

---

### Task 1: Capture the baseline token map

Before touching anything, record what every custom property currently resolves to. Tasks 2-4 are
judged against this.

- [ ] **Step 1: Write the baseline**

```bash
python - <<'PY'
import re, json
vals = {}
for line in open('app/globals.css', encoding='utf-8'):
    m = re.match(r'\s*(--[A-Za-z0-9-]+)\s*:\s*([^;]+);', line)
    if m and m.group(1) not in vals:
        vals[m.group(1)] = m.group(2).strip()
json.dump(vals, open('token-baseline.json', 'w', encoding='utf-8'), indent=1, sort_keys=True)
print('captured', len(vals), 'distinct custom properties')
PY
```

Expected: `captured 107 distinct custom properties`. If the number differs, **stop and report** —
the file is not in the state this plan was written against.

`token-baseline.json` is a scratch artifact. **Do not commit it.** Task 5 deletes it.

---

### Task 2: Add the 20 brand tokens

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Insert at the end of the `:root` block**

The insertion point is the `}` that closes `:root` — currently line 63, immediately after
`--dash-danger:   #dc2626;`. Anchor on that declaration rather than the number.

```css

  /* ── Donor brand palette (aisogpt @ 52cbcb4) ───────────────────
     Added additively. Nothing here is referenced yet; these exist so a later
     slice porting a donor CSS rule can use var(--paper) etc. verbatim rather
     than translating names at every point of use.
     The donor ships NO dark-mode values, so none of these have a .dark
     counterpart. Do not invent one -- authoring that ramp is its own slice. */
  --paper:        #f7f8f3;
  --paper-deep:   #eef1ea;
  --ink:          #10233f;
  --ink-soft:     #354762;
  --cobalt:       #2457e6;
  --cobalt-dark:  #1742b9;
  --lime:         #c8ee63;
  --lime-soft:    #effbd0;
  --white:        #ffffff;
  --line:         #dce2df;
  --line-strong:  #c8d0cd;
  --danger:       #bd3d45;
  --danger-soft:  #fff0f1;
  --info:         #6f4bc4;
  --info-soft:    #f2edff;
  --success-soft: #e7f7ef;
  --warning-soft: #fff4d8;

  /* These three collide with existing tokens, so they are prefixed rather than
     overwritten -- writing them bare would repaint the application.

     --brand-muted is the dangerous one. The donor's --muted is a FOREGROUND
     grey; this repo's --muted (#f1f5f9) is a SURFACE. The real equivalent of
     the donor's --muted here is --muted-foreground (#64748b), NOT --muted.
     The donor itself sidesteps this at its globals.css:65, registering
     --color-muted: var(--paper-deep) rather than var(--muted) -- which is why
     the Tailwind utilities agree across both repos while the raw variable does
     not, and why the trap is quiet.

     --brand-success (#0b724b) and --brand-warning (#945700) are the same role
     as the existing --success (#16a34a) and --warning (#d97706), just darker.
     Overwriting would recolour every success and warning affordance. */
  --brand-muted:   #5f6b7e;
  --brand-success: #0b724b;
  --brand-warning: #945700;
```

- [ ] **Step 2: Prove no existing token moved**

```bash
python - <<'PY'
import re, json
before = json.load(open('token-baseline.json', encoding='utf-8'))
after = {}
for line in open('app/globals.css', encoding='utf-8'):
    m = re.match(r'\s*(--[A-Za-z0-9-]+)\s*:\s*([^;]+);', line)
    if m and m.group(1) not in after:
        after[m.group(1)] = m.group(2).strip()
changed = {k: (before[k], after.get(k)) for k in before if after.get(k) != before[k]}
added = sorted(set(after) - set(before))
print('changed or removed:', changed if changed else 'NONE')
print('added (%d): %s' % (len(added), ', '.join(added)))
PY
```

Expected: `changed or removed: NONE`, and exactly **20** added names. Any entry in `changed` is a
failure — revert and redo. Report both lines verbatim.

- [ ] **Step 3: Commit**

```bash
git add app/globals.css && git commit -F- <<'EOF'
feat(design): add the donor brand palette additively

Twenty tokens from the aisogpt donor at 52cbcb4. Nothing references them yet;
they exist so a later slice porting a donor CSS rule can use var(--paper)
verbatim instead of translating names at the point of use.

Three are prefixed rather than written bare because they collide. --muted is a
semantic inversion -- the donor's is a foreground grey, this repo's is a
surface -- so writing it bare would flip a near-white background to mid-grey
app-wide. --success and --warning are the same role in a darker shade and would
recolour every such affordance.

No existing token changes value: verified by diffing the name->value map of
every custom property before and after.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Fix the dead font references

**Files:**
- Modify: `app/globals.css`

`--font-geist-sans` and `--font-geist-mono` are referenced 3 times and defined 0 times. `geist` is
not a dependency and nothing imports `next/font`.

- [ ] **Step 1: Confirm the bug before fixing it**

```bash
grep -nE 'font-geist|--font-sans|--font-mono|font-family' app/globals.css
node -e 'const p=require("./package.json");console.log("geist dep:", !!(p.dependencies?.geist||p.devDependencies?.geist))'
```

Expected: three `font-geist` references (lines ~171, ~172, ~228) and `geist dep: false`. Note that
line 228 **does** carry `system-ui, sans-serif` fallbacks, so the body currently renders — only
`--font-sans` and `--font-mono` resolve to nothing.

- [ ] **Step 2: Replace the two `--font-*` declarations**

Find the two lines whose values are `var(--font-geist-sans)` and `var(--font-geist-mono)` — inside
`@theme inline`, around line 213 after Task 2 — and replace them with:

```css
  --font-sans:                  Inter, "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", Arial, sans-serif;
  --font-mono:                  "SFMono-Regular", Consolas, "Liberation Mono", monospace;
```

- [ ] **Step 3: Fix the `body` font-family**

Find the `body` rule's `font-family: var(--font-geist-sans), system-ui, sans-serif;` — around line
270 after Task 2 — and replace that declaration with:

```css
  font-family: var(--font-sans);
```

- [ ] **Step 4: Confirm nothing still references the dead variables**

Run: `grep -c 'font-geist' app/globals.css`
Expected: `0`.

- [ ] **Step 5: Commit**

```bash
git add app/globals.css && git commit -F- <<'EOF'
fix(design): give --font-sans and --font-mono a real stack

Both pointed at --font-geist-sans / --font-geist-mono, which are referenced
three times and defined nowhere -- geist is not a dependency and nothing
imports next/font -- so the font-sans and font-mono utilities resolved to
nothing. The body rule was less broken than it looked: it carried system-ui
fallbacks and did render.

Adopts the donor's stacks, which name Traditional Chinese faces this repo
declared nowhere. zh-HK users previously got whatever their browser chose for
Chinese; this states a preference. That is a deliberate rendering change, and
the only one in this slice.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Register the two missing `--color-popover*` entries

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Confirm the gap**

```bash
grep -cE '^\s*--color-popover' app/globals.css
grep -nE '^\s*--popover' app/globals.css
```

Expected: `0` registrations, but `--popover` and `--popover-foreground` both declared in `:root`.
So `bg-popover` and `text-popover-foreground` currently resolve to nothing.

- [ ] **Step 2: Add both inside `@theme inline`**

Place them beside the other `--color-*` registrations, matching the surrounding alignment style:

```css
  --color-popover:            var(--popover);
  --color-popover-foreground: var(--popover-foreground);
```

- [ ] **Step 3: Verify**

Run: `grep -cE '^\s*--color-popover' app/globals.css`
Expected: `2`.

- [ ] **Step 4: Commit**

```bash
git add app/globals.css && git commit -F- <<'EOF'
fix(design): register --color-popover so bg-popover resolves

--popover and --popover-foreground were declared in :root but registered in
neither @theme inline entry, so the bg-popover and text-popover-foreground
utilities produced nothing. The donor registers both.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Verify and open the pull request

- [ ] **Step 1: Final token-map check**

Re-run the Task 2 Step 2 script. Expected: `changed or removed:` lists **only** `--font-sans` and
`--font-mono` — those two are changed on purpose by Task 3. Everything else must be unchanged, and
the added set must be the 20 brand tokens plus `--color-popover` and `--color-popover-foreground`.

If any other token appears in `changed`, something went wrong — report it rather than proceeding.

- [ ] **Step 2: Delete the scratch baseline**

```bash
rm token-baseline.json
```

Then run `git status --porcelain` — expected: empty. If `token-baseline.json` appears as untracked,
it was not deleted. **It must not reach the PR.**

- [ ] **Step 3: Full verification**

Run each and report the status:

- `npm run build` — exit 0. This is the one that would catch malformed CSS.
- `npm run lint` — exit 0.
- `npm run typecheck` — exit 0.
- `npm run test:unit` — exit 0. Record file and test counts.

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin claude/plan-2.1-donor-tokens
```

Write the body to the scratchpad — **not** into the repository — and open the PR against `main`.

The body must state: that this changes no existing token value and is groundwork rather than a
visible change; that the donor's appearance is 7,325 lines of CSS so tokens alone carry none of it;
why three tokens are prefixed, with the `--muted` inversion spelled out; and that the font change
**does** alter zh-HK rendering deliberately, because no CJK family was declared before. End with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 5: Verify CI ran against the real HEAD**

```bash
gh run list --limit 5 --json headSha,conclusion,status,workflowName
```

Compare against `git rev-parse HEAD`. **A green run whose headSha is not this branch's HEAD is not
evidence** — that mistake was made earlier in this project.

Note the `e2e-accessibility` job now runs the full 138-test matrix including 80 a11y cells, and the
a11y baseline **fails in both directions**. If the font change alters text metrics enough to move a
`color-contrast` count, that job will fail with "Accessibility improved" or "exceeded". That is the
gate working, not a defect: report the exact cell and count rather than editing `baseline.json`
reflexively.
