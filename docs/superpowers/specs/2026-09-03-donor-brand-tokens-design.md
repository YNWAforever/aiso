# Donor brand tokens — additive foundation (slice 2.1) — design

**Status:** Approved 2026-09-03
**Scope:** `app/globals.css` only. Additive. **No existing token changes value** — see Testing for the two deliberate rendering changes.

## What this is, and what it is not

Phase 2 slice 2.1 is "extract the donor's design tokens". This spec deliberately scopes it to the
*additive* half and says plainly what that does and does not buy.

**It does not make the application look like the donor.** That was the finding worth having before
committing days to this. The donor's appearance lives in its `app/globals.css` — 7,325 lines with
1,161 hand-written class selectors — applied to stock shadcn primitives. Of 498 `className`
attributes in its main component file, **9** contain Tailwind utilities. Neither the token names nor
the nine primitives its app imports carry the look across. Anyone expecting a visual change from
this slice will be disappointed, and should be told so before it is built rather than after.

What it does buy: the vocabulary. Donor CSS references `var(--paper)`, `var(--cobalt)` and so on
directly, so a later slice porting a donor rule can use it verbatim instead of translating names at
every point of use.

## Verified state

Measured directly, not taken from the earlier survey (which was wrong about a different file):

| | |
|---|---|
| Donor dark mode | **0** `.dark` selectors, **0** `prefers-color-scheme` |
| Target dark mode | **41** declarations |
| `--radius` | donor `0.8rem`, target `0.625rem` |
| `--dash-*` | 11 names, **24** component files depend on them, **0** in the donor |
| `--font-geist-sans` / `-mono` | referenced **3×**, defined **0×** |
| `--color-popover*` registrations | target **0**, donor **2** |

The first row is why the *replacement* scoping was rejected: adopting the donor palette wholesale
requires **authoring** a dark ramp the donor does not have. That is design work, not a port, and it
has never been scoped.

## The three collisions

Of the donor's 20 brand tokens, 17 have no name in the target and 3 do:

| token | donor | target | why it matters |
|---|---|---|---|
| `--muted` | `#5f6b7e` | `#f1f5f9` | **Semantic inversion.** The donor's is a *foreground* grey; the target's is a *surface*. Overwriting flips a near-white background to mid-grey app-wide. |
| `--success` | `#0b724b` | `#16a34a` | Same role, different shade. Overwriting recolours every success affordance. |
| `--warning` | `#945700` | `#d97706` | Same role, different shade. Same consequence. |

All three violate "zero pixels change", so none may be written under its bare donor name.

Worth recording: the donor already works around its own `--muted` at `globals.css:65`, where it
registers `--color-muted: var(--paper-deep)` rather than `var(--muted)` — because `--muted` would be
wrong as a surface. The Tailwind utilities therefore agree across both repos even though the raw
variable does not, which is exactly what makes this trap quiet.

## Design

**1. Add the 17 non-colliding brand tokens under their donor names, verbatim.**

`paper`, `paper-deep`, `ink`, `ink-soft`, `cobalt`, `cobalt-dark`, `lime`, `lime-soft`, `white`,
`line`, `line-strong`, `success-soft`, `warning-soft`, `danger`, `danger-soft`, `info`, `info-soft`.

Donor names, not invented ones: a future port of a donor CSS rule then works without translation.

**2. Add the 3 colliding tokens as `--brand-muted`, `--brand-success`, `--brand-warning`.**

Each carries a comment naming the conflict. `--brand-muted`'s says explicitly that the donor's
`--muted` is a foreground whose real target equivalent is `--muted-foreground` (`#64748b`), **not**
`--muted`. That comment is the deliverable as much as the token is — it is the mistake most likely
to be made by whoever ports next.

**3. Fix the dead font references — and pick up a CJK stack the product needs.**

`--font-geist-sans` / `--font-geist-mono` are referenced 3 times and defined 0 times. `geist` is not
a dependency and nothing imports `next/font`. Precisely what breaks:

- `app/globals.css:171-172` — `--font-sans: var(--font-geist-sans)` and
  `--font-mono: var(--font-geist-mono)` have **no fallback**, so both resolve to nothing and the
  `font-sans` / `font-mono` utilities do nothing.
- `app/globals.css:228` — `font-family: var(--font-geist-sans), system-ui, sans-serif` **does** have
  a fallback, so the body renders. An earlier draft of this spec said it resolved to nothing; that
  was wrong.

Adopt the donor's stacks verbatim (`app/globals.css:85-86`):

```
--font-sans: Inter, "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", Arial, sans-serif;
--font-mono: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
```

Remove the dead `var(--font-geist-*)` references, including from line 228. No `next/font` import and
no new dependency — these are locally-installed or generic families.

**This one deliberately DOES change rendering, and only for the better.** The target declares no CJK
preference anywhere, so zh-HK users get whatever their browser picks for Chinese. `Noto Sans TC` /
`PingFang TC` / `Microsoft JhengHei` state one. In a bilingual product that is a real improvement,
not a side effect — but it means the "zero pixels change" claim covers items 1 and 2 only, and this
item is excluded from it explicitly.

**4. Register the two missing `--color-popover*` entries.**

The target declares `--popover` and `--popover-foreground` in `:root` but registers neither in
`@theme inline`, so `bg-popover` and `text-popover-foreground` do not resolve. The donor registers
both. Verified: target 0, donor 2.

**Nothing is retired, re-pointed, or changed in value.**

## Testing

The whole verification is that nothing moved:

- Every custom property that existed before still exists with a **byte-identical value**. Assert by
  parsing `app/globals.css` before and after and diffing the name→value map — new keys allowed,
  changed or removed keys are a failure.
- `npm run build` succeeds.
- `npm run lint`, `npm run typecheck`, `npm run test:unit` clean.
- Items 3 and 4 change resolved output **deliberately** and are excluded from the assertion above:
  item 3 gives `font-sans` / `font-mono` a real stack (and Latin text may reflow if `Inter` is
  installed locally), item 4 makes `bg-popover` / `text-popover-foreground` resolve. Latin rendering
  should be spot-checked once; **zh-HK rendering will change by design** and should be looked at, since
  no CJK family was declared before.

## Out of scope

- **Replacing any target token.** Requires authoring a dark ramp; separate slice.
- **`--radius`.** Adopting the donor's `0.8rem` would make `rounded-xl` (18.8px) larger than
  `rounded-2xl` (16px), inverting the scale across ~128 usages.
- **The `--dash-*` family.** 24 components depend on it and the donor has no equivalent.
- **Slice 2.2, the primitives.** The `--input` inversion — a fill in the target, a line colour in
  the donor — would render white-on-white borders in 16 files with no error and no test failure.
  It deserves its own slice and its own guard.
- Any change to component markup or appearance.
