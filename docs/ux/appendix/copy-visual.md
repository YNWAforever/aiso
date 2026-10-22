# Phase 0 UX audit: copy and visual system (read-only)

Audited 2026-10-22. Nothing in the repo was edited.

---

## Part A: Copy

### A1. Product naming

The name the user sees is mostly **"Fimmick AISO"**. The repo, the README and the category language still say AEO and GEO.

| Term | en.json | zh-HK.json | app/+components .ts(x) | README.md | package.json |
|---|---|---|---|---|---|
| Fimmick AISO | 29 | 29 | 12 | 0 | 0 |
| AISO (any) | 56 | 56 | 29 | 0 | 0 |
| Fimmick AEO | 0 | 0 | 0 | 1 (H1) | `"name": "fimmick-aeo"` |
| AEO | 1 (`result.extended_checks_subtitle` "AEO signals…") | 1 | 6 | 2 | – |
| GEO | 10 (home ×7, result ×2, publicPages ×1) | 10 | 34 (mostly identifiers) | 2 | – |
| AI visibility / AI Visibility | 9 | – | 5 | – | – |
| AI search (readiness/visibility) | 8 | – | 4 | – | – |
| answer engine | 2 | – | – | 1 | – |
| AI SEO | 0 | 0 | 0 | 0 | 0 |
| "AI Search Optimization" | `nav.tagline` | "AI 搜尋優化" | | | |

- **Root metadata** (`app/layout.tsx:8-9`) is hardcoded English, "Fimmick AISO — AI Search Readiness Check / …Free Fix Pack included." It does not go through i18n. Localised pages override it through `lib/seo.ts` (`buildLocalizedMetadata`). The `seo.*` titles all end in "| Fimmick AISO".
- **`/llms.txt`** is a route (`app/llms.txt/route.ts`), not a file in `public/`. It says "# Fimmick AISO … AI readiness checks".
- **The product is described with at least five category names:** "AI Search Optimization" (tagline), "AI search readiness" (scan/SEO titles), "AI visibility" (nav, pricing), "AI answer engines" (footer), and "AEO/GEO" (result page check groups). zh-HK uses AI 搜尋優化 / 就緒 / 能見度 / 可見度 / 曝光.
- **Sub-brands:** "AI Pulse" / "Pulse" (35 en), "Fix Pack" (11), "Action Studio" (left untranslated in zh), "Authority score" (home, 22 uses of "authority"), and "Governed agents".
- **Stale claim:** `pricing.faq_2_a` says "AI Pulse is our *planned* weekly share-of-voice tracker. When released…". Pulse is live, though, and `pricing.row_monitoring` sells it.

### A2. Jargon in UI copy (en.json key counts, with suggested plain-language replacements)

| Term | Keys | Where | Suggested plain replacement |
|---|---|---|---|
| llms.txt | 22 | checks 10, home 7, pricing 2, publicPages 2 | "AI guide file (llms.txt)": lead with the benefit and keep the filename secondary |
| robots(.txt) | 15 | home 7, checks 3, pricing 2 | "crawler access rules" |
| JSON-LD | 11 | home 4, pricing 2, checks 2 | "FAQ markup that AI can read" |
| schema | 10 | checks 6, trustSignals 2 | "structured business info" |
| citation density | 8 | home 4, checks 3, result 1 | "How often you back claims with sources" |
| factual density | 8 | home 3, checks 4 | "Facts and figures per page" |
| extractability | 9 | home 4, checks 4 | "Easy for AI to quote" |
| chunkability | 5 | home 2, result, checks | "Broken into clear sections" |
| topical authority | 7 | home 3, checks 3 | "Depth of coverage on your topic" |
| entity / entities | 7 (plus an entire `entities` namespace of 40 keys) | checks 4 | "Business identity details (name, address, brand)" |
| canonical | 6 | checks 4, home, runProgress | "Preferred page address" |
| sitemap | 7 | checks 6 | "Site map for search engines" (fine with a gloss) |
| SoV / share of voice | 5 / 10 | dashboard 4, pulse, shareOfVoice 3 | "How often AI mentions you vs competitors" |
| observation(s) | 58 | publicPages 15, observations 8, seo 6 | "AI answer samples" |
| evidence | 113 | opportunities 22, outcomes 13, home 11 | Fine in moderation; it saturates opportunities/outcomes |
| classif* | 35 | runProgress 8, observations 8 | "checked / sorted" |
| coverage | 23 | methodologyPage 6, reports 4 | "How much we could check" |
| pillar | 8 | methodologyPage 4 | "Area" |
| snapshot / provenance | 7 / 2 | dashboard, outcomes | "saved copy" / "where this came from" |
| agent(s) / governed agents | 30 / 2 | dashboard 11, sources 11 | "AI assistant" / "AI drafts you approve" |
| source version / approver | 8 / 7 | sources, approverAccess | "approved copy of your content" / "reviewer" |
| E-E-A-T | 1 | `trustSignals.title` | "Trust signals" |
| GEO / AEO as headings | 10 / 1 | home, `result.geo_checks_title` "GEO CONTENT CHECKS" | "Content quality for AI" / "Extra technical signals" |

