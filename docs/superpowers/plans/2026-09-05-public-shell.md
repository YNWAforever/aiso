# Public shell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One shared shell for the public site — header, nav, footer, landmarks — so the ~17 Phase 2
pages have somewhere consistent to render, and home and pricing stop drifting apart.

**Architecture:** A `(marketing)` route group. The IA lives as typed data with tests that stop it
lying. The move and the extraction are separate commits so the second diff is readable.

**Tech Stack:** Next.js 16 App Router, next-intl 4, Tailwind v4, Vitest 4, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-05-public-shell-design.md`

**Branch:** `claude/phase2-public-shell` (exists; holds the spec at `16d1598`).

---

## Background the implementer needs

### Why this exists

`app/[lang]/page.tsx` and `app/[lang]/pricing/page.tsx` each carry their own inline `<nav>` and
`<footer>`. They drifted: home used `bg-background/95`, pricing had a hardcoded `bg-white/90`, and the
pricing page rendered white-on-near-black in dark mode until 2026-09-05. One copy was fixed. The other
existed because there was nowhere shared to put it.

There are **zero** nav or layout components in the repository today.

### The authoritative route list

From `docs/contracts/routes.md`, which is frozen and explicitly authoritative — *"changes require a
plan amendment, not a silent edit here."* Do **not** take routes from the base plan's §9.1/§9.2
narrative; that file records its own counts as a pre-existing inconsistency (changelog D15).

**Platform (9):** `/platform`, `/platform/search-intelligence`, `/platform/site-health`,
`/platform/demand-intelligence`, `/platform/brand-product-discovery`, `/platform/ai-visibility`,
`/platform/action-studio`, `/platform/governed-agents`, `/platform/proof`

**Solutions (5):** `/solutions`, `/solutions/sme`, `/solutions/agencies`, `/solutions/enterprise`,
`/solutions/regulated-industries`

**Standalone (7):** `/how-it-works`, `/resources`, `/methodology`, `/security`, `/privacy`, `/terms`,
`/contact`

**Exists today (2):** `/` and `/pricing` — the only two that start `available: true`.

> `/platform/search-visibility` is an **alias only** and never appears in `publicRoutes`. It must not
> enter the config. Adding it would create a nav entry for a route that will never exist.

### Current layouts

| file | what it does |
|---|---|
| `app/layout.tsx` | root; inline script adds `.dark` from `localStorage.theme` or `matchMedia` |
| `app/[lang]/layout.tsx` | `NextIntlClientProvider`, `setRequestLocale`, `generateMetadata` |
| `app/[lang]/pricing/layout.tsx` | **metadata only** — component is `<>{children}</>` |
| `app/[lang]/dashboard/layout.tsx` | its own chrome; **not** in scope |

The marketing layout nests inside `[lang]/layout.tsx`, so `useTranslations` works with no new plumbing.

### Hard constraints

- **`git add -A` is forbidden**, except where Task 2 explicitly permits it for a scoped rename.
- **Never hardcode a user-facing string.** Every label is a key resolved through next-intl, present in
  **both** `messages/en.json` and `messages/zh-HK.json`.
- Do not touch `dashboard`, `auth`, `onboarding`, `admin`, `r/` or `result/[id]`.
- Do not build a theme toggle. Out of scope, recorded in the spec.
- Do not regenerate `tests/e2e/a11y/baseline.json` before Task 4, and never to hide a count that
  failed to fall.
- `.playwright-ci-server/` is a generated copy of the repo that vitest still collects, roughly doubling
  reported test counts and contributing ~18 failing files that are **not yours**. Report counts
  honestly and say which failures come from there.

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `lib/navigation.ts` | The IA as typed data | Create |
| `__tests__/lib/navigation.test.ts` | Config invariants | Create |
| `app/[lang]/(marketing)/layout.tsx` | The shell | Create |
| `components/marketing/SiteHeader.tsx` | Nav, dropdowns, locale switcher | Create |
| `components/marketing/SiteFooter.tsx` | Footer | Create |
| `app/[lang]/(marketing)/page.tsx` | Home, moved | Move |
| `app/[lang]/(marketing)/pricing/page.tsx` | Pricing, moved | Move |
| `app/[lang]/(marketing)/pricing/layout.tsx` | Pricing metadata, moved | Move |
| `messages/en.json`, `messages/zh-HK.json` | Nav and footer labels | Modify |
| `docs/primitives-audit.md` | What the shell needed, what is still missing | Create |
| `tests/e2e/a11y/baseline.json` | Regenerated in Task 4 only | Modify |

---

### Task 1 — the IA as data, with tests that stop it lying

**Files:**
- Create: `lib/navigation.ts`
- Create: `__tests__/lib/navigation.test.ts`
- Modify: `messages/en.json`, `messages/zh-HK.json`

- [ ] **Step 1: Write the failing tests**

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NAV } from '@/lib/navigation'

const en = JSON.parse(readFileSync(join(process.cwd(), 'messages/en.json'), 'utf8'))
const zh = JSON.parse(readFileSync(join(process.cwd(), 'messages/zh-HK.json'), 'utf8'))

function lookup(messages: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) =>
    (node && typeof node === 'object') ? (node as Record<string, unknown>)[part] : undefined, messages)
}

function exists(path: string): boolean {
  try { readFileSync(path); return true } catch { return false }
}

it('has at least one available entry', () => {
  expect(NAV.filter((e) => e.available).length).toBeGreaterThan(0)
})

it('resolves every available href to a real route', () => {
  // The flag polices itself: an entry marked available whose page does not
  // exist would ship a 404 in the site header, on every page of the site.
  const missing = NAV.filter((e) => e.available).filter((e) => {
    const seg = e.href === '/' ? '' : e.href
    return !exists(join(process.cwd(), 'app/[lang]/(marketing)', seg, 'page.tsx'))
      && !exists(join(process.cwd(), 'app/[lang]', seg, 'page.tsx'))
  })
  expect(missing.map((e) => e.href)).toEqual([])
})

it('has an en label for every entry', () => {
  expect(NAV.filter((e) => lookup(en, e.labelKey) === undefined).map((e) => e.labelKey)).toEqual([])
})

it('has a zh-HK label for every entry', () => {
  // A key missing here renders as the raw key to half the audience, and no
  // English-speaking reviewer would notice.
  expect(NAV.filter((e) => lookup(zh, e.labelKey) === undefined).map((e) => e.labelKey)).toEqual([])
})

it('never lists /platform/search-visibility, which is an alias and not a route', () => {
  expect(NAV.map((e) => e.href)).not.toContain('/platform/search-visibility')
})

it('has no duplicate hrefs', () => {
  const hrefs = NAV.map((e) => e.href)
  expect(hrefs.length).toBe(new Set(hrefs).size)
})
```

