# Fimmick AISO — UX audit (Phase 0)

Date: 2026-10-22 · Scope: every route under `app/[lang]` and `app/admin`, every directory in `components/`.
This phase changed no application code. Evidence lives next to this file:

| Evidence | Where |
|---|---|
| Live public pages (28 routes × en/zh-HK × 390/768/1440) + axe + text stats | `screens/public/`, `screens/live-report.json` |
| Real anonymous journey (scan of `aiso-kappa.vercel.app`, timed) | `screens/public/en_scan-progress-*`, `*_result_*`, `screens/journey.json` |
| Signed-in screens (the repo's sanitized component fixtures, rendered with the production CSS build) | `screens/signed-in-fixtures/`, `screens/fixtures-report.json` |
| Route/feature inventory with file:line citations | `appendix/inventory.md` |
| Copy and visual-system counts with file:line citations | `appendix/copy-visual.md` |

**How the signed-in screens were captured.** The product only offers magic-link and Google sign-in, so no
session could be scripted (see CLAUDE.md on `PLAYWRIGHT_TEST_*`). Instead I ran
`scripts/ci/prepare-component-fixtures.mjs` — the same fixture renderer the PR gate uses — against a local
production build, and screenshotted the HTML it emits for Workspace home (C8A), Portfolio (C8B), Pulse
(C8C), Settings (C8G), Entities (C9A), Observations (C9B), Opportunities (C9C), Change-sets (C9D), Delivery
(C9E), Outcomes (C9F), Sources, Question bank, priority cards and auth return. These are the real components
with fixture data, but **without the dashboard sidebar/shell**. Steps not covered by a fixture (Improve, ROI,
Reports, Competitors, Citations, Assets, dashboard result + Fix Pack, Onboarding wizard) are audited from
code only. A real signed-in pass needs a captured session (`npm run e2e:auth:capture`) — I can do that in
Phase 1 if you sign in once.

---

## Executive summary

The engine is strong and honest; the experience around it is not built for an SME owner.

- **The first score is fast and clean**: 2 interactions, about 13 s, no signup. That is the product's best moment.
- **Everything after the score fights the user.** It takes about 10–12 actions to reach the first fix. "Open your
  Fix Pack" goes to an empty portfolio. Onboarding ignores the scan it came from, and then drops a new trial user
  on a locked "see plans" card.
- **The IA mirrors the database, not the job.** There are 13 sidebar items, 3 result views, 2 Pulse views and 3
  differently named ways to "improve". The approval chain (work item → version → decision → delivery →
  outcome) is buried under one draft.
- **The copy is defensive and technical.** It totals 15,939 English words and is heavy with disclaimers
  ("observed", "evidence", "not measured"). Words like llms.txt, JSON-LD, citation density and observations
  appear on the landing page.
- **The visual system is fragmented.** There are three overlapping palettes plus one dormant one, no webfont
  (so CJK falls back to system fonts), no motion library, and a likely dark-mode bug. Only 6 shadcn primitives
  exist, and only 13 files use them.
- **Accessibility is a genuine strength.** axe found **0 WCAG 2.2 AA violations** on all 56 live public URLs, the
  live result page and all 124 signed-in fixtures, and there was no horizontal overflow at 390 px. The
  redesign must not regress this.
- **Monitor is not really live.** See §h, item 4 and the Pulse note in §a.

---

## a) Page and feature inventory, and overlaps

### Route inventory (55 pages)

| Area | Count | Routes |
|---|---|---|
| Marketing (public) | 25 | `/` (landing), `/scan`, `/pricing`, `/sample-report`, `/methodology`, `/how-it-works`, `/platform` + 8 sub-pages, `/solutions` + 4, `/integrations`, `/resources`, `/security`, `/trust`, `/contact` |
| Auth / onboarding / public results | 9 | `/auth/{login,google,complete,logout}`, `/onboarding`, `/result/[id]` (+OG image), `/r/[slug]` (published report), `/admin/authority` (localised stub), `/audit-fixture-error` (E2E only) |
| Dashboard (requireAuth) | 17 pages, 22 views | `/dashboard` (portfolio), `/dashboard/settings`, `/dashboard/[clientId]?step=home\|scan\|results\|improve\|monitor\|roi`, `…/result/[scanId]`, `…/entities`, `…/opportunities`, `…/observations`, `…/sources`, `…/prompts`, `…/competitors`, `…/citations`, `…/assets`, `…/reports`, `…/reports/new`, `…/reports/[reportId]`, `…/work-items/[id]/versions`, `/pulse/[clientId]` |
| Admin (requireAdmin, unlocalised) | 3 | `/admin`, `/admin/billing`, `/admin/accounts/[accountId]/approvers` |
| Root | 1 | `app/page.tsx` → redirect `/en` |

Full table with auth model, components and boundary files: `appendix/inventory.md` §1.

### Concept map: where each feature surfaces

| Concept (code name) | User-facing label | Where it lives | Problem |
|---|---|---|---|
| Scan | Scan / check / diagnostic / audit | landing hero, landing footer, `/scan`, `?step=scan` | 4 entry forms, 4 names |
| Result | Result / results / report | `/result/[id]` (public), `?step=results` (summary), `…/result/[scanId]` (full + Fix Pack) | **3 views of one scan**, using 2 different score widgets |
| Fix Pack | Fix Pack / 修正包 / 修復包 | only `…/result/[scanId]` | not reachable from dashboard scan flow (lands on `?step=results`) |
| Improve / agents | Improve / recommendations | `?step=improve` | copy says "Pro"; catalog grants `agent_recs` to Basic |
| Opportunities → work items | Opportunities / drafts | `/opportunities` with inline `DraftEditor` | separate from Fix Pack and Improve |
| Change-sets (versions) + approvals + delivery + outcomes | versions / decision / delivery / outcomes | one deep page, `/work-items/[id]/versions` | **no list of tasks or pending approvals anywhere in nav** |
| Observations | Observations | `/observations`, Home, Pulse | jargon; depends on Pulse having run |
| Pulse | Monitor / Pulse / AI Pulse | `?step=monitor` **and** `/pulse/[clientId]` (no sidebar) | 2 views; Share of Voice only on the second |
| Sources | "Approved facts" | `/sources` | "sources" also means cited sources |
| Citations | "Cited sources" | `/citations` | collides with the row above |
| Entities | "Brand identity" | `/entities` | route ≠ label |
| Assets | "Registered pages" + Search Console | `/assets` | **no inbound link anywhere** (URL-only) |
| Prompts | Question bank | `/prompts` | Pro-only to edit; onboarding lands here |
| Competitors | Competitors | `/competitors`, Improve (agent), Local Trust, SoV benchmark | **4 places, 2 data sources** |
| Reports | Reports | `/reports*`, `/r/[slug]`, `/sample-report` | report layout implemented 3 times |
| Local Trust / ROI | ROI / Local Trust ROI | `?step=roi` | English left in zh copy |
| Content tools | — | APIs `fix/cluster-map`, `fix/content-brief`, `fix/rewrite-chunks` | **no UI calls them** |

**Overlaps to resolve in Phase 4:**
1. Approvals, change-sets, delivery and work-items are one workflow (a "task" moving through draft → review →
   approved → delivered → measured). Today they have no list view; they are reachable only by opening a draft.
   This is the clearest candidate for the single **Tasks** list.
2. Fix Pack, Improve and Opportunities are three producers of the same thing: "what should I change". The
   marketing site calls all three "Action Studio".
3. Entities, Sources and Assets together describe the brand (identity, approved facts, pages). They belong
   together in Settings → Brand profile, not as three top-level tools.
4. Observations, Citations, Competitors, Share of Voice and Pulse are one "Monitor" surface split five ways.
5. Results: one canonical result view, with the public one as its read-only twin.

**Marketing.** All 20 platform, solutions and company pages share one copy-only template
(`PublicInformationPage`), with no visuals. Two of them, `brand-product-discovery` and `governed-agents`,
present themselves as "planned", although approvals ship. `/contact` has no form, email address or link.
`privacy` and `terms` are marked unavailable, so **no privacy policy or terms page exists** on a site that
collects emails and takes payment. That is a legal/compliance gap to raise beyond UX.

**Navigation.**
- The dashboard sidebar has 13 primary items: 6 `?step=` views of one page plus 7 tool routes, and a
  "Pro" pill.
- Workspace home repeats the sidebar as a tool grid.
- The header row holds only the notification bell. There is no breadcrumb, page title or brand switcher.
- The marketing header collapses to a hamburger below the `xl` breakpoint (1280 px), so tablets and small
  laptops get the mobile menu.

**Monitor / Pulse reality check** (you asked me to report this):
- The committed deployable config (`cloudflare/aiso-worker/wrangler.jsonc:10`) schedules two crons: Pulse daily
  at `17 4 * * *` and alerts on Mondays at `47 7 * * 1`.
- The **last recorded deployed state** (`docs/remediation/2026-10-13/release-checklist.md:25`) has **only the
  weekly alerts trigger**. The Pulse trigger is absent, and `release-operations.md` says "Keep Pulse paused".
- CLAUDE.md also records `prompt_bank` as empty in production. Editing prompts is Pro-only.
- **Net:** for a real customer today, Monitor, Observations, Citations, Share of Voice and the visibility card
  on Home will show empty or "unknown" states. Alerts evaluate a rollup that nothing produces.
- I could not read the live Cloudflare account from this session, so the deployed state comes from the repo's
  own release records. Confirm it in the Cloudflare dashboard (Workers → aiso-cron-worker → Triggers).

**Recommendation for Phase 5:** Monitor should not be presented as live until Pulse is scheduled and a brand
has active questions. Show an honest "Monitoring starts after setup" state instead.

## b) Clicks and time

Measured on production (`journey.json`), 390 px, en, 2026-10-22:

| Milestone | Interactions | Wall time | Notes |
|---|---|---|---|
| Landing loaded | 0 | 1.4 s (DOM) / ~3 s (network idle) | |
| Type URL + click "Run Free Scan" | 2 | 1.6 s | URL input is in the hero; industry/region behind an optional expander |
| **First score visible** (`/result/[id]`) | **2** | **≈13–15 s** | Progress UI is only the button label "Scanning…" plus one sentence. The hero's fake "74 / fimmick.com" preview stays on screen during the scan, which reads as if it were the result |

From score to first fix (from code, `appendix/inventory.md` §4.2), the user takes **≈10–12 actions**,
including an email round-trip and a 4-step wizard:

1. Enter a work email for the magic link, or use the Google popup (1–2).
2. Open the email and click the link. They return to `/result/{id}`, and the scan is claimed (2).
3. Click **"Open your Fix Pack"**. This goes to `/dashboard`, the empty portfolio, **not** to a fix
   (`ResultClient.tsx:349`) (1).
4. Click "first run" to reach onboarding (1).
5. Complete the onboarding wizard. It is meant to skip to step 3 when started from a scan, but that never
   happens: `initialBrand` is hard-coded `''` (`onboarding/page.tsx:28`). So it is always 4 steps (≈4–5).
6. Land on the dashboard result page and click Generate Fix Pack (1).

After that, the Fix Pack is not saved: a reload loses it. Every failure, whether 401, the 20/day limit or a
503, shows the same generic retry message.

From signup to first dashboard, the route is login → email → portfolio (empty) → onboarding (4 steps) →
**`/prompts`**.
- A new account counts as `free` until onboarding starts a 7-day Basic trial.
- Basic has `edit_prompts: false`.
- So **the first screen after setup is a lock card** (inferred from code).
- The free plan has `monthlyScanLimit: 0`, so a signed-in free user apparently cannot scan from the dashboard
  at all. This is inferred and needs product confirmation.

**Target (for Phases 3–5):** first fix within ≤4 actions after the score. That means a Fix Pack preview on the
result page, sign-in only to *save* it, and onboarding that skips straight to "top fixes" when it starts from a
scan.

## c) Jargon, naming and confusing labels

**Product name: you need to decide this** (Phase 8 asks; it also blocks Phase 2 copy).
- Users see "Fimmick AISO" (29×) and "AISO" (56×).
- The README H1 and `package.json` say "Fimmick AEO".
- The category is described five ways: "AI Search Optimization", "AI search readiness", "AI visibility",
  "AI answer engines" and "AEO/GEO".
- zh-HK alternates between AI 搜尋優化, 就緒, 能見度, 可見度 and 曝光.

**Same concept, different names:**

| Concept | Names in UI | Proposal |
|---|---|---|
| The tracked thing | brand (108), website (130), client (45), domain, workspace, account | **Brand** (品牌) everywhere in UI; "client" only for agencies' report recipients |
| The run | scan (153), check (122), diagnostic, audit | **Scan** (掃描) = the run; **check** (檢查) = one of the 20 |
| The output | Fix Pack, fix, recommendation, suggestion, draft, opportunity, work item, Action Studio | **Fix** (修正) for an item, **Fix pack** for the download, **Task** for something in review |
| Monitoring | Pulse, AI Pulse, Monitor, observed AI visibility | **Monitor** (監測) as the nav label; "Pulse" can stay as the feature name |
| Prompt | question (131), prompt, query | **Question** (問題) |
| Score | score, grade, authority, readiness, visibility | **AI visibility score** + letter grade |

zh-HK drift: Fix Pack appears as 修正包, 修復包 and raw "Fix Pack"; monitoring as 監測 and 監察; "Action
Studio", "AI PULSE" and "Local Trust ROI" are left in English.

**Jargon on customer-facing surfaces.** Each term is listed with its plain-language replacement in
`appendix/copy-visual.md` A2. The worst offenders are:

- **Landing** (`home.feature_checks_body`, `home.scan_step4-10`): robots.txt, llms.txt, schema,
  extractability, citation density, factual density, topical authority and chunkability, all in one list.
- **Result** (live):
  - The heading "Consumer AI exposure" sits over five "Not measured" chips, followed by eight raw crawler
    lines such as `OAI-SearchBot · search · Policy: allowed; fetch: not measured`.
  - The score shows a decimal (79.5).
  - "+6 more issues found" sits next to counts of 2 failing and 5 warnings, so the numbers do not reconcile
    on screen.
- **Dashboard home:** "Observed at", "Evidence details", "Insufficient evidence", "Weighted coverage: 0%",
  "Stored scan diagnostic · Methodology 2026-09-05.v2" and "pillars overlap by design". This is auditor
  language on an SME owner's home screen.
- **Stale claim:** `pricing.faq_2_a` says AI Pulse is "planned… when released", while the pricing table
  sells it.

## d) Visual issues

| Area | Finding | Evidence |
|---|---|---|
| Colour | Three overlapping palettes (semantic, `--dash-*` duplicate, `--sidebar-*`) plus a dormant "donor" palette with no dark values. Light primary is blue `#2563eb`, but dark primary is cyan `#00d4ff`, so the two themes read as different brands | `app/globals.css` |
| Colour discipline | 596 raw palette classes (166 distinct) and 82 hex literals, against 1,816 token uses. "Success" appears three ways (token, emerald, green). `ScoreRing` uses hex colours, while `ScoreReveal` uses tokens | appendix B2 |
| Dark mode (**likely bug**) | `globals.css` has no `@custom-variant dark`, so 140 `dark:` utilities follow the OS setting while the tokens follow the user's toggle. They disagree whenever the user's choice differs from the OS | appendix B1 |
| Type scale | 13 Tailwind sizes, plus `text-[9/10/11/12px]` (58 uses) and `.text-2xs`. The `--font-size-*` tokens use the wrong v4 namespace, so they generate nothing. Sizes of 9–11 px are illegible for CJK | appendix B2 |
| Fonts | No webfont is loaded. Inter and Noto Sans TC appear only if installed, so Windows and Android users get Arial plus a system CJK font | `app/layout.tsx` |
| zh-HK typography | No `:lang(zh-HK)` rules, no CJK line-height, no `line-break`/`word-break` policy. 30 `break-all` uses split Latin words mid-word in mixed strings. 58 `uppercase` and 42 `tracking-widest` labels are meaningless or ugly in Chinese | appendix B1 |
| Spacing / radius / shadow | Default Tailwind spacing with no grid tokens. Cards mix `rounded-lg/xl/2xl`. There is no elevation system | appendix B2 |
| Hierarchy | Landing at 1440 has a strong hero, but the following sections are text-card grids of equal weight. The result page stacks six bordered cards of similar weight, so the eye has no single focal point after the ring. Dashboard home is a wall of equal-weight cards (see `signed-in-fixtures/C8A_en-ready_1440.jpg`) | screenshots |
| Mobile | No horizontal overflow on any public page or fixture at 390 px (good). zh-HK landing at 390 px is 6,823 px tall. The marketing header shows the hamburger up to 1279 px | `live-report.json` |
| Two visual languages | Dashboard steps use `dash-*` tokens, while the tool pages, Pulse and portfolio use `muted/card/border`. Pages look different inside one shell | appendix §3 |
| Components | `components/ui` holds 6 primitives (no dialog, tabs, tooltip, progress or skeleton), and only 13 files import them. Score display is implemented ≥7 ways, the locked/upsell card ≥5 ways, and badges ≥4 ways | appendix §3 |

## e) Accessibility (axe-core, WCAG 2.0/2.1/2.2 A + AA tags)

| Surface | Pages | Violations |
|---|---|---|
| Live public pages, en + zh-HK | 56 | **0** |
| Live anonymous result page | 1 | **0** |
| Signed-in component fixtures | 124 | **0** (these are also gated in CI) |

axe does not prove AA on its own. Manual and code-level issues I found:
- **Text sizes of 9–11 px** (58 uses), several of them uppercase with wide tracking. These are legibility
  problems, especially in zh-HK.
- **Score colour carries meaning.** The green/amber/red ring should always be paired with the grade letter
  (it is on the result page; check every new visual).
- **Dashboard 404 and 500 pages render without the dashboard shell.** There is a single `[lang]/error.tsx`, so
  keyboard and screen-reader users lose the sidebar's orientation.
- **The admin billing page is English-only and hard-coded.** It is internal, but worth noting.
- **Not audited:** the dashboard with its real shell, focus order across the sidebar, the onboarding wizard
  and the Fix Pack flow. These need the authenticated pass.

## f) Missing empty, loading and error states

| Pattern | Coverage today |
|---|---|
| `loading.tsx` / skeletons | **1 of 55 pages** (reports). Every other dashboard navigation shows nothing until the server responds |
| `error.tsx` | Only `app/[lang]/error.tsx`. There is no dashboard-scoped boundary (an error drops the sidebar), and none for admin or root (no `global-error.tsx`) |
| `not-found.tsx` | Root and `r/[slug]` only. About 30 dashboard `notFound()` calls render the marketing 404 |
| Errors that crash to the global 500 | `/prompts`, `/competitors`, `/assets` (no try/catch) |
| Unstyled error | `/citations` renders a bare `<p>` with hard-coded EN/ZH |
| Error with retry | Only Entities, Observations, Opportunities and the scan step. Portfolio, Home, Monitor, Results and Fix Pack show a message with no retry, or a generic one |
| Unknown `?step=` | Renders a header with a blank body |
| Scan progress | No progress UI beyond the button label (see §b) |
| Empty states | Present for most lists, but they are text-only cards with no illustration, and several show "0%" style numbers that the fixtures had to guard against |

Per-surface table: `appendix/inventory.md` §5.

## g) Text-heavy areas

Totals across `messages/en.json`: **15,939 English words and 27,040 zh-HK characters**, in 2,593 keys per locale
(key parity is exact). Measured on rendered pages (`live-report.json`, words inside `<main>`):

| Page (en) | Words rendered | Paragraphs > 20 words |
|---|---|---|
| Landing `/en` | 521 | 2 |
| Pricing | 507 | 3 |
| Result (anonymous) | 289 | — |
| Methodology | 286 (5 body strings of 38–55 words each) | 6 |
| Sample report | 203 | 2 |
| Platform / solutions / company pages | 119–172 each | 0–3 |

Heaviest message namespaces by English words:

| Namespace | Words |
|---|---|
| publicPages | 2,058 |
| home | 1,477 |
| dashboard | 1,357 |
| opportunities | 849 |
| sources | 818 |
| seo | 679 |

**Over the text budget**:
- **Headings:** 31 of 221 heading keys exceed 8 words or 14 CJK characters. 19 of those are SEO titles; the
  in-page ones are `home.proof_subheadline` (24 words), `pricing.subheadline` (22) and
  `home.authority_subtitle` (21).
- **Descriptions:** 42 of 160 exceed 20 words, including every dashboard onboarding step (28–35 words).
- **Single strings:** 28 strings are over 30 words. The longest are `methodologyPage.coverage.body` (55),
  `sources.notConnected` (44), `members.approverNote` (41), `assets.intro` (39) and `opportunities.snapshotNotice`
  (36). Most are disclaimers rather than guidance, and they belong in a "Learn more" drawer.
- The full list is in `appendix/copy-visual.md` A4.

**Copy implemented outside next-intl** (this breaks rule 5):
- 39 files use `locale === 'zh-HK' ? … : …` ternaries, and 6 carry inline dictionaries.
- `ResultClient.tsx:38-97` keeps a second check-name map that differs from `checks.*`.
- `r/[slug]`, `AccountUnlockCard`, `OnboardingWizard`, `LoginForm` and the English-only OG image are also
  affected.
- These must move into `messages/` as each surface is rebuilt.

## h) Top 10 problems, ranked by impact and effort

Impact is the effect on the scan → understand → fix → monitor journey for an SME owner. Effort is S (≤1 day),
M (≤1 week) or L (more than a week).

| # | Problem | Impact | Effort | Phase |
|---|---|---|---|---|
| 1 | **Score → fix is broken.** "Open your Fix Pack" goes to an empty portfolio. Onboarding ignores the scan. New users land on a locked prompts page. The Fix Pack is not saved | Very high | S–M (mostly routing and the `initialBrand` bug; the save needs a product decision) | 3/5 |
| 2 | **The result page doesn't tell a story.** The score is followed by "Not measured" ×5, raw crawler lines, contradictory counts and a blurred lock. There are no top-3 fixes, no potential-score bar and no pillar gauges | Very high | M | 3 |
| 3 | **IA sprawl.** 13 sidebar items, 3 result views, 2 Pulse views, 3 "improve" producers, an unlinked `/assets`, and approvals with no list | High | L | 4 |
| 4 | **Monitor is presented as live but is not scheduled** in production. Prompts are empty and editing them is Pro-only. Customers see empty or unknown states | High (trust) | S for the honest state; ops for the real fix | 5 |
| 5 | **Jargon and defensive copy everywhere.** 15.9k words, llms.txt and JSON-LD on the landing page, auditor language on Home | High | M (spread across phases) | 2–5 |
| 6 | **No scan progress feedback.** A ~13 s wait shows only the button label, while a fake "74" preview stays visible | High | S–M | 3 |
| 7 | **No loading or error architecture.** 1 `loading.tsx`, 1 `error.tsx`, three pages that crash to the global 500, and errors that drop the dashboard shell | Medium-high | M | 4–5 |
| 8 | **Fragmented visual system.** Palettes, the dark-mode variant bug, no webfont, ad-hoc type sizes, 6 primitives with ≥7 score widgets | Medium-high | M | 1 |
| 9 | **Naming chaos** across product name, brand/client/site, Fix Pack/Improve/Opportunities, and zh-HK term drift | Medium | S once you decide; M to apply | 1/8 |
| 10 | **Missing trust pages and dead marketing.** No privacy or terms pages, `/contact` has no contact method, two "planned" platform pages, 20 text-only template pages | Medium (conversion and legal) | S–M | 2/8 |

Quick wins I would fold into Phase 1–3 PRs: items 1 (routing part), 6, the dark-mode variant fix, loading a
webfont, and the stale `pricing.faq_2_a`.

## Decisions

Decided 2026-10-22:
- **Product name: "Fimmick AISO"** everywhere: UI, metadata, llms.txt, README (Phase 8). `package.json`'s
  `fimmick-aeo` is an internal identifier and stays.
- **Monitor is hidden** from the new navigation until Pulse is scheduled in production and a brand has active
  questions. The routes stay reachable by URL and the code stays in place, so it can be switched back on
  with one flag. Onboarding drops its "turn on weekly Pulse" step, and Overview shows no AI-visibility card.
- **Later phases use `ux/phase-N-name` branches.**

Still open:
1. **Category term.** For example "AI visibility" (AI 能見度)?
2. **Fix Pack without signup.** Phase 3 wants a "Generate fix pack" action in the result drawer. Today `/api/fix`
   requires sign-in. Is a read-only preview of the top fix for anonymous users acceptable, or must generation
   stay behind sign-in?
3. **Marketing surface.** Should the 20 platform/solutions/company pages be kept, merged into the new landing
   page plus a few pages, or redirected? (Old→new map proposal is in `target-ia.md`.)
4. **Local Trust / ROI placement.** The proposal is an Overview section plus Reports.
5. **AI platform logos.** Who confirms usage rights? Until then the design uses neutral dots with the
   platform name.