hreflang, MCP, "change-set" and "remediation" do not appear in UI copy. They are namespace or route names only.

The heaviest jargon page is **home** (`home.feature_checks_body` lists robots.txt, llms.txt, bot access, schema, extractability, citation density, factual density, topical authority and chunkability in one string). The home scan-progress steps (`home.scan_step4-10`) are the same.

### A3. Inconsistent labels

Counts are en keys containing each term.
- **The tracked entity:** brand 108, site/website 130, client 45 (reports 23, publicPages 9), domain 24, workspace 36, account 35. The dashboard route is `[clientId]`. The UI says "brand" in dashboard/portfolio and "client" in reports. zh: 品牌 130, 客戶 65, 網站 142, 工作區 37.
- **The run:** scan 153, check 122, diagnostic 14, audit 2, report 89. Users are told to "run a 20-check diagnostic" (`dashboard.step_scan_body`), a "scan" (nav), and a "website check" (`generatedWork`). zh: 掃描 164, 檢查 126, 審核 21, 診斷 14, 檢測 6.
- **The output:** fix pack 12, fix 43, recommendation 16, suggestion 24, draft 97, opportunity 6, work item 6. One concept appears as "Fix Pack", "Improve", "Action Studio", "Opportunities", "Generated work" and "Recommendations".
- **Monitoring:** Pulse 35, AI Pulse 8, monitor* 48. The data unit is question 131, prompt 14, query 9.
- **Score:** score 62, grade 17, authority 32, readiness 38, visibility 25 ("100-point authority score" on home, "readiness score" in faq and OG image).
- **zh-HK term drift:**
  - Fix Pack appears as 修正包 (2), 修復包 (7) and the raw "Fix Pack" left in zh (3: `home.step3_body`, `home.feature_fixpack_title`, `home.proof_capability_fix_title`).
  - Visibility appears as 能見度 (19), 可見度 (8) and 曝光 (7). `pulse.sov` is 品牌曝光率.
  - Monitoring appears as 監測 (46) and 監察 (10).
- **Untranslated in zh** (identical to en): `nav.platform.action_studio`, `home.pulse_label` "AI PULSE", `pulse.title`. Also "Local Trust ROI" sits inline in zh (`dashboard.step_roi_locked`, `dashboard.setup_local_trust`).
- **Key parity:** en 2,593 keys and zh 2,593 keys, with **0 missing either way**.
- **ICU mismatches (3):**
  - `dashboard.trial_remaining`: zh drops the plural form. This is harmless in Chinese but differs structurally.
  - `dashboard.local_trust_actions_ready` and `local_trust_competitor_signals`: zh writes "1" literally where en uses `#`. Harmless.
- **Punctuation:** 3 zh strings use half-width punctuation after CJK (`outcomes.comparisonLimitation`, `outcomes.comparisonStatuses.*`).
- **Duplicate label sources:** `components/result/ResultClient.tsx:38-66` has its own check-name map ("Content extractability"). `messages/en.json` has "Content Extractability" (`checks.c5_extractability`). Case and wording differ.

### A4. Text volume

Totals: **15,939 English words and 27,040 CJK characters** across 47 namespaces.

