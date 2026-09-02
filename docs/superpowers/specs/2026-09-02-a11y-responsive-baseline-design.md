# Accessibility and responsive baseline — design

**Status:** Approved 2026-09-02
**Phase:** 2, slice 2.5. First slice of sub-project B1 (design foundation).
**Scope:** Test harness and CI gate only. No application code, no design tokens, no donor dependency.

## Why this is first

Phase 2 was decomposed into four sub-projects because its 14 slices are not one project. B1 (design foundation) is 2.1 tokens, 2.2 primitives audit and 2.5 this. Slice 2.1 is defined by the base plan as *"extract 82 custom properties from donor `app/globals.css`"* — it cannot be authored without reading the donor repo. Slice 2.5 depends on nothing outside this repository, and it is the gate every later slice will be measured against, so it goes first.

## What the current gate actually proves

The `e2e-accessibility` CI job is green on every PR. Measured, not assumed:

- `tests/e2e/accessibility.spec.ts` is 87 lines and **3 tests**: `/en`, `/en/auth/login`, and one fixture result page.
- It runs axe with the default rule set, then asserts only on
  `impact === 'critical' || impact === 'serious'`. **Everything moderate or minor passes silently.**
- The rules that therefore cannot fail the gate include `page-has-heading-one`, `heading-order`,
  `region` and `landmark-one-main` — all `moderate`, and all of them exactly what the base plan's
  §11.5 requires ("semantic headings, landmarks").
- **`target-size` is `enabled: false` by default in axe-core 4.12.1** (`node_modules/axe-core/axe.js:33042-33045`,
  `impact: 'serious'`). The 44 px touch-target requirement is never evaluated, at any viewport.
- **Dark mode is never tested.** `app/layout.tsx` toggles `.dark` from `localStorage.theme`, falling
  back to `prefers-color-scheme`. Nothing seeds either, so `color-contrast` — which *is* gated — only
  ever runs in light theme.
- **zh-HK is never scanned**, though bilingual parity is a definition-of-done row.
- **No authenticated surface is scanned at all** — nothing loads `/{lang}/dashboard/**`,
  `/{lang}/onboarding` or `/admin`.

One correction to an earlier reading: a mobile viewport **does** exist. `playwright.config.ts` declares
`chromium` (Desktop Chrome, 1280×720) and `mobile` (Pixel 5, 393×727), and the a11y spec runs under
both. What is absent is the 375/768/1024/1440 matrix the slice is defined by — not the harness itself.

So the honest summary: `color-contrast` is enforced, on three English pages, in light theme. That is
the whole of the accessibility guarantee.

## Approach: baseline and ratchet

Enable everything the plan requires — all impact levels, `target-size` explicitly on, both themes,
both locales, four viewports — then record today's violations in a checked-in baseline and **fail only
on new ones**. Burn the baseline down over time.

This is the only approach that turns on the required checks without CI going red on inherited debt.
More importantly, it replaces an *invisible, permanent* exclusion (the `critical || serious` filter)
with a *visible, countable, shrinking* one. The current filter is precisely how a green job came to
prove so little; swapping it for a list of named violations is the substance of this change.

### Rejected alternatives

| Alternative | Why not |
|---|---|
| Expand scope, keep the `critical` / `serious` filter | Always green, simple — and moderate violations stay permanently invisible. Those are the heading and landmark rules the plan names explicitly. It reproduces today's problem at larger scale. |
| Tiered strictness: full on public routes, `critical`+`serious` on authenticated | Matches risk, but the line is arbitrary and it leaves two configurations to reason about. Revisit only if the baseline proves unmanageable. |

## Components

### 1. `tests/e2e/a11y/` replaces the single spec

A shared runner takes `{ route, locale, theme, viewport }` and scans. The matrix is **data, not
copy-pasted tests**, so adding a route or a breakpoint is a one-line change.

Two axe details that are load-bearing:

