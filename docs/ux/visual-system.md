# Visual system — SME copilot surfaces

Status: approved 2026-11-12 with the design spec (`docs/ux/sme-copilot-redesign.md`).
This file is the source of truth for the visual rules used by Today, Chat, What AI says,
Improve, Reports and the account menu. Existing tokens live in `app/globals.css`; the
gallery is `/{lang}/dev/design-system` (404s only in production).

## 1. Foundations

- **Tokens, not literals.** Use semantic tokens: `bg-background`, `text-foreground`,
  `border-border`, `bg-card`, `text-muted-foreground`, `text-primary`,
  `text-primary-accessible`, `ring-ring`, `tone-*` pairs, `shadow-e1/e2/e3`,
  `text-display`, `ease-standard`, `neutral-1…12`. No raw hex in new components except
  the branding colour already stored per report.
- **Legacy `--dash-*` / `--sidebar-*` do not appear in redesigned surfaces.** They stay
  while old pages exist; each redesigned page migrates to semantic tokens.
- **One accent per screen.** `primary` (or `primary-accessible` for text) marks the one
  primary action. Secondary actions are outline buttons or text links.
- **Radii**: `--radius` family (sm/md/lg/xl). Cards use `rounded-2xl`; controls use
  `rounded-lg`/`button` primitive defaults. Do not invent new radii.
- **Dark mode** follows the `.dark` class (`@custom-variant dark`), never `prefers-color-
  scheme`. `shadow-e1/e2/e3` become hairline rings in dark by token design — never add
  a manual dark shadow.

## 2. Type and spacing

- Page title: `text-2xl font-bold tracking-tight` (or `text-display` for a single hero
  number on Today). Section title: `text-lg font-bold`. Body: `text-sm leading-6`.
  Meta: `text-xs text-muted-foreground`. Nothing below 12 px in dashboards.
- zh-HK: line-height and line-break come from the `:lang(zh-HK)` base layer; do not add
  letter-spacing/uppercase to Chinese. No CJK webfont.
- Spacing scale: 4/8-based (`gap-2/3/4/5/6`, `p-4/5/6`, `space-y-...`). One screen uses
  one page padding (`px-4 sm:px-6`, `py-8`), one card padding (`p-5 sm:p-6`), one stack
  gap (`space-y-6` or `space-y-8`).
- Max-width: content pages `max-w-6xl`; Today/Chat reading columns `max-w-4xl`; never
  full-bleed tables without a scroll container (`relative` + `tabIndex={0}` + region
  label when horizontally scrollable).

## 3. Card hierarchy (the fix for "14 equal blocks")

Every screen has at most three visual tiers:

1. **Primary card** (`shadow-e2`, one per screen): the recommended action on Today; the
   composer + skills on Chat. Only one element may use the primary button style.
2. **Supporting cards** (`rounded-2xl border border-border bg-card shadow-e1`): at most
   three, one plain-language number or status each.
3. **Disclosure** (`<details>` or a tab): evidence, receipts, trends, checks, history,
   setup checklists, tools. Never rendered as another equal card.

Rules:

- A card has one heading and at most one primary action. Two competing CTAs in one card
  means one belongs in the disclosure.
- Status uses a badge or one sentence, not a colour-only cue. Every colour has a text
  label and an icon where space allows.
- Empty/error/locked are three distinct states with the patterns in §5 — never a blank
  card and never a fake zero.

## 4. Components to standardise (audit found re-implementations)

| Pattern | Canonical component | Replaces |
| --- | --- | --- |
| Page header (title, description, actions, breadcrumbs) | `components/ui/page-header` | 12 hand-rolled headers with five eyebrow variants |
| Plan lock | new `components/ui/plan-lock` (icon, title, honest body, upgrade button, lock list) | 5 copy-pasted blocks + `LockedFeature` |
| Empty state | `components/ui/empty-state` (+ illustration set) | 4 inline `<p>`/`<main>` variants |
| Error / retry | new `components/ui/error-state` (role=alert, retry link, "could not tell" copy) | 3 shapes |
| Stat | `components/ui/stat-card` (value, delta, sparkline, href) | MonthRecord/MonthQueue grids |
| Table | `components/ui/data-table` (caption, empty slot, filter) | card grids where rows would read better |