Run it. Expected: **FAIL**, module not found.

- [ ] **Step 2: Write `lib/navigation.ts`**

```ts
export type NavSection = 'top' | 'platform' | 'solutions' | 'company'

export type NavEntry = {
  section: NavSection
  labelKey: string
  href: string
  /** Render only when true. See __tests__/lib/navigation.test.ts — an entry
   *  marked available whose route does not exist fails the suite. */
  available: boolean
}
```

Export `NAV: NavEntry[]` containing **all 23 routes** listed above. Only `/` and `/pricing` are
`available: true`; every other entry is `available: false` until its slice builds it.

Label keys go under a `nav.` namespace, e.g. `nav.platform.searchIntelligence`.

- [ ] **Step 3: Add the labels to both message files**

Every key in `NAV`, in `messages/en.json` **and** `messages/zh-HK.json`, matching each file's existing
nesting style.

If you cannot write a genuine zh-HK translation for a term, **say so in your report** rather than
pasting the English string. A silent English fallback inside the Chinese file is worse than a flagged
gap, because nothing will ever surface it again.

- [ ] **Step 4: Run and commit**

```bash
npx vitest run __tests__/lib/navigation.test.ts
```

All pass.

```bash
git add lib/navigation.ts __tests__/lib/navigation.test.ts messages/en.json messages/zh-HK.json && git commit -F- <<'EOF'
feat(nav): declare the public IA once, as typed data

Phase 2 adds roughly seventeen pages. Adding nav entries slice by slice would
mean designing the dropdown structure for nine platform pages in slice 2.6,
with fourteen pages already depending on the header's shape. Declaring it now
costs one file and settles it while it is still cheap to change.

Only / and /pricing are available; everything else is declared and hidden. A
test resolves every available href to a real page file, so the flag polices
itself rather than relying on someone remembering -- an entry flipped on too
early would put a 404 in the header of every page on the site.

Routes come from docs/contracts/routes.md, which is frozen and authoritative.
The base plan's own 9.1 narrative disagrees with its 9.2 table and records that
as a pre-existing inconsistency, so it is not the source.
/platform/search-visibility is deliberately absent: it is an alias, never a
route, and a nav entry for it could never resolve.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 2 — move the pages, changing nothing else

**Files:**
- Move: `app/[lang]/page.tsx` → `app/[lang]/(marketing)/page.tsx`
- Move: `app/[lang]/pricing/` → `app/[lang]/(marketing)/pricing/`

This task exists **only** so the next diff is readable. A move plus an edit in one commit is
unreviewable: nobody can tell which lines moved and which changed.

- [ ] **Step 1: Move with `git mv`**, so git records renames rather than delete-plus-add.

Move all three files: `page.tsx`, `pricing/page.tsx`, `pricing/layout.tsx`.

**`pricing/layout.tsx` must come too.** It is metadata-only — its component is `<>{children}</>` — and
leaving it behind silently drops that route's `generateMetadata`.

- [ ] **Step 2: Prove nothing changed but location**

```bash
git diff --cached -M --stat
```

Expected: renames only, **zero** content lines changed. If any file shows modifications, undo them —
they belong in Task 3.

- [ ] **Step 3: Prove the URLs did not move**

```bash
npm run build
```

Confirm the route list still shows `/[lang]` and `/[lang]/pricing`. A route group is not a path
segment, so the URLs must be identical. If `(marketing)` appears in any emitted route, the group is
misnamed.

- [ ] **Step 4: Commit**

```bash
git add -A "app/[lang]" && git commit -F- <<'EOF'
refactor(routes): move home and pricing into a (marketing) route group