- **Enable `target-size` with `.options({ rules: { 'target-size': { enabled: true } } })`, never
  `.withRules(['target-size'])`.** `withRules` runs *only* the named rules, which would silently
  disable every other check — the exact failure this slice exists to end.
- **Select dark theme with Playwright's `emulateMedia({ colorScheme: 'dark' })`.** This works without
  seeding storage because `app/layout.tsx`'s inline script honours `prefers-color-scheme` when no
  `theme` key is set. Seeding `localStorage` would also work but requires an extra navigation.

Initial matrix: viewports 375 / 768 / 1024 / 1440; locales `en` and `zh-HK`; themes light and dark;
routes starting with the three already covered. Authenticated routes are **out of scope for this
slice** — they need a signed-in fixture, which is its own piece of work.

### 2. `tests/e2e/a11y/baseline.json`

**Counts per rule per cell — not selectors.** A cell is one `{route, theme, viewport}`; its id is
`` `${route} | ${theme} | ${viewport}` ``, and route already carries the locale prefix.

```json
{ "accepted": { "/en | dark | 375": { "color-contrast": 20, "region": 7 } } }
```

**Amended 2026-09-02, after measurement.** This was originally keyed on
`rule + route + theme + a stable element signature` derived from axe's `node.target`. That does
not work: axe generates only as much selector specificity as it needs to disambiguate, so the
same three elements were observed as `.gap-1\.5.inline-flex:nth-child(1..3)` on eight runs and
`.gap-1\.5.inline-flex.items-center:nth-child(1..3)` on the ninth. An earlier patch had already
been needed for React `useId()` appearing in a target. A gate that fails roughly one run in nine
on unrelated PRs gets switched off, and then all 151 measured violations go back to being
invisible. Storing a count cannot drift, because it never records a selector.

Viewport is part of the cell id because counts legitimately differ by width — a responsive layout
can hide at 375 what it shows at 1440. That has a useful consequence: each cell fully owns its
keys, so **one test checks both directions**, and the separate whole-matrix stale pass the
original design needed is unnecessary.

Two failure directions, both required:

- A rule whose count **rose**, or that is absent from the cell's accepted map, fails. That is the gate.
- A rule whose count **fell**, or that stopped firing, also fails, with "lower the number". Without
  this the file only ever grows and becomes a blanket amnesty — the same shape as the
  `critical || serious` filter it replaces.

The cost is that a failure names the rule and the cell rather than the element. The attached axe
report has the element.

### 3. Viewport matrix in `playwright.config.ts`

Named projects for the four widths, applied to the a11y specs only. The existing `chromium` and
`mobile` projects keep their current behaviour, so every non-a11y E2E spec is unaffected.

## Error handling

- CI already fails on any Playwright skip (`scripts/ci/classify-playwright.mjs:31` treats
  `skipped > 0` as blocking), so a matrix entry cannot quietly not-run.
- A malformed or unreadable `baseline.json` fails closed — it must never be treated as "no accepted
  violations", which would pass vacuously on a broken file.
- Axe failing to run at all fails the test rather than reporting zero violations.

## Testing — the gate must be watched failing

A guard nobody has watched fire is not known to work. Three deliberate failures, each restored:

1. Remove an entry from `baseline.json` → that violation fails the gate.
2. Introduce a contrast violation in a fixture → fails at the affected theme.
3. Confirm `target-size` genuinely reports at 375 px, by asserting it appears in raw axe output for a
   known-small control — proving the rule is enabled rather than merely configured.

The first two prove the ratchet; the third proves the rule that is currently unmeasurable is now
measured.

## Out of scope

- Slices 2.1 (tokens) and 2.2 (primitives audit) — 2.1 needs the donor repo.
- **Fixing the violations the baseline records.** This slice makes them visible and stops new ones. The
  burn-down is separate work, and pretending otherwise would make this slice unbounded.
- Authenticated-surface scanning — needs a signed-in fixture.
- Bundle budgets (2.13) and the legal-gated privacy/terms pages (2.10).
