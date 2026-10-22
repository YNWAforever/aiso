# Visual system plan

Status: proposal for review (Phase 0). The tokens and components are built in Phase 1. Current-state facts
are cited from `audit.md` §d and `appendix/copy-visual.md` Part B.

## 1. Foundations (Phase 1 targets)

| Token group | Today | Target |
|---|---|---|
| Colour | Three overlapping palettes plus a dormant one. Blue in light mode, cyan in dark | One neutral scale (12 steps), one brand hue (keep the existing blue `#2563eb` family, also in dark), semantic `success / warning / danger / info`, each with a `-soft` background and a `-fg` text colour that passes 4.5:1. `--dash-*` and `--sidebar-*` become aliases, then are removed |
| Dark mode | `dark:` follows the OS setting, the tokens follow the toggle | Add `@custom-variant dark (&:where(.dark, .dark *));` so both follow `.dark` |
| Type | 13 sizes plus 9–12 px arbitrary values | 7-step scale `xs 12 / sm 14 / base 16 / lg 18 / xl 22 / 2xl 28 / 3xl 36` plus `display 48/64`, emitted as v4 `--text-*` tokens. **12 px minimum**, and 14 px minimum for CJK body text |
| CJK | No rules | `:lang(zh-HK)` gets body line-height 1.75 (Latin 1.6), `line-break: strict`, `word-break: normal`, `overflow-wrap: anywhere`, `text-transform: none`, `letter-spacing: 0` (this neutralises `uppercase` and `tracking-widest` labels). `break-all` is removed in favour of `break-words` |
| Font | None loaded | `next/font`: Inter (Latin, variable, subset) plus **Noto Sans TC** (weights 400/500/700, `display: swap`; CJK is loaded as unicode-range slices so the first paint stays light). Stack: `Inter, "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif` |
| Spacing | Tailwind defaults | 8 px grid (`4` is the half step). Section rhythm 64/96 px on desktop, 40/56 px on mobile |
| Radius | lg, xl and 2xl mixed | `sm 6 / md 10 / lg 16 / full`. Cards use `lg`, controls use `md` |
| Shadow / elevation | Ad hoc | `e0` flat, `e1` card, `e2` hover/popover, `e3` dialog/drawer, with dark-mode variants using a border plus lower alpha |

## 2. Motion principles

1. **Motion explains.** Each animation answers exactly one of: *what changed* (state), *why* (cause → effect,
   such as "fix done → score rises") or *how far along* (progress). If it answers none of these, cut it.
2. **Transform and opacity only.** Never animate layout properties (width, height, top, left), so there is no
   CLS. Bars grow with `scaleX` and a `transform-origin`, and rings draw with `stroke-dashoffset`. That is
   SVG-composited and allowed; it is the one exception.
3. **Durations** (from `lib/motion.ts`):
   - micro (press, hover): 150 ms
   - UI (enter, exit, tab underline, toast): 200–250 ms
   - drawer: 300 ms
   - count-ups and ring fills: ≤ 800 ms
   - hero loop: 6–8 s
4. **One easing curve**: `cubic-bezier(0.2, 0, 0, 1)` (a quick start with a gentle settle), with exits at 0.8×
   duration. The drawer is the only spring, and it is critically damped with no overshoot.
5. **Sequence, don't scatter.** At most one choreographed sequence per viewport. Stagger 40 ms per item, and
   cap the total at 400 ms.
6. **Reduced motion** (`prefers-reduced-motion: reduce`): render the end state immediately. Count-ups show
   the final number. The hero shows a static composed frame. Scroll-drawn lines are drawn already. Do not
   simply shorten durations. Playwright gets a reduced-motion snapshot spec for each visual.
7. **Off-screen work is free.** Animations start on `IntersectionObserver` entry and pause when the tab is
   hidden. The hero loop pauses when out of view.
8. **Celebrate rarely.** Use one subtle glow (or confetti in under 1 s) only when the score improves or
   crosses a grade boundary, and never on a first scan.