Location only -- no content changes, so the shell extraction that follows is a
readable diff rather than a rename tangled up with an edit.

Route groups are not path segments, so /en/pricing is still /en/pricing.
pricing/layout.tsx moves with the page: it is metadata-only, and leaving it
behind would silently drop that route's generateMetadata.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

`git add -A` is permitted **here only**, scoped to that one path, because a rename must be staged as a
pair. Everywhere else in this plan, name files explicitly.

---

### Task 3 — the shell

**Files:**
- Create: `app/[lang]/(marketing)/layout.tsx`
- Create: `components/marketing/SiteHeader.tsx`
- Create: `components/marketing/SiteFooter.tsx`
- Modify: the two moved pages, to delete their inline chrome

- [ ] **Step 1: Read both pages' existing chrome first**

Read the `<nav>` / `<header>` / `<footer>` in both moved pages. **Report what differs between them
before writing the shared version.** Those differences are decisions you are about to make on someone
else's behalf, and at least one of them was a bug.

- [ ] **Step 2: Write the layout**

```tsx
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main">{children}</main>
      <SiteFooter />
    </>
  )
}
```

The landmarks are the point, not decoration. `region` (160) and `landmark-one-main` (32) are 192 of
the 288 remaining accessibility violations, and both describe content sitting outside a landmark.
`<main>` must wrap **all** page content, and `SiteHeader` must render a `<header>` containing a
`<nav>`.

- [ ] **Step 3: Build the header**