| Namespace | Keys | en words | zh chars | Page(s) |
|---|---|---|---|---|
| publicPages | 149 | 2,058 | 3,288 | (marketing)/platform/*, solutions/*, trust, security… |
| home | 237 | 1,477 | 2,299 | (marketing)/page.tsx, ScanForm |
| dashboard | 281 | 1,357 | 2,426 | dashboard/[clientId], TrialBanner, AlertsTab, Agent* |
| opportunities | 138 | 849 | 1,512 | dashboard/[clientId]/opportunities |
| sources | 123 | 818 | 1,383 | SourcePackWorkspace |
| seo | 50 | 679 | 982 | lib/seo.ts metadata |
| pulse | 121 | 612 | 987 | dashboard/[clientId]/prompts, QuestionBank |
| reports | 111 | 558 | 989 | dashboard/[clientId]/reports |
| pricing | 86 | 513 | 845 | (marketing)/pricing |
| outcomes | 93 | 491 | 904 | OutcomeWorkspace |
| searchConsole | 54 | 458 | 648 | integrations |
| generatedWork | 49 | 405 | 729 | FixPackBlock, ImproveStep |
| workspaceHome | 77 | 385 | 683 | WorkspaceHome |
| members | 46 | 376 | 583 | MembersPanel |
| methodologyPage | 13 | **286 (22/key)** | 528 | (marketing)/methodology |

The remaining namespaces are smaller (under 400 words each).

**25 longest single strings (en words):**
- methodologyPage.coverage.body 55
- methodologyPage.gates.body 52
- methodologyPage.history.body 46
- sources.notConnected 44
- methodologyPage.limits.body 42
- members.approverNote 41
- pricing.faq_3_a 40
- assets.intro 39
- methodologyPage.pillars.body 38
- opportunities.snapshotNotice 36
- pricing.bottom_body 35
- dashboard.step_results_body 35
- members.removalNote 35
- competitors.intro 35
- citations.intro 35
- sampleReport.limitsBody 34
- home.faq_a2 33
- pricing.faq_1_a 33
- dashboard.local_trust_timeline_limitation 33
- sources.gate 33
- shareOfVoice.intro 33
- pricing.free_account_body 32
- pricing.faq_4_a 32
- dashboard.local_trust_timeline_movement 32
- members.howItWorks 32

28 strings are over 30 words and 2 are over 50. Many of the long strings are in-product intros and caveats ("Estimated, not observed…", "These are imports, not connections…"). These are defensive disclaimers, not task guidance.

**Headings over budget.** 221 heading keys were checked and 31 are over (>8 words or >14 CJK chars). 19 of the 31 are `seo.*.title` and include the "| Fimmick AISO" suffix. The in-UI offenders:
- `home.proof_subheadline` 24w / 43c
- `pricing.subheadline` 22w / 30c
- `home.authority_subtitle` 21w / 33c
- `home.features_subtitle` 19c
- `home.how_subtitle` 17c
- `result.geo_checks_subtitle` 17c
- `publicPages.solutions_agencies.title` 15c
- `generatedWork.basisTitle` 15c
- `pricing.enterprise_custom_title` 10w
- `citations.gaps_title` 9w
- `home.subheadline` 10w

**Descriptions over 20 words.** 160 description/body/intro keys were checked and 42 are over.
- By namespace: home 9, seo 6, dashboard 6, methodologyPage 5, pricing 3, sampleReport 2, and one each in several others.
- Dashboard onboarding steps are all 28–35 words: `step_results_body`, `step_scan_body`, `step_improve_body`, `step_monitor_body` and `add_first_brand_body`.

### A5. Hardcoded UI strings (not through next-intl)

101 of 184 .tsx files use next-intl. Many others branch on locale inline: **39 files** use `locale === 'zh-HK' ? … : …` ternaries, and **6 files** carry inline `en`/`zh-HK` dictionaries. 155 quoted English literals sit in ternaries or maps. Samples:
- `components/result/ResultClient.tsx:38-97`: a full check-label map and UI copy (`openFixPack: 'Open your Fix Pack'`, `collectionFailedTitle`, …), plus `:312` aria-label ternary.
- `app/[lang]/r/[slug]/page.tsx:26-37`: client-report copy dictionary. `:314` "Powered by Fimmick AISO".
- `app/[lang]/auth/login/page.tsx`, `components/PillarScoreCards.tsx`, `components/result/ScanEvidencePanel.tsx`, `components/dashboard/NotificationBell.tsx`: inline dictionaries.
- `components/result/AccountUnlockCard.tsx` (17 literals), `components/onboarding/OnboardingWizard.tsx` (17), `components/result/DeepGeoSection.tsx` (11).
- `components/auth/LoginForm.tsx:11`: "We sent a magic link to …".
- `app/[lang]/result/[id]/opengraph-image.tsx:73`: "Website readiness score" (OG image, English only).
- `app/[lang]/dashboard/[clientId]/result/[scanId]/page.tsx:162`: "Agent analysis pending".
- `components/reports/ReportBrandingForm.tsx:272`: "Powered by Fimmick AISO".
- `components/dashboard/local-trust/RoiTimeline.tsx:136`: "Only rows written since the estimator required a real baseline".
- `app/[lang]/r/[slug]/not-found.tsx:4`: "Not Found".
- `components/pulse/CompetitorTab.tsx:17,30,35,40` and `CompetitorChart.tsx:16`. These are orphaned components.
- Admin (English-only, internal): `app/admin/layout.tsx:13` "Super Admin", `app/admin/billing/page.tsx:75,77`, `components/admin/OverrideControls.tsx:38,48`.

---

## Part B: Visual system

### B1. Tokens (`app/globals.css`, 297 lines)

- **Colour:** there is a shadcn-style semantic set in `:root` and `.dark`: background, foreground, card, popover, primary (#2563eb), primary-accessible, secondary, muted, accent, destructive, success, warning, border, input, ring. On top of that:
  - a parallel `--sidebar-*` set
  - a parallel `--dash-*` set that duplicates the semantic values (dash-accent equals primary, and so on)
  - `--platform-*` brand colours (OpenAI, Perplexity, Google, Claude, Gemini; Google and Gemini share #4285f4)
  - an unused "donor brand palette" (paper, ink, cobalt, lime, line, danger, info, `*-soft`, `brand-*`) with **no dark values**. The comment says nothing references it yet.

  So the file holds three overlapping palettes plus one dormant palette.
- **Dark mode:**
  - The `.dark` class is set by an inline script in `app/layout.tsx` (localStorage first, else the OS setting) and toggled by `components/dashboard/ThemeToggle.tsx`, which exists in the dashboard only.
  - Dark primary is cyan #00d4ff. That is a different brand hue from light (blue), so the two themes look like different brands.
  - **Bug signal:** there is no `@custom-variant dark` in globals.css. Tailwind v4 `dark:` utilities therefore follow `prefers-color-scheme`, not the `.dark` class. That covers **140 `dark:` usages in 12 files**. When a user's choice differs from the OS setting, the tokens flip but the `dark:` utilities do not.
  - Hardcoded palette classes (slate, white) do not adapt to dark mode at all.
- **Radius:** `--radius` is 0.625rem, and sm/md/lg/xl are derived from it.
- **Shadows:** no shadow tokens.
- **Type:**
  - There is no type-scale tokens beyond the Tailwind defaults.
  - Custom `.text-2xs` (10px) and `.text-xs-` (11px) are plain CSS classes. `--font-size-*` sits inside `@theme`, but Tailwind v4 expects `--text-*`, so these are not real theme utilities.
  - Line-height tokens are defined.
- **Spacing:** Tailwind defaults, no tokens.
- **Font stack:** `Inter, "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", Arial, sans-serif`. **No webfont is loaded:** no `next/font` and no Google Fonts link. Inter and Noto only render if the user has them installed. Most Windows and Android users fall back to Arial plus the system CJK font.
- **Traditional Chinese handling:**
  - `<html lang={locale}>` is correct (zh-HK).
  - There is no `:lang(zh-HK)` rule, no CJK line-height adjustment, and no `word-break`/`line-break` setting. `break-keep` is never used.
  - 53 `break-words`, 30 `break-all`, 7 `text-balance` and 1 `text-pretty` exist. `break-all` will split English words mid-word in mixed strings.
  - `uppercase` (58 uses) and `tracking-widest` (42) have no effect on, or look poor with, CJK labels.

### B2. Inconsistency signals (app/ and components/ .ts/.tsx)

- **Raw palette colour classes:** 596 uses and 166 distinct classes across 35 files. By hue: slate 153, emerald 123, red 90, white 66, amber 66, blue 42, green 13, orange 12, and others.
- **Token colour classes:** 1,816 uses. The system is mostly tokenised, but success is expressed three ways: `success` token, `emerald-*` and `green-*`.
- **Top offenders by raw-colour line count:**
  - `app/[lang]/(marketing)/page.tsx` 26 (has a hardcoded `bg-slate-950` mockup panel)
  - `components/ExpandableCheckItem.tsx` 21
  - `components/result/DeepGeoSection.tsx` 20
  - `components/pulse/CompetitorTab.tsx` 17 (orphan)
  - `components/pulse/QuestionRow.tsx` 15 (orphan)
  - `components/result/TopIssueCard.tsx` 12
  - `components/admin/AdminDirectory.tsx` 12
  - `components/result/ImpactPanel.tsx` 11
  - `dashboard/[clientId]/result/[scanId]/page.tsx` 11
  - `app/admin/billing/page.tsx` 10
- **Hex literals:** 82 (57 distinct). Top files:
  - `components/reports/ReportStatusBadge.tsx` 32
  - `opengraph-image.tsx` 20 (expected, since OG images cannot use CSS vars)
  - `ReportPreview.tsx` 9
  - `components/ScoreRing.tsx` 9 (inline style)
  - `QuestionRow.tsx` 8
  - `CompetitorChart.tsx` 8
  - `PlatformBar.tsx` (`fill="#2563eb"`)

  There are also 16 arbitrary `[#…]` classes and 53 `style={{}}` blocks.
- **Font sizes:** 13 Tailwind steps plus arbitrary sizes. text-sm 538, text-xs 346, lg 56, xl 44, 2xl 33, base 19, 4xl 19, 3xl 15, 5xl 8, 6xl–8xl 3. Arbitrary sizes: `text-[10px]` 30, `[11px]` 19, `[12px]` 6, `[9px]` 3, alongside `.text-2xs` 8. That makes four ways to say "tiny", and 9–11px is a legibility risk for CJK.
- **Font weights:** semibold 375, bold 165, medium 115, black 67, normal 14.
- **Radius:** rounded-xl 153, lg 137, full 99, (bare) 53, 2xl 46, md 9, 3xl 2. Cards mix xl, 2xl and lg. `ui/button` uses lg.
- **Shadow:** sm 37, (bare) 16, lg 5, xl 4, md 3, 2xl 3. Shadows are light, with no elevation system.
- **Score colour logic is duplicated:** `ScoreRing.tsx` uses hex (#16a34a / #d97706 / #dc2626) while `ScoreReveal.tsx` uses token classes.
- **components/ui** has only 6 primitives: badge, button, card, input, label, separator. There is no dialog, tabs, tooltip, select, progress or skeleton, so each feature hand-rolls these.

### B3. Motion

- No animation library. package.json has no framer-motion, tw-animate-css or tailwindcss-animate.
- Keyframes in globals.css: `fade-up` and `pulse-glow` (`.animate-fade-up` / `.animate-pulse-glow`), but **no component uses either**.
- Usage counts: transition-colors 45, transition 24, transition-all 15, transition-transform 9, duration-150/200/700/1000, animate-spin 6, animate-pulse 3.
- Reduced motion is handled well:
  - a global `@media (prefers-reduced-motion: reduce)` kills animations and transitions and turns off smooth scroll
  - 6 `motion-reduce:transition-none` and 5 `motion-reduce:animate-none`
  - `components/result/ScoreReveal.tsx:82` checks `matchMedia` before running its rAF count-up
- Recharts animations are off (`isAnimationActive={false}` in SovChart).

### B4. Existing charts and visuals to reuse

- `components/result/ScoreReveal.tsx`: SVG ring gauge with a count-up, token colours and reduced-motion handling. **This is the best base for a score ring.**
- `components/ScoreRing.tsx`: a simple bordered circle with inline hex. Used by `dashboard/[clientId]/result/[scanId]/page.tsx` and `dashboard/ScanSummary.tsx`. It should merge into ScoreReveal.
- `components/PillarScoreCards.tsx`: per-pillar cards with an accessible `role="progressbar"` bar (`:116-125`).
- `components/pulse/SovChart.tsx`: Recharts LineChart using `var(--primary)`, with partial-week hollow dots. This is live, rendered by `ObservedPulseView`.
- `components/pulse/PlatformBar.tsx`: Recharts horizontal BarChart with hex fill. It is an orphan.
- `components/pulse/CompetitorChart.tsx`: custom SVG competitor trend with hex colours. It is an orphan.
- `components/pulse/ShareOfVoiceBenchmark.tsx`, `PulseCoverage.tsx`, `components/dashboard/CitationExplorer.tsx`, `ActivationProgress.tsx`, `local-trust/RoiTimeline.tsx`, `components/outcomes/OutcomeWindows.tsx`: div-based bars, timelines and progress.
- `components/dashboard/ScanStep.tsx`: contains SVG.
- `app/[lang]/result/[id]/opengraph-image.tsx`: OG score card.
- There are no heatmaps or sparklines.
- The orphans per `__tests__/components/orphaned-components.test.ts` are MissedTable, ScanLogSection, CompetitorTab, PulseTabs, CompetitorChart, QuestionRow and PlatformBar. They account for a large share of the hex and raw-palette usage.