Library: `motion` (allowed), imported via `motion/react` with `LazyMotion` + `domAnimation`, which keeps
it around 15 kB and loaded only on pages that animate. CSS transitions remain the default for simple hovers.
Lottie is used **only** for illustrations that SVG and CSS can't express (the hero, if needed). Prefer
dotLottie for size.

## 3. Visual components

### `components/ui` (primitives)

| Component | Notes |
|---|---|
| PageHeader | title (≤8 words), one-line description, actions slot, breadcrumbs slot |
| StatCard | label, value, delta (arrow plus sign plus a colour that is never the only cue), optional Sparkline |
| ScoreBadge | grade letter plus colour, with sizes sm/md/lg; replaces the ≥4 hand-rolled pills |
| EmptyState | illustration, one heading, one line, one button |
| DataTable | sortable and filterable; collapses to cards below 640 px |
| Skeleton | shimmer is a `translateX` gradient, static when reduced motion is on |
| Toast | slides in from bottom (mobile) or top-right (desktop); `role="status"` |
| ConfirmDialog | Radix Dialog |
| CommandPalette | ⌘K; Radix Dialog plus a list; brand and route search |

Phase 1 also adds the missing Radix/shadcn pieces it depends on: Dialog, Tabs, Tooltip, Progress and Sheet
(the drawer). These come from the existing Radix and shadcn family, so no new vendor is involved.

### `components/visuals`

| Component | Data props | Text alternative | Reuses |
|---|---|---|---|
| ScoreRing | `score`, `grade`, `previous?` | `aria-label="Score 68 of 100, grade C"` | `result/ScoreReveal.tsx` (best existing; absorbs `ScoreRing.tsx`) |
| CheckHeatmap | `checks[20]` `{key,status,bucket}` | grid with `role="list"`, each tile labelled; plus a visually hidden summary | new |
| PillarGauge | `pillar`, `earned`, `max` | `role="meter"` | `PillarScoreCards.tsx` progressbar |
| ScanTimeline | `checks[]` with live status, `activeBucket` | `aria-live="polite"` announcing bucket and percentage | new (drives the progress UI) |
| PotentialScoreBar | `current`, `potential` | "68 now, 86 if top 3 fixes are done" | new |
| Sparkline | `points[]` | hidden table, or a summary string such as "up 4 over 12 weeks" | new (Recharts) |
| PlatformDots | `platforms × weeks` matrix `{cited, mentioned, absent, notRun}` | table semantics | new; `--platform-*` tokens |
| AnimatedStep | `index`, `icon`, `label` | static text | new |
| HeroDemo | none (scripted) | `aria-hidden` plus one sr-only sentence | new |

Every visual takes data only, gets its strings from `messages/` (keys under `visuals.*`), and has a
reduced-motion story and a `/dev/design-system` entry.

## 4. Text → visual replacement table

