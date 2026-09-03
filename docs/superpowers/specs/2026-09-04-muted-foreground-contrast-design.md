# `--muted-foreground` fails WCAG AA — design

**Status:** Approved 2026-09-04
**Origin:** PR #10 (pricing dark-mode surfaces) failed `e2e-accessibility`. Investigating why found a
palette defect, not a mistake in that PR.

## What happened, and what it revealed

PR #10 tokenised ten hardcoded white surfaces on the pricing page. Correct in intent — and it made
`e2e-accessibility` fail on **all 8 `pricing | dark` cells**, with `color-contrast` going from 19
accepted to **81 observed**.

That is not a baseline that needs lowering. Reading the live page found `rgb(92,92,110)` text on
`rgb(13,13,24)` at **2.95:1**, against a WCAG AA requirement of 4.5:1.

Before PR #10 that text sat on hardcoded white, where it passes at ~6.5:1. Tokenising the surfaces
did not create the defect — it **exposed** it, 62 more times.

**An earlier prediction of mine was wrong and is worth recording.** The plan for PR #10 said a
contrast shift there would probably mean "update the baseline, this is the honest number". It was
not. Raising the baseline would have recorded a genuine AA failure as accepted, on the pricing page,
permanently. The mechanism that saved it was insisting the numbers be *read* before the file was
touched.

## The audit

Every meaningful token pair, both themes, computed from `app/globals.css`:

**Dark mode — 11 of 13 pairs pass. All five failures are one colour, `#5c5c6e`:**

| pair | ratio | |
|---|---|---|
| `foreground / background` | 15.49 | pass |
| `foreground / card` | 14.75 | pass |
| `primary-foreground / primary` | 11.45 | pass |
| `secondary-foreground / secondary` | 13.92 | pass |
| **`muted-foreground / muted`** | **2.79** | **fail** |
| **`muted-foreground / card`** | **2.95** | **fail** |
| **`muted-foreground / background`** | **3.10** | large text only |
| **`dash-muted / dash-surface`** | **2.95** | **fail** |
| **`dash-muted / dash-bg`** | **3.10** | large text only |

**Light mode — one marginal failure:** `muted-foreground / muted` at **4.34**. The other four pass
(4.55–4.76).

`#5c5c6e` is both `--muted-foreground` and `--dash-muted` in dark; `#64748b` is both in light. So the
whole problem is **two colours under two names each — four declarations.**

> **Addendum, 2026-09-04 — this count was wrong, and the audit method is why.** Spec review during
> implementation found a **third** name for the same two colours: `--sidebar-muted-fg`, `#64748b` in
> `:root` and `#5c5c6e` in `.dark`, registered in `@theme` as `--color-sidebar-muted-fg`. On the
> sidebar surfaces it gives **3.01** and **2.79** in dark and **4.34** against `--sidebar-accent` in
> light — the identical failure.
>
> So it is two colours under **three** names each: **six declarations, not four.**
>
> The cause is the audit method above, not an oversight in a single row. It enumerated token
> *pairs by name* and computed a ratio for each. A colour reachable under a name the audit never
> listed is invisible to that approach, however carefully each listed row is checked. Auditing by
> **value** — group every declaration sharing a hex, then check each group against the surfaces it
> can land on — would have caught all six in one pass.
>
> `--sidebar-muted-fg` was latent rather than rendered: nothing outside `globals.css` referenced it,
> so no user ever saw it fail. That is why fixing it cost two lines instead of a regression, and it
> is luck rather than diligence.

## Design

| token | mode | from | to | worst-case ratio after |
|---|---|---|---|---|
| `--muted-foreground` | dark | `#5c5c6e` | `#88889a` | 5.23 |
| `--dash-muted` | dark | `#5c5c6e` | `#88889a` | 5.23 |
| `--muted-foreground` | light | `#64748b` | `#5e6e85` | 4.74 |
| `--dash-muted` | light | `#64748b` | `#5e6e85` | 4.74 |

**Both values are computed, not chosen.** The bare minimums are `#7e7e90` (dark, 4.57) and `#607087`
(light, 4.60) — each clearing the threshold by under 0.1, which is too thin to build on given axe
rounds and any future surface tweak would break it. The proposed values give 0.7–1.3 of headroom
while remaining a 6-unit shift in light mode and preserving hierarchy in dark: 5.55:1 against
`--foreground`'s 14.75:1 still reads as clearly secondary.

**PR #10 folds into this**, on its existing branch. Separately, each fails the gate: the pricing
change is a regression without the palette fix, and the palette fix triggers a baseline regeneration
that the pricing change would immediately invalidate. One slice, one regeneration.

## The baseline regeneration — and why it is legitimate here

`compareCounts()` fails in **both** directions, so a genuine improvement fails it too. Many cells
will report "Accessibility improved" and the baseline must be lowered.

That is correct **here** and would have been wrong for PR #10 alone. Same mechanism, opposite
verdict, and the difference is only which way the numbers moved. The regeneration must therefore be
accompanied by the before/after counts, so a reviewer can see the direction rather than trust it.

## Error handling

Not applicable — token values only, no runtime behaviour.

## Testing

- Recompute every pair in the audit table after the change; all must clear 4.5:1. This is arithmetic
  on the file, so it is exact.
- Verify on the live page that the failing text now measures above 4.5:1, using computed styles
  rather than a screenshot.
- `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run build` clean.
- Regenerate `tests/e2e/a11y/baseline.json` from a CI-faithful run and **report the total violation
  count before and after.** The 608 figure should drop; how far is unknown and is itself the result.

## Out of scope

- The **"MOST POPULAR" badge**: `bg-primary text-white` where dark `--primary` is `#00d4ff` gives
  **1.77:1**. A real failure, pre-existing, already in the accepted baseline, and untouched by this
  slice — it needs a different fix (a darker text colour on that badge, not a palette change).
- The remaining accepted violations. This slice fixes one pair, not the backlog.
- `text-white` in `app/`, `components/`'s 64 hardcoded colours, `app/admin/`'s palette.
- Any change to `--foreground`, `--primary`, `--radius`, or surface tokens.
