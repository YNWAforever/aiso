# `--input` has two contradictory roles — design

**Status:** Approved 2026-09-03
**Origin:** Slice 2.2 (primitives audit). The audit's finding turned out to be about this repository,
not the donor.

## The finding

`--input` is used for two incompatible purposes, and one of them renders invisibly.

| token | light | dark |
|---|---|---|
| `--input` | `#ffffff` | `#0d0d18` |
| `--card` | `#ffffff` | `#0d0d18` |
| `--background` | `#f8fafc` | `#050510` |
| `--border` | `#e2e8f0` | `#1e1e30` |

`--input` is **byte-identical to `--card`** in both themes.

**As a fill (`bg-input`) it is correct** — 4 usages across `components/ui/input.tsx:11`,
`components/dashboard/AddBrandWizard.tsx:156`, and `components/pulse/AlertsTab.tsx:70,86`.

**As a border (`border-input`) it is invisible** — 10 usages:

- `components/home/ScanForm.tsx:151,191,209` — `border-input` on `bg-card`. Border colour equals
  fill colour exactly, in both themes. Not faint: **identical**.
- `components/onboarding/OnboardingWizard.tsx:205,207,297,305,344,364,370` — `border-input` on
  `bg-background`. One shade apart in each theme, effectively invisible. Two of these
  (`:207`, `:370`) are buttons rather than inputs.

So the public scan form — the primary acquisition surface — has inputs with no visible border in
either theme, and the onboarding wizard has seven more. This predates the donor entirely and has
been true for as long as these tokens have existed.

## How it was found, and why that matters

Slice 2.2 was going to port the donor's primitives. The donor resolves `--input` to
`var(--line-strong)` — `#c8d0cd`, a **line** colour — and 16 of its `components/ui/` files use
`border-input`. Copying any of them here would have produced a white border on white with no error,
no lint failure and no failing test.

Checking whether this repo shared that hazard revealed it already has it, from the other direction.
The donor is not the problem; it is what made the problem visible.

## Design

**1. Change the 10 `border-input` usages to `border-border`.**

`--border` (`#e2e8f0` / `#1e1e30`) is distinguishable from both `--card` and `--background` in both
themes. The two button usages want a visible edge for the same reason the inputs do.

**2. Leave the 4 `bg-input` usages untouched.**

They use `--input` correctly. That becomes its single role.

**3. Document `--input` as fill-only** beside the token in `app/globals.css`, in both `:root` and
`.dark`, so the next person does not re-derive this. The comment must state that `--input` equals
`--card` by design and therefore must never be used as a border colour.

**4. Add a guard asserting `border-input` appears nowhere in `app/` or `components/`.**

This is the part that earns its keep. It locks the decision in, and it is what stops a donor
primitive arriving in a later slice with `border-input` and silently reintroducing an invisible
border. The donor has 16 candidate files, so this is a live risk rather than a hypothetical one.

The guard must be watched failing: reintroduce one `border-input`, see it fail and name the file,
then restore.

**A source-text scan is the right shape here, and that is not a contradiction.** Two guards written
earlier today deliberately avoided grepping source — the mobile-project guard asks Playwright what
it resolves, and the check-copy guard reads the objects rather than the file. In both, the text was
never wrong; the *semantics* were, so text could not see the bug.

Here the text **is** the property. The assertion is "the class string `border-input` does not appear
in this codebase", which is exactly and only a statement about source text. A behavioural version —
rendering a component and measuring its computed border colour — would be slower, flakier, and would
miss any file that happens not to be rendered by a test. Live it where the repo already keeps
assertions over source, `__tests__/config/`, alongside `function-durations.test.ts`.

**No token value changes.** `--input` keeps `#ffffff` / `#0d0d18`; `--border` keeps its values.
Only class usages, one comment, and one new test.

## Error handling

Not applicable — this is a styling correction with no runtime behaviour. The failure mode being
addressed is silent-by-construction, which is why the guard rather than a visual check is the
deliverable.

## Testing

- The new guard, watched failing on a deliberately reintroduced `border-input`.
- `npm run lint`, `npm run typecheck`, `npm run test:unit` clean.
- `npm run build` succeeds.
- **The a11y baseline may move.** The `e2e-accessibility` job runs 80 cells and fails in *both*
  directions. Borders are not text, so `color-contrast` should be unaffected — but if any cell
  shifts, that is the gate working. Report the cell and count; do not edit `baseline.json`
  reflexively.

## Out of scope

- **Porting any donor primitive.** The audit's conclusion is that the 6 missing ones
  (`dialog`, `progress`, `select`, `sheet`, `table`, `tabs`) should arrive in whichever later slice
  actually needs them, not speculatively. `components/ui/` is excluded from the orphan guard
  (`__tests__/components/orphaned-components.test.ts`, which filters `ui/` as "vendored and expected
  to include pieces this app does not use yet"), so adding them unused would be *permitted* — but
  permitted is not the same as useful.
- **Reconciling `badge` / `button` / `input` to the donor's generation.** The repo uses
  `forwardRef` with only `@radix-ui/react-slot`; the donor uses `data-slot` and the unified
  `radix-ui` package. That migration changes existing rendering and needs its own slice.
- Any change to `--radius`, the `--dash-*` family, or `.dark` token values.
- Whether the inputs *should* be borderless. That question was asked and answered: this is a bug.