| Page | Current text | New visual |
|---|---|---|
| Landing | `home.subheadline` plus a 3-line hero paragraph naming "Actual brand mentions and citations are measured separately…" | One value line plus HeroDemo loop |
| Landing | `home.feature_checks_body` (robots.txt, llms.txt, schema, extractability, citation/factual density, topical authority, chunkability) | Three pillar cards with icon grids (one icon per check, name in a tooltip) |
| Landing | `home.scan_step4-10` progress copy | ScanTimeline (real) |
| Landing | "How the score is built" paragraph plus grade-scale chips | Stacked bar 45/30/25 with grade ticks |
| Landing | "Review your website evidence, then choose a fix" 3 text cards | Three AnimatedSteps (Scan → Fix → Monitor) joined by a drawn line |
| Landing | `home.authority_subtitle` (21 words), `home.proof_subheadline` (24 words) | Before/after split ("Not cited" vs "Cited by AI") with a mock chat answer |
| Pricing | `pricing.subheadline` (22 words), FAQ answers of 32–40 words | ✓/✗ comparison table; FAQ answers ≤2 lines plus "Learn more" |
| Scan progress | Button label "Scanning…" plus one sentence | ScanTimeline: 20 checks flip state, score rises, bucket highlights |
| Result | "B — Good", "Your score 79.5/100", "20 checks scanned", 4 count chips | ScoreRing (integer score) plus ScoreBadge plus one sentence |
| Result | "Consumer AI exposure: Not measured ×5" plus 8 crawler policy lines | PlatformDots row: crawler access ✓/✗ per platform; raw lines in a "Details" drawer |
| Result | "Estimated impact… projections are inferred…" plus "Quick fixes could lift your score by 17 points" | PotentialScoreBar (disclaimer in a tooltip) |
| Result | "+6 more issues found — create a free account…" plus a blurred list | CheckHeatmap (all 20 visible as tiles) plus one save prompt |
| Result | Check detail paragraphs | Drawer: icon, one line, impact and effort chips, code with copy, before/after mini |
| Overview (Home) | "Review saved observations and work to consider. These records do not establish…" | PageHeader with no description; next-best-action card |
| Overview | Pillar cards with "Insufficient evidence · Weighted coverage 0% · 0 pass · 0 warn · 0 fail" | PillarGauge ×3, with an EmptyState when there is no data |
| Overview | "Latest observed AI visibility 25% / Brand mentions 1 / Queries 4 / Platforms 1" | StatCards with Sparkline and delta |
| Overview | "Existing tools" grid of 7 links | Removed (the nav covers it) |
| Dashboard steps | `dashboard.step_*_body` (28–35 words each) | Onboarding stepper: illustration plus one sentence per step |
| Monitor | Observations list, "Observed at / classification" copy | PlatformDots matrix (platform × week) plus a competitor bar chart |
| Monitor | Share-of-voice intro (33 words) | Bar or radar chart vs competitors with a one-line caption |
| Reports | Report builder long form | One-page visual report: ring, heatmap, top-3, trend |
| Methodology | Five body strings of 38–55 words | Diagram: 20 checks → 3 pillars → score → grade, with each paragraph behind "Learn more" |
| Sources / Assets / Members | `sources.notConnected` (44), `assets.intro` (39), `members.approverNote` (41) | EmptyState with an illustration; the detail moves into a "How this works" drawer |

## 5. Asset needs

| Asset | Count | Format | Source / note |
|---|---|---|---|
| Spot illustrations (empty, error, onboarding steps, before/after) | ~10: no scans, no fixes, no tasks, monitor not running, no reports, error, offline, 4 onboarding steps | SVG, two-tone using tokens (adapts to dark mode) | Commission or draw in-house; one consistent line style. I can produce first-pass SVGs in Phase 1 for review |
| Hero demo | 1 loop | Code (SVG + `motion`) preferred; dotLottie only if a designer supplies one | Built in Phase 2 |
| Success glow / confetti | 1 | CSS or `motion` | No file needed |
| Check icons (20) | 20 | lucide-react (already installed) | Mapping table goes in Phase 1 |
| **AI platform logos**: ChatGPT/OpenAI, Perplexity, Google (AI Overviews), Gemini, Claude | 5 | SVG | **Needs permission and a usage review.** OpenAI, Google, Perplexity and Anthropic each publish brand guidelines that restrict modification, colouring and implied endorsement. Until you confirm we may use them (and in what form), I will use **neutral monogram dots** with the platform name as text, which is the current approach (`--platform-*` colours plus labels). Please confirm who owns this check |
| Customer logos / counters | ? | SVG | Only with written permission and real numbers. Is there a real "sites scanned" count we may publish? |
| OG image | 1 template, 2 locales | `opengraph-image.tsx` | Exists, English only; needs zh-HK and the new ring |

## 6. Performance guardrails

- Lighthouse budgets: performance ≥ 90 and accessibility ≥ 95 on landing, result and overview, at mobile and
  desktop. CLS < 0.1.
- `motion` and Recharts are lazy-loaded below the fold, and Recharts is never on the landing hero.
- The hero LCP element is the value line, which is text, so the animation cannot delay LCP.
- Fonts: Latin preloaded, CJK unicode-range only, `display: swap` with size-adjusted fallbacks to avoid CLS.