Each component gets a gallery entry and one render test. New pages use the canonical
component from day one; old pages migrate in their slice, not all at once.

## 5. Honesty patterns (do not "simplify" these away)

- Saved vs LIVE answers stay two visually distinct surfaces; LIVE is labelled
  "Live model output, not verified" and marked exhausted at quota.
- 未有／未記錄／未連接 and `PROVIDER_UNAVAILABLE` keep their exact meaning in both
  locales; a failed read renders as "未能讀取／暫時無法確認", never `0` or `0%`.
- "Freshness: unknown" survives; records never claim delivered improvement or attributed
  outcome. Evidence (`receipts`, observation/scan ids, digests, coverage) moves behind
  「詳情／進階」, not out of the product.
- Copy must pass `npm run audit:text` (no guarantee/was cited/rank #1 claims, no bare
  "AISO" product naming, zh-HK differs from English) and the Studio guardrail test
  (no vendor/model names in operator copy).
- One vocabulary per concept, per the glossary in the design spec §8: 優化建議 / 待辦 /
  機會, AI 提及率 / AI 能見度, 可分享報告 / 月度報告, 對話 (thread = conversation).

## 6. Accessibility requirements (definition of done per slice)

- axe (`wcag2a/wcag2aa/wcag21aa/wcag22aa`) zero violations on new offline fixtures for
  Today, account Today, Chat, and every new tab in both locales, light and dark.
- Dashboard routes are currently **outside** the a11y matrix; each slice adds its
  fixture to `tests/e2e/a11y/` (or an offline-fixture spec) so this cannot regress.
- Focus: visible `focus-visible` ring on every interactive element; dialogs return focus;
  one `aria-current="page"` in navigation; skip link stays first.
- Targets: `min-h-11` (44 px) for primary controls; dense nav sub-items may be 36 px only
  outside touch-first surfaces, and the audit's 36 px nav exceptions are fixed in slice 1.
- Contrast: new foreground/background pairs are added to `design-tokens.test.ts`'s
  pairing list *before* use; text pairs clear 4.5:1, non-text UI 3:1.
- Motion: use `MotionRoot` / `useReducedMotion`; no transform/opacity animation without a
  reduced-motion resting state; reveal utilities only animate while scripting and
  `prefers-reduced-motion: no-preference` both allow it.
- Scrollers: `relative` wrapper + `tabIndex={0}` + region label; `sr-only` never inside a
  non-positioned scroller (it widened pages by 29 px at 375 px before).
- Heading order: one `h1` per page, sections use `aria-labelledby` pointing at their
  heading; preserve existing e2e-pinned ids (`priorities-heading`, `#studio-composer`,
  `#studio-home`, `#studio-discussion`, `.as-*`, `role=log` on thread view only).

## 7. Motion and feedback

- One curve (`ease-standard`), durations from `lib/motion.ts`; no bounce, no looping
  decoration on data pages.
- Loading uses `Skeleton`/`SkeletonText` shaped like the final content; no spinner-only
  page loads, no layout shift when data lands.
- Writes show optimistic belt-and-braces: pending state → success toast only after the
  server confirms; failure shows the honest error and keeps the user's input.
- Charts follow `components/visuals/*` and MotionRoot; print styles stay on
  `OnePageReport` / `PublicMonthlyReport` (A4, `print:hidden` controls).

## 8. Review checklist for each slice PR

1. One primary card and one primary button per screen; everything else in a disclosure.
2. No more than three numbers on a home screen; each links somewhere meaningful.
3. All old URLs and e2e hooks still resolve; axe fixtures for changed surfaces.
4. Tokens only; `--dash-*` count in changed files does not increase.
5. Glossary applied in both locales; honesty clauses intact; `npm run audit:text` passes.
6. Screenshots at 375 and 1440, light and dark, en and zh-HK attached to the PR.