Renders `NAV.filter(e => e.available)`, grouped by section. Requirements:

- **The locale switcher preserves the path.** `/zh-HK/pricing` → `/en/pricing`, never `/en`. Use
  `usePathname()` and swap the first segment. A switcher that drops the reader at the root loses their
  place silently.
- Both locales render as **real links**, not a `<select>`, so the alternate URL is crawlable and
  consistent with the `hreflang` alternates `lib/seo.ts` already emits.
- Use `bg-background/95` for the sticky bar — home's existing value. Pricing's `/90` came from the
  dark-mode fix; home is the older and more widely seen surface. Pick one, and say in the commit which
  you picked.
- Every label through `useTranslations`. No literals.

- [ ] **Step 4: Build the footer** the same way, drawing from `NAV` where applicable.

- [ ] **Step 5: Delete the inline chrome from both pages**

Remove the `<nav>` and `<footer>` blocks and any now-unused imports. Do not otherwise restructure the
pages.

- [ ] **Step 6: Verify with computed styles, not by eye**

Start the preview, load `/en` and `/en/pricing`, and compare the **computed** background colour,
height and position of the header on both. They must now be identical — that is the defect this slice
exists to close. Repeat in dark mode.

Report the measured values.

- [ ] **Step 7: Static checks, then commit**

```bash
npm run lint
```
```bash
npm run typecheck
```
```bash
npm run build
```
```bash
npm run test:unit
```

All exit 0.

---

### Task 4 — accessibility: measure, then decide

**Files:**
- Modify: `tests/e2e/a11y/baseline.json` — **only if the counts move the right way**

- [ ] **Step 1: Record the before numbers**

```bash
node -e '
const b=require("./tests/e2e/a11y/baseline.json").accepted;
let t=0,byRule={};
for(const k in b)for(const r in b[k]){t+=b[k][r];byRule[r]=(byRule[r]||0)+b[k][r]}
console.log("total",t,JSON.stringify(byRule));'
```

Expected: `total 288 {"color-contrast":48,"landmark-one-main":32,"page-has-heading-one":48,"region":160}`

- [ ] **Step 2: Observe without writing**

Run the four a11y projects with `A11Y_UPDATE_BASELINE=1` and `CI=true`. The full environment is in
`docs/superpowers/plans/2026-09-04-muted-foreground-contrast.md` Task 3. **`CI=true` is required** — it
selects the isolated workspace that excludes `*.local`, so the numbers are the ones the gate will see.

Classify every cell as improved or exceeded **before** touching `baseline.json`.

- [ ] **Step 3: Judge the result honestly**

**`region` and `landmark-one-main` should fall substantially.** The spec commits to this.

- If they fell: regenerate, and report before/after per rule.
- **If they did not fall, the landmarks are wrong.** That is the finding. Fix the markup and
  re-measure. Do **not** regenerate a baseline that records the failure as accepted.
- If any cell is **exceeded**, stop and report. Something regressed; baselining it would grant it
  amnesty.

- [ ] **Step 4: Confirm the gate passes on its own**, then commit with the before/after table in the
message.

---

### Task 5 — record the primitives audit

**Files:**
- Create: `docs/primitives-audit.md`

- [ ] **Step 1:** List what `components/ui/` holds (6 today) and which of them the shell used.

- [ ] **Step 2:** Record what is **missing** for the 17 upcoming pages — and build **none** of it. A
primitives backlog is an input to later slices; building primitives nothing renders is how a design
system accumulates dead code.

- [ ] **Step 3:** Commit.

---

## Finishing

- [ ] `npm run lint` · `npm run typecheck` · `npm run build` · `REQUIRE_INTEGRATION_TESTS=1 npm test`
- [ ] Push; open a PR leading with the before/after accessibility numbers and the computed-style proof
      that home and pricing now share one header
- [ ] **Verify CI against the pushed HEAD** — compare `gh run list --json headSha` with
      `git rev-parse HEAD`. A green run on a different SHA is not evidence.
