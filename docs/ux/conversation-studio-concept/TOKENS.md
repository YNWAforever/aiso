# Concept tokens — Stage 1 proposal

**設計示例，非產品數據 / design mock — not product data**

The [inner snapshot](concept-inner.html) declares **11** `--as-*` variables,
all on `#aiso-studio`. This table includes every declaration and both branches
of `light-dark()`. No tokens or styles are implemented by Stage 0.

The repository uses Tailwind **v4**, configured through `@theme inline` in
[app/globals.css](../../../app/globals.css); there is no Tailwind config file.
That file provides the existing semantic colors, `neutral-*`, `tone-*`,
`shadow-e*`, font stack and radius utilities. Dark mode follows the `.dark`
class. See [CLAUDE.md](../../../CLAUDE.md) for the design-system constraints.

## Complete variable mapping

Keep the concept variables scoped to the eventual Studio root. Where light
values match, reuse existing variables as aliases; specify the concept dark
value inside the Studio scope under `.dark`. Other rows need scoped literal
values for fidelity. The “existing counterpart” column identifies the closest
role, not an assertion that its color is identical. Do not overwrite global
tokens to make this one workspace match.

| Concept variable | Light | Dark | Existing counterpart | Proposed Stage 1 scoped mapping and utility |
| --- | --- | --- | --- | --- |
| `--as-bg` | `#f8fafc` | `#0d1320` | `--background` / `bg-background`; `--neutral-2` also matches light | Light alias `var(--background)`; dark `#0d1320`; `bg-[var(--as-bg)]` |
| `--as-panel` | `#ffffff` | `#141c2a` | `--card` / `bg-card` | Light alias `var(--card)`; dark `#141c2a`; `bg-[var(--as-panel)]` |
| `--as-side` | `#f0f4f9` | `#101725` | `--neutral-3` / `bg-neutral-3` (nearby surface) | Preserve both concept values; `bg-[var(--as-side)]` |
| `--as-ink` | `#17263e` | `#edf2fc` | `--neutral-12` / `text-neutral-12` (strong text) | Preserve both concept values; `text-[var(--as-ink)]` |
| `--as-muted` | `#596b82` | `#a8b7cc` | `--muted-foreground` / `text-muted-foreground` (muted text) | Preserve both concept values; `text-[var(--as-muted)]` |
| `--as-line` | `#dce4ef` | `#314059` | `--border` / `border-border` (border) | Preserve both concept values; `border-[var(--as-line)]` |
| `--as-blue` | `#2563eb` | `#70b5ff` | `--primary`, `--tone-info`, `--ring` (all match light) | Light alias `var(--primary)`; dark `#70b5ff`; `text-[var(--as-blue)]`, `bg-[var(--as-blue)]`, focus outline |
| `--as-onblue` | `#fff` | `#0b203c` | `--primary-foreground` / `text-primary-foreground` | Light alias `var(--primary-foreground)`; dark `#0b203c`; `text-[var(--as-onblue)]` |
| `--as-soft` | `#eaf1ff` | `#203752` | `--tone-info-soft` / `bg-tone-info-soft` (tinted surface) | Preserve both concept values; `bg-[var(--as-soft)]` |
| `--as-warn` | `#805714` | `#f0c784` | `--tone-warning-fg` / `text-tone-warning-fg` (warning text) | Preserve both concept values; `text-[var(--as-warn)]` |
| `--as-warnbg` | `#fff8e9` | `#322919` | `--tone-warning-soft` / `bg-tone-warning-soft` (warning surface) | Preserve both concept values; `bg-[var(--as-warnbg)]` |

`--as-muted` is text; the repository's `--muted` is a surface. `--as-line` is
a border; `--input` is a fill matching the card. `--warning` is a solid accent,
not the warning foreground. These role distinctions matter even where values
look close. The dark counterparts of the existing aliases differ from the
concept, so plain global aliases in both themes would lose fidelity.

Stage 1 should use the repository's `.dark` mechanism for scoped overrides,
instead of assuming `light-dark()` alone follows a class toggle. No new global
Tailwind registration is necessary for the arbitrary variable utilities above;
a later implementation can choose scoped CSS rules for the same variables.

Stage 1 also replaces the visible Stage B1/B2 badges with the concept header
chrome. Existing feature gates, quota disclosures and saved/live honesty remain
reachable and accurate; removing a development label does not remove a limit.

## Geometry, typography and component styles

These are literal CSS rules in the snapshot, not additional `--as-*` variables.
They are listed to keep the Stage 1 handoff complete; structural rearrangement
belongs to the stages in [VIEWS.md](VIEWS.md).

| Concept rule | Stage 1 / later-stage mapping proposal |
| --- | --- |
| Body `14px/1.6`, Inter + Noto Sans TC + Microsoft JhengHei | `font-sans text-sm leading-[1.6]`; reuse the existing system TC fallback stack. Do not add a CJK webfont; CLAUDE.md records its performance cost. |
| h1 `30px/1.3`, weight 650, tracking −0.8px; mobile 26px | `text-3xl leading-[1.3] font-[650] tracking-[-0.8px]`, scoped mobile 26px; verify against existing zh-HK tracking rules. |
| h2 19px/1.4, weight 650; h3 15px, weight 600 | Scoped exact sizes; nearby Tailwind `text-lg`/`text-base` would change the concept scale. |
| Eyebrow 11px, weight 650, tracking 1.7px; small labels/badges 11px | Record exact reference sizes. Repository guidance sets a 12px minimum for new UI: Stage 1 must document that adjustment and compare it visually; do not silently introduce 11px product text. |
| Shell 16px radius, 1px line; desktop min-height 780px | `rounded-xl` matches the existing 16px radius token; scoped border. Full shell structure is Stage 5, Layout B. |
| Composer 16px radius, 15px padding, `0 6px 22px #102a5b06` shadow | `rounded-xl p-[15px]` with scoped exact shadow for parity; existing `shadow-e1` is the semantic alternative but is not the same shadow. |
| Template cards 11px radius, 15px padding, 10px grid gap; hover blue border/soft fill | Scoped 11px radius; nearby existing `rounded-md` is 10px. Keep icon/title/description/outcome hierarchy. |
| Result cards 10px radius; note/buttons 8px; badges/filter chips 6px | Existing `rounded-md` is 10px and `rounded-sm` is 6px; use `rounded-[8px]` for 8px (repo `rounded-lg` is 12px). |
| Badge neutral / blue / amber | Line + panel + muted; blue + soft; warn + warnbg. No one generic pill style. |
| Selected filter ink background + panel foreground | Use the two scoped color roles together; do not inherit primary button colors. |
| Main padding 27px 28px 32px; ≤900px 22px; ≤620px 20px 16px | Scoped exact spacing; grid and responsive composition belong to Stages 2–5. |
| Shell rail 205px, ≤900px 178px; inspector 240px | Stage 5 rail and Stage 4 inspector. Inspector stacks below at ≤900px. |
| ≤620px mobile rail/menu, single-column templates/tools, textarea 16px, 44px actions | Later-stage responsive behavior; keep product targets at least 44px on all relevant controls, including desktop. |
| Focus outline 3px blue, 3px offset; toast `aria-live="polite"` | Preserve keyboard visibility and live feedback; use existing UI/toast primitives where they fit. |

Stage 1 acceptance still needs light/dark, en/zh-HK, contrast and focus checks
at 1440/900/390 widths. The snapshot does not prove product accessibility or
justify deleting B1/B2 honesty content. No acceptance screenshots or app tests
are claimed by this documentation table.
