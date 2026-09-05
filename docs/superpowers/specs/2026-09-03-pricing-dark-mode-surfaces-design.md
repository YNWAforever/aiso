# Pricing page ignores dark mode — design

**Status:** Approved 2026-09-03
**Origin:** Slice 2.3 (public shell). The shell extraction is deferred; this is the defect found while
scoping it.

## The finding

`app/[lang]/pricing/page.tsx` paints ten surfaces with hardcoded `bg-white` and a `to-white`
gradient stop. `--background` in dark mode is `#050510`. So in dark mode the pricing page renders
white cards, a white sticky nav, a white comparison table and a white footer on a near-black page.

The home page does not have this: it uses `bg-background/95` for its nav and `bg-card` for its
footer. Pricing diverged.

**The a11y baseline does not catch it.** `e2e-accessibility` runs pricing in dark theme at all four
viewports and passes, because white surfaces carry dark text and the contrast is fine. The page is
not inaccessible; it is simply not dark. Contrast checking cannot see a theme violation.

## Scope, and how it narrowed

The count moved several times during investigation, and the final number is small:

| stage | count | why it was wrong |
|---|---|---|
| first pass | "~11" | grepped three files with a narrow pattern |
| repo-wide | 94 across 30 files | included `components/` and `text-*` |
| `app/` surfaces | ~13 | still included exceptions |
| **final** | **10, one file** | after reading every site |

**`text-white` is excluded — 17 occurrences in `app/`, and they are not defects.** Most sit on
saturated brand backgrounds (`app/[lang]/page.tsx:128-202` is eight of them, on primary-coloured
buttons and badges). White text on a blue button is correct in both themes. They should ideally be
`text-primary-foreground`, but that is token hygiene with no user-visible effect, and converting
them would triple the diff.

**`app/[lang]/r/[slug]/page.tsx:172` is excluded and must stay as it is.** It reads
`print:bg-white` — a print variant, and correct. Printing a dark page would waste ink. A blind
find-and-replace would have broken this, which is the reason each site was read rather than matched.
Its other three occurrences are `text-white`, already out of scope. **That file needs no change.**

**`app/admin/` is excluded.** Its single `bg-white` sits beside `border-slate-200`; the admin subtree
has its own hardcoded palette, and fixing one line of it would be incoherent. It is internal
tooling, not a themed public surface.

**`components/` is excluded** — 64 occurrences across 25 files. Its own slice.

## Design

**Replace the ten surfaces in `app/[lang]/pricing/page.tsx`:**

| line | element | replacement |
|---|---|---|
| 220 | sticky site `<nav>`, `bg-white/90` | `bg-background/90` |
| 262 | button carrying `text-primary` | `bg-card` |
| 278 | featured tier card | `bg-card` |
| 279 | tier card | `bg-card` |
| 345 | secondary button | `bg-card` |
| 367 | comparison `<table>` | `bg-card` |
| 409 | section, `from-slate-50 to-white` | `from-muted to-background` |
| 412 | FAQ panel | `bg-card` |
| 435 | CTA button, `bg-white` + `hover:bg-white/90` | `bg-card` + `hover:bg-card/90` |
| 444 | `<footer>` | `bg-card` |

Line 220 becomes `bg-background/90` rather than `bg-card` deliberately: it is the same element the
home page renders as `bg-background/95`, and the point is to stop the two pages diverging.

Line 409's `from-slate-50` is also hardcoded. It is included because leaving half a gradient
tokenised would be worse than either extreme.

**Add a guard** asserting no `bg-white`, `bg-black`, or `-white`/`-black` gradient stop appears under
`app/[lang]/`.

Deliberately narrower than "no hardcoded colours":

- It must **allow `text-white`**, or it fails on 17 non-defects and gets switched off.
- It must **allow the `print:` variant**, or it fails on a correct line in `r/[slug]`.

A guard that cries wolf is removed, and then the real defect returns unopposed. The scope is the
point.

## Error handling

Not applicable — a styling correction with no runtime behaviour.

## Testing

**This slice needs visual confirmation, unlike the others today.** "The token is correct" and "the
page looks right" are different claims, and only the second one matters here.

- The guard, watched failing on the ten current occurrences before the fix.
- `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run build` all clean.
- **Screenshot `/en/pricing` in dark mode before and after.** The before-shot is the evidence the bug
  is real; the after-shot is the evidence it is fixed. Neither is replaceable by a passing test.
- Light mode must be spot-checked too: `bg-card` is `#ffffff` in light, so light-mode rendering
  should be byte-identical. If light mode changes, something mapped wrongly.
- `e2e-accessibility` may shift a `color-contrast` count, since dark-mode surfaces genuinely change.
  If a cell moves, report it. Do not edit `baseline.json` reflexively — but note that unlike previous
  slices, a change here is *expected* rather than surprising, and lowering the baseline may well be
  correct once the numbers are read.

## Out of scope

- Extracting the shared public shell (the original slice 2.3). Still worth doing, and now cleaner:
  once pricing uses tokens, its footer differs from home's by structure rather than by colour.
- The 17 `text-white` occurrences in `app/`.
- The 64 occurrences in `components/`.
- `app/admin/`'s palette.
- `border-slate-200` and other hardcoded non-white utilities. This slice covers surfaces only.
