# SME copilot redesign — design spec (for approval)

Status: draft v3, 2026-11-12. Owner: Willy. Prepared by: agent, from three read-only
audits of the live source (home/nav, Studio/MCP, function pages/design system).
Scope: account home, brand home, primary navigation, Conversation Studio, and the
function pages behind them. Non-goals: marketing pages, pricing, onboarding funnel
before sign-in, public report pages (light polish only).

## 1. Why this exists

An SME owner signs in and cannot answer one question: **"我今日應該做咩？"** The owner's
words: *"design is too unorganised"*, *"don't know [how] to use it by SME owner"*.

The audit confirms the product has the data and actions, but no hierarchy. Concretely:

1. **A brand home with 14 blocks and 18+ anchors.** `WorkspaceHome` renders header,
   4-step checklist, monthly report, 3 stat cards, daily maintenance, 3 priorities,
   score trend, a Pulse "monitoring console", 4 equal panels, local visibility and a
   5-tile tools grid — all in the same white rounded card style. Nothing is subordinate,
   so nothing is *the* next thing to do. (`components/dashboard/WorkspaceHome.tsx`)
2. **Two brand homes and two shells.** With `STUDIO_DEFAULT_HOME=true` a brand URL 307s
   to `/studio`; `?step=overview` renders `WorkspaceHome`. The Studio route hides the
   dashboard sidebar/topbar and draws its own 7-entry rail plus brand switcher
   (`DashboardChrome.tsx`, `StudioShell.tsx`). Same brand, two different navigations.
3. **~20 nav links / 12 destinations; 8 pages undiscoverable.** Brand nav = 5 sections,
   9 sub-items, 12 destinations ("Scan & Fix", "Improve", "Opportunities", "Tasks",
   "Question Bank", "Cited sources", …). Monitor is hidden by `MONITOR_VISIBLE=false`
   with 4 pages; `visibility`, `outcomes`, `enterprise`, `this-month`, `billing` are in
   no section at all. Breadcrumbs for those pages light nothing.
4. **The recommended next step opens a hidden page.** `projectPrimaryNextStep` returns
   `/prompts` (Monitor-hidden *and* Pro-gated) and `/observations`; the *first-run
   checklist* step 4 also links to `/prompts`. The checklist points where nav cannot.
5. **Two report systems, three month surfaces.** Scan reports (`/reports`,
   `/reports/new`, builder) and monthly deliverables (`/month`, `/month/report`,
   publish/review) both publish to `/r/{slug}` with separate builders, lists and
   branding requirements; `/dashboard/this-month` is account-level and unreachable.
6. **One URL, four pages.** `?step=home|overview|scan|results|improve|monitor|roi` share
   `/{lang}/dashboard/{brand}`; sidebar `aria-current`, breadcrumbs and analytics all
   depend on a query param, so deep links look identical.
7. **Jargon and vocabulary drift.** AISO score, GEO checks, Pulse, run, SoV, receipts,
   evidence, "Question Bank", "Approved facts", "Registered pages", "Closed-loop AI
   visibility". One screen calls the same work "Fixes", "Improve", "Opportunities",
   "tasks", "work", "draft" (zh: 修復／改善／任務／工作). Two onboarding checklists
   (account "Setup progress" 6 agency milestones; brand "Get set up" 4 steps) disagree.
8. **Entitlement copy contradicts the gate.** `step_scan_body` says scanning is free for
   everyone while the page renders the upgrade state for `free`; `portfolio.firstRunBody`
   promises weekly Pulse questions while Monitor is hidden and Pulse is not scheduled.
9. **The copilot is a workbench, not a copilot.** Studio has the right ingredients
   (composer, six skills, continuous threads, saved vs live answers, MCP tools) but an
   SME meets **≈29 focusable controls** (16 in the home column: textarea, attach, send,
   connections, 5 filter chips, 6 skill cards, scope summary), three "homes" (`/studio`,
   `/studio/overview`, `/studio/threads`), and threads named after a skill. A skill card
   only **prefills the textarea and disappears**; "skill" is a canned prompt plus a turn
   tag (`studio_thread_turns.task`), not a persisted first-class thing. Evidence jargon
   (Pulse week, bounded, answer digest, receipt/observation/scan IDs) is on every turn,
   the platform picker shows raw model ids (`gemini-flash`, `gpt-4o`), and the LIVE quota
   is scattered across four differently-worded lines.
10. **MCP is real but invisible and read-only.** `POST /api/mcp/studio` is an audited
    JSON-RPC transport with six read-only tools, a 1-hour signed token, four gates and
    no rate limit; it cannot see Studio threads/turns and cannot write. Nothing in the
    product tells an SME what an assistant could read, and no skill declares which tools
    it uses.
11. **No written IA or visual source of truth.** `lib/dashboard-nav.ts` cites
    `docs/ux/target-ia.md` and `design-tokens.test.ts` cites `docs/ux/visual-system.md`;
    neither file exists.

## 2. Goals and success signals

1. On the brand home an SME can state their next action within ~10 seconds: **one**
   recommended action, **one** way to ask, at most **three** numbers.
2. Conversation Studio becomes the copilot: plain-language ask, one-tap **skills**,
   answers saved into conversations, evidence collapsed.
3. Navigation offers **five destinations** for a brand (plus an account menu); advanced
   tools stay reachable by URL and through a single "More" affordance.
4. Nothing dishonest is hidden: saved vs live answers, 未有／未記錄／未連接, provider
   failures, freshness and receipts stay exact — collapsed and phrased for humans.
5. Every slice ships bilingual, passes the PR gate, keeps tenancy/entitlement checks
   untouched, and keeps every existing URL working.

Signals after rollout (funnel events + usage):

- ≤ 3 clicks from brand home to "start the recommended fix".
- ≥ 40% of weekly active brands start a Studio turn from the home composer or a skill
  card.
- Usability check with 3 SME owners: after 60 s they can say what to do next, in their
  own words; 2/3 complete "ask → open the answer".
- Zero axe violations on the new dashboard fixtures; no increase in 5xx or p95 page
  time for the same read set.

## 3. Personas and jobs

| Persona | Context | Job |
| --- | --- | --- |
| **Owner-operator** (primary) | SME founder/marketing lead, 1–3 brands, zh-HK first | "AI 有冇提及我？我下一步改乜？幫我準備報告。" |
| **Marketing generalist** | Runs the brand weekly | Repeatable loop: check → fix → report; needs a trackable to-do |
| **Agency operator** (secondary) | Fimmick staff, many brands | Portfolio triage and advanced evidence; must not lose any capability |

Jobs → target path:

| Job | Today | After |
| --- | --- | --- |
| 「我有冇被 AI 提及？」 | hidden Monitor / Pulse panels | Today 3-metric strip → What AI says |
| 「我下一步改咩？」 | Scan → Results → Improve → Opportunities/Tasks | Today one action → Improve |
| 「幫我準備月報」 | Month → draft → publish → Reports | Skill card → Chat → Reports |
| 「直接問」 | Studio landing (technical) | Today composer / Chat |
| 「邊個品牌要跟進？」 | Portfolio | Account Today brand cards |

## 4. Principles

1. **One primary action per screen.** Everything else is secondary or disclosed.
2. **Conversation first, dashboards second.** Ask is one tap from any home.
3. **Progressive disclosure, never deletion.** Evidence, receipts, checks and pillars
   move behind 詳情; the honesty vocabulary stays verbatim.
4. **Outcome language.** 被 AI 提及、建議修改、可分享報告 — not internal nouns.
5. **One shell.** Brand surfaces render inside the same dashboard chrome; Chat is a
   destination, not a separate application.
6. **Keep the plumbing.** URLs, API shapes, tenancy filters, flags and copy keys that
   tests assert stay; this is presentation and IA, dark-launched slice by slice.
7. **Honesty is structural.** No success copy over a failed write, no fake zero, no
   "delivered" claim; read failure renders as "could not tell".

## 5. New information architecture

Brand-scoped sidebar — **five destinations**; account via the avatar menu:

| # | Destination | en / zh-HK | Absorbs (routes unchanged) |
| --- | --- | --- | --- |
| 1 | **Today** | Today / 今日 | bare `/dashboard/{brand}` (no redirect), `?step=home\|overview` (same page), `/dashboard/{brand}?step=roi` card |
| 2 | **Chat** | Chat / 對話 | `/studio` (+ `/studio/threads`, `/studio/weekly`, `/studio/documents`, `/studio/connections`, `/studio/tools` become tabs/menus inside Chat) |
| 3 | **What AI says** | What AI says / AI 這樣說 | tabs: 能見度 (`?step=monitor`, `/visibility`), AI 回答記錄 (`/observations`), 引用來源 (`/citations`), 競爭對手 (`/competitors`), 監測問題 (`/prompts`, Pro lock) |
| 4 | **Improve** | Improve / 改善 | tabs: 掃描 (`?step=scan`), 檢查結果 (`?step=results`), 優化建議 (`?step=improve`, `/opportunities`), 待辦 (`/tasks`, `/work-items/{id}/versions`) |
| 5 | **Reports** | Reports / 報告 | tabs: 可分享報告 (`/reports`, `/reports/new`, `/{reportId}`), 月度報告 (`/month`, `/month/report`), 全部品牌 (`/dashboard/this-month`) |

Avatar menu (account level): **品牌設定** (`/entities`), **已核實資料** (`/sources`),
**頁面** (`/assets`), **帳戶與方案** (`/dashboard/settings`), **帳單** (`/dashboard/billing`).
Account home `/dashboard`: single-brand → a one-brand Today variant (see 6.2); 2+ brands →
portfolio with next-action cards. Account nav becomes Home / Reports / Account.

Rules:

- `STUDIO_DEFAULT_HOME` is retired: a bare brand URL renders **Today**, never redirects
  to Studio; `?step=overview` and `?step=home` render Today. Studio stays one tap away
  through Chat; the Today composer creates/continues a Studio thread.
- Studio keeps the dashboard shell; its 7-entry rail becomes: thread drawer + a "More"
  menu for 每週／文件／連接／工具; the Studio-only brand switcher and "Back to brand
  overview" disappear (the normal sidebar is the way out). Existing Studio sub-routes
  render inside Chat tabs.
- Every destination is a page with tabs; a tab is a URL (deep-linkable) so old routes
  become the tab URLs. No route is deleted. `?view=` aliases are introduced only after
  the nav ships.
- Hidden-by-flag pages (`/visibility`, `/outcomes`, `/enterprise`) stay env-hidden but
  gain a breadcrumb location and, when their flag is on, a tab under What AI says. They
  are never advertised to an SME by default.
- `locateDashboard` gains the missing segments (`this-month`, `billing`, `visibility`,
  `outcomes`, `enterprise`, `studio/*`) so no page lights nothing.
- Locked items keep the lock + upgrade path; one shared lock primitive replaces the five
  hand-rolled blocks.

## 6. Screen specs

### 6.1 Brand Today

```
┌ brand · plan ─────────────────────────────────────────┬ avatar menu ┐
│ 今日要做嘅事                                                        │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ [icon] 你喺 3 個 AI 平台未被提及                                   │ │
│ │ 建議：改善「比較頁」嘅結構化資料（約 10 分鐘）                      │ │
│ │ [開始（建議）]  [睇原因]                                          │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│ 或者直接問 AI：[ 例如：點解我喺 AI 搜尋度唔見咗？          ] [問]   │
│ [了解現況] [改善內容] [準備月報]                          ← skill chips │
│ AI 提及率 32% ↑6pt ｜ AEO 分數 68 ｜ 本月報告：草稿                  │
│ [本月交付：報告草稿 →]                                              │
│ [設定檢查：3 項未完成]            ← only when incomplete, collapsed │
│ [詳情：分數趨勢 · 檢查項目 · 記錄歷史]  ← collapsed disclosure        │
└──────────────────────────────────────────────────────────────────────┘
```

Content rules:

- The recommended action comes from the existing `ownerPriorities` /
  `primaryNextStep` view models; no new scoring. If the underlying read fails, the card
  says why and offers a safe action (e.g. 重新掃描), never a fake action.
- At most three number tiles, each links to What AI says / Reports, never to a raw check
  list. Freshness stays "unknown" where it is unknown.
- The composer is the same component as Chat's (shared); submitting creates a Studio
  thread with the typed prompt, then navigates to Chat.
- Evidence, trend, pillar scores, daily maintenance, scan history and tools move into
  the "詳情／進階" disclosure; every old anchor/URL still resolves.
- Fix three known dead ends: `projectPrimaryNextStep` targets must map to visible tabs;
  the first-run checklist's "questions" step must open the new 監測問題 tab (Pro-locked
  copy explains why); account nav links that only re-point at the current page are
  removed; TopBar "Scan a website" stops leaving to `/{lang}#scan`.

### 6.2 Account Today

- **One brand**: render the brand Today for that brand directly at `/dashboard` (header
  says 你嘅品牌), with a quiet "全部品牌" link; no portfolio wall of one card.
- **Two+ brands**: portfolio cards become next-action cards: brand, last observed week,
  one honest status line, one `繼續 →` primary; keep capacity + add-brand, activation
  progress collapsed, recent scans given one line. No duplicate "Setup progress" and
  "Get set up" both open — they merge into one checklist per scope.
- `#portfolio-brands` keeps working for deep links.

### 6.3 Chat — Conversation Studio as copilot

Landing (target: **≤ 8 focusable controls in the home column**, vs 16 today):

```
你今日想 AI 幫你完成咩？
[ 直接問：… ]                                     ← composer focused
了解現況                改善內容                交付報告
[我而家喺 AI 被提及幾多？] [邊頁最需要改？] [幫我起草月報]   ← 3–4 skill cards
[最近對話 →]                                      ← drawer, search behind 全部
[⋯ 每週 · 文件 · 連接 · 工具]                      ← one menu, not seven rail links
```

- **Skills are one tap and first-class.** A card shows the outcome and what it will read
  ("會讀：本週監測、最新掃描"), the plan lock if any, and submitting creates the thread
  and sends the turn — no silent prefill/clear dance. Typing freely stays fully available
  (no skill selected = plain question). The five filter chips become one "全部技能" link;
  the existing six templates remain the v1 skills.
- **Persist the skill.** Add `studio_threads.skill` (nullable, CHECK against the skill
  ids; migration follows the existing hand-applied + schema-gate process). Thread titles
  come from the outcome plus a timestamp, not the skill label, and the list groups
  threads as 待跟進 / 已完成 so conversations read like tasks. The turn-level `task` and
  `request_id`/receipts stay exactly as they are.
- **One execution preview before send.** Under the composer, one quiet line replaces the
  scattered quota copy: e.g. "今次會讀：監測 · 搜尋需求；即時回答 1 次（本週餘 8/10）".
  Live platform checkboxes get human labels (Gemini, GPT-4o, Claude, Perplexity) while
  the wire values stay `gemini-flash`, `gpt-4o`, …; the LIVE quota sentence is written
  once ("每週 10 次即時回答，品牌共用").
- **Evidence collapses.** One "根據（N 個來源）" disclosure per answer; IDs, digests,
  receipts, coverage tables and the inspector move behind "進階"; branch becomes
  **接住問（follow-up）**; Save to Docs / export / trace live under "⋯". Honesty lines
  (saved vs unverified LIVE, PROVIDER_UNAVAILABLE, 未有／未記錄／未連接) stay verbatim,
  just collapsed.
- **One home.** `/studio` is Chat's landing; `/studio/overview` becomes a redirect to
  brand Today; `/studio/threads` becomes the full conversation list (the drawer's "全部");
  `/studio/weekly`, `/studio/documents`, `/studio/connections`, `/studio/tools` become
  Chat tabs (same URLs), with the "工具" tab eventually hosting the "連接你的助理"
  (MCP) card. The Studio-only shell and 7-entry rail are removed; Chat renders inside
  `DashboardChrome`.
- **Test hooks preserved while structure changes:** `#studio-home`, `#studio-composer`,
  `#studio-discussion`, `.as-*`, `role=log` on thread view (never on home), 44 px targets,
  focus restore, both locales. The specs that pin 6 skill cards and exactly 5
  `aria-pressed` filters are updated deliberately in the same slice (see §10).

### 6.4 What AI says

One page, five tabs, all reusing current components and honesty notes:
能見度 (pulse/visibility state + measured gaps), AI 回答記錄 (observations + run
troubleshooting behind 詳情), 引用來源 (citations + CSV), 競爭對手 (competitors editor),
監測問題 (question bank; Pro lock with clear value copy). Monitor's RunProgress is
rewritten as a compact "本週監測" status row with honest gaps (no provider-cost warnings
in the SME view; those move to 詳情).

### 6.5 Improve

Tabs: 掃描 (run scan), 檢查結果 (20 checks, plain-language toggle), 優化建議 (fixes +
opportunities, one primary 開始), 待辦 (tasks, statuses). `?step=improve`,
`/opportunities`, `/tasks` become tab URLs; one vocabulary wins everywhere: **優化建議**
for fixes/improvements, **待辦** for tasks, 機會 for opportunities.

### 6.6 Reports

One destination, three tabs: 可分享報告 (scan reports), 月度報告 (month record + monthly
deliverable + publish + review link), 全部品牌 (account queue). The two builders are
prefaced by one chooser ("你想分享邊種報告？" with outcome wording); status, share link,
print and review stay. `report-print.spec.ts` one-A4-page behaviour is preserved.

### 6.7 Account and brand setup

Avatar menu and account pages: 品牌設定 (`/entities`, the true "start here": brand
identity + domain verification, promoted to first-run), 已核實資料 (`/sources`, stays
advanced but gains a plain-language intro), 頁面 (`/assets`), 帳戶與方案
(`/dashboard/settings`, split so an SME sees plan/members first and staff grants/GSC/
report branding behind 進階), 帳單 (`/dashboard/billing`). The shared lock, empty, error
and page-header primitives replace the copy-pasted variants.

## 7. Copilot skills and MCP

A **skill** is a named one-tap job that produces a saved Studio turn — never a hidden
request. Skills formalise the six existing home tasks (`opportunity, improve, brief,
competitors, pulse, report`), which already persist as the first turn's task.

### 7.1 Registry (server-owned, single source of truth)

```ts
type StudioSkill = {
  id: 'visibility_now' | 'what_ai_says' | 'top_opportunity' | 'improve_page'
    | 'compare_competitors' | 'draft_brief' | 'monthly_report'
    | 'scan_brand' | 'explain_drop'
  label: { en: string; zhHK: string }
  outcome: { en: string; zhHK: string }         // one line, plain language
  category: 'discover' | 'improve' | 'deliver'
  planFeature?: PlanFeatureKey                  // via resolveCommercialEntitlement
  tools: StudioMcpToolName[]                    // read-only context this skill reads
  runs: 'context-only' | 'compose' | 'action'
  confirmation?: { en: string; zhHK: string }   // required for action skills
  destination?: 'improve' | 'reports' | 'chat'
}
new file: lib/conversation-studio/skills.ts + __tests__/conversation-studio/skills.test.ts
```

- **Context skills** (v1, the six existing tasks): one tap submits, composing an answer
  from saved records through the existing read layers; `receipts` continue to record
  exactly what was read. Each card names its read set up front ("會讀：本週監測、最新
  掃描") and its plan requirement; a failed/empty read still produces an honest turn.
- **Skill persistence**: new migration `studio_threads.skill` (nullable, CHECK against
  the registry ids, no backfill required — old threads derive from `first_task` as
  today). This makes grouping ("待跟進"), analytics ("which skill is used") and
  outcome titles possible; the turn-level `task` stays for idempotency and branching.
- **Action skills** (slice 4): `scan_brand` (existing scan engine), `improve_page`
  (existing agent generation), `monthly_report` (existing monthly draft service). Each
  requires an inline confirm naming what will run and what it writes, a plan gate and a
  rate limit, and reuses the existing write path — no new write API is invented in this
  redesign. Report publish/review stays in Reports.
- Skill → MCP tool declarations (read-only tools already in the registry):
  `visibility_now → brand_evidence`; `what_ai_says → brand_evidence + brand_sources`;
  `top_opportunity → scan_checks + content_opportunities`; `improve_page →
  scan_checks + content_opportunities + brand_sources`; `compare_competitors →
  brand_evidence`; `draft_brief → content_opportunities + brand_sources`;
  `monthly_report → brand_evidence + scan_checks + work_item_drafts +
  search_console_status`; `explain_drop → brand_evidence`.
- **MCP** stays the internal read-only JSON-RPC transport (`POST /api/mcp/studio`;
  protocols `2024-11-05`/`2025-03-26`/`2025-06-18`; tools `brand_evidence`, `scan_checks`,
  `content_opportunities`, `brand_sources`, `work_item_drafts`, `search_console_status`),
  audited in `studio_mcp_calls` before the result, fail-closed on audit failure, gated by
  `FEATURE_CONVERSATION_STUDIO_MCP` + rollout + `STUDIO_MCP_TOKEN_SECRET` (1 h HMAC
  token, re-authorised per call). Skills execute the same tool functions in-process (no
  token round trip) and declare their usage, so an external MCP client sees the same
  definitions and limits. Two deliberate hardenings in slice 3: a **bounded per-token /
  per-brand call rate limit** (the transport has none today) and a **"連接你的助理"
  card** in Chat → 工具 that explains what an assistant can read and mints the existing
  token from the session. **No write tool is added** in this redesign — out of scope
  until separately approved. `docs/runbooks/studio-mcp-internal.md` gains the skill map
  and the rate limit.
- Copy for skills states what will be read and what will be produced; live answers keep
  the existing quota and unverified labelling.

## 8. Language and visual system

- Reuse `app/globals.css` tokens and `components/ui/*`: neutral-*, tone-*,
  shadow-e1/e2/e3, text-display, ease-standard. **Retire legacy `--dash-*` /
  `--sidebar-*`** from redesigned surfaces (WorkspaceHome and PortfolioView currently
  read as different products because one uses `--dash-*`, the other semantic tokens).
- Standardise the five primitives the audit found re-implemented: page header (only
  `/tasks` uses `PageHeader`), plan lock (5 copies + `LockedFeature`), empty state,
  error/retry, stat; `DataTable` for tabular month/queue rows. Add these to the design
  gallery.
- Plain-language glossary (en / zh-HK), enforced in each slice's copy review:

| Internal | SME copy |
| --- | --- |
| Share of voice / SoV / Pulse | AI 提及率 / AI 能見度 |
| Check / GEO check | 檢查項目 → 建議修改 |
| Evidence / receipts / trace | 根據／閱讀紀錄（collapsed） |
| Fix pack / work item / opportunity | 優化建議／待辦／機會 |
| Citation | 引用來源 |
| Scan & Fix / Results / Improve | 掃描／檢查結果／優化建議 |
| Client report / monthly report | 可分享報告／月度報告 |
| Quota / live answer | 即時回答（每週 10 次，已用 N 次） |
| Local Trust / ROI | removed from SME nav; behind 詳情 with plain description |

- zh-HK must not leak English technical nouns ("run", "Pulse", "Local Trust") and must
  not use bare "AISO" as the product name (banned by `npm run audit:text`).
- **A11y**: dashboard routes are currently outside the a11y matrix. This redesign adds
  offline-fixture axe specs for Today, Chat and each destination (both locales, light/
  dark, 320/375/768/1440), keeps 44 px targets, one `aria-current="page"`, heading /
  `aria-labelledby` contracts, reduced-motion safety and the token-contrast pairing test.

## 9. Slice plan (one PR each, gate green, docs evidence)

| Slice | Content | Acceptance |
| --- | --- | --- |
| **0** | This spec + `docs/ux/target-ia.md` + `docs/ux/visual-system.md` (the missing source-of-truth files) + glossary + component inventory + flag name | approval; no code |
| **1** | Single shell + nav rewrite (`lib/dashboard-nav.ts`), brand **Today**, account Today (single-brand variant), 5 destinations, avatar account menu, flag `FEATURE_SME_COPILOT_UI`; fix dead-end next steps; one lock/empty/error/page-header primitive | Today = one action + composer + ≤3 numbers; URLs unchanged; c8a/c8b/app-shell/dashboard-nav tests updated; new dashboard axe fixture; dark/light + 320–1440; honesty copy intact |
| **2** | **Chat** copilot landing + shell unification (remove Studio rail/shell, sub-routes as tabs, `/studio/overview` → Today), one-tap skill cards, ≤8 home controls, execution-preview line, evidence collapse, human platform labels, thread grouping | Studio e2e specs green after deliberate updates (`conversation-studio.spec.ts` + `studio-shell.spec.ts`, both locales, chromium + mobile); ≤8 focusable controls on Chat home (from 16); saved/live/quota/receipts unchanged; empty state has 3 example asks |
| **3** | Skill registry v1 + `studio_threads.skill` migration + skill→MCP tool declarations + receipts + MCP rate limit + "連接你的助理" card + runbook skill map | new unit tests; migration applied and `recorded` **before** merge (schema gate); MCP tools unchanged, still read-only; no API shape change |
| **4** | Action skills (`scan_brand`, `improve_page`, `monthly_report`) with inline confirm + plan gates + idempotency; funnel events | each skill produces a saved turn; failures honest; no new write API; e2e fixture updates |
| **5** | **What AI says** + **Improve** consolidation (tabs reuse existing components); Monitor honesty copy; prompts re-homed and Pro-lock copy | monitor/observation/prompt e2e specs still pass via tab URLs; axe fixture per tab |
| **6** | **Reports** consolidation (scan + monthly + this-month under one destination; one report chooser) | print/report specs green; no publish/review behaviour change |
| **7** | Account/settings split; `/entities` as first-run; portfolio first-run polish; vocabulary pass; docs + rollout | copy audit passes; funnel events live; flag-off returns today's UI |

Delivery order note: the owner asked for the full redesign; the slices above deliver the
whole scope. Slice 1 and 2 are the first visible change; each is reversible by flag.

## 10. Constraints, preservation and risks

**Must keep working (audit-pinned):**

- URLs: `/dashboard`, `/dashboard/settings`, bare `/dashboard/{brand}`,
  `?step=overview` (never redirect), all `?step=` values, `/reports{,/new,/{id}}`,
  `/month`, `/month/report`, `/studio` + 7 sub-routes, `/opportunities`, `/tasks`,
  `/work-items/{id}/versions`, `/observations`, `/prompts`, `/competitors`, `/citations`,
  `/entities`, `/sources`, `/assets`, `/result/[scanId]`, `/onboarding?scan=`,
  `/pricing`, `/dashboard#portfolio-brands`.
- Tenancy and gates: every page keeps `requireAuth`, `account_id` filters, 404 vs 503
  semantics; `resolveCommercialEntitlement` remains the only entitlement gate;
  `agent_recs`, `client_reports_online`, `edit_prompts`, `local_trust_roi`,
  `platform_access`, brand capacity unchanged.
- Flags: `FEATURE_CONVERSATION_STUDIO`, `_LIVE`, `_MCP`, `FEATURE_SEARCH_CONSOLE`,
  rollout allowlist, `MONITOR_VISIBLE`; new flag `FEATURE_SME_COPILOT_UI` default off.
- **Studio data contracts stay exact**: threads (200/member/brand, 50 turns/thread, 50-row
  list; 4 KiB thread / 96 KiB turn / 64 KiB reply / 4 KiB attached), idempotent appends
  on `request_id`, server-composed `StudioReply` shape, LIVE JSON shape
  (`answers[]`, `quota:{cap,remaining,scope:'brand'}`), error codes (`NOT_FOUND` 404,
  `INVALID_STUDIO_THREAD` 400, `STUDIO_THREAD_FULL` 409, `STUDIO_QUOTA_EXCEEDED` 429,
  `STUDIO_UNAVAILABLE` 503, …), and `STUDIO_LIVE_ANSWERS_PER_BRAND_PER_WEEK = 10` (a
  code constant, no env override).
- **Studio test surface**: 43 unit files / 276 `it()` cases plus
  `conversation-studio.spec.ts` and `studio-shell.spec.ts` pin the current structure —
  including exactly 6 skill cards, exactly 5 `aria-pressed` filters, no `role="log"` on
  the home view, 44 px targets, ≥12 px text, focus restore and both locales. Those specs
  are updated deliberately in slice 2/3, never silently broken. There is no
  `tests/e2e/a11y/studio*` file today; Chat gets an offline-fixture axe spec in slice 2.
- **MCP contracts**: four gates (migration 106 recorded, Studio flag + rollout,
  `FEATURE_CONVERSATION_STUDIO_MCP`, `STUDIO_MCP_TOKEN_SECRET` ≥32 chars), 32 KiB body,
  one JSON-RPC object per POST, audit-before-result with `503 AUDIT_UNAVAILABLE` on
  audit failure, no batch/SSE/resources/prompts, token re-authorised per call. The
  redesign adds a bounded rate limit; it does not add write tools.
- **Migration gate**: `studio_threads.skill` (slice 3) is applied and `recorded` before
  its PR merges — the schema gate fails a production build when code ships ahead of the
  ledger; `npm run migrate -- --verify` first, named approval, then merge.
- Honesty and a11y contracts listed in §8; copy is asserted by message **keys**, so
  renaming a key breaks tests as surely as renaming a URL.
- `lib/dashboard-nav.ts` is a single source for sidebar, ⌘K palette and breadcrumbs —
  all three change together.

**Risks and mitigations:**

- *Two shells*: unifying Studio into the dashboard chrome is the riskiest visual change;
  keep Studio's conversation CSS and hooks, render it inside the normal shell, verify
  `conversation-studio.spec.ts` and `studio-shell.spec.ts` on chromium and mobile.
- *Hidden pages*: 8 pages become reachable under tabs; any page an existing customer
  uses daily stays reachable by its old URL. `locateDashboard` extended so breadcrumbs
  work.
- *Message-key churn*: prefer adding keys/aliases over renaming; update render tests and
  e2e copy lookups in the same slice.
- *Token split*: replacing `--dash-*` must keep contrast pairs; add pairings to
  `design-tokens.test.ts` before use.
- *Performance*: Today reuses existing workspace reads; no new queries on the home path;
  Chat landing uses the bounded thread list.
- *Env*: set flag via `vercel env add ... --value 1` (never pipe — the 2026-11-12
  `"1\r\n"` incident); redeploy is always a separate, named action.
- *Rollback*: flag off restores today's UI; each slice is an independent PR.

## 11. Open questions for approval

1. **Approve the five destinations** (今日 / 對話 / AI 這樣說 / 改善 / 報告) plus an
   avatar Account menu, replacing the current four sections and Studio's separate rail?
   (Alternative: minimal 3 destinations Home / Fixes / Reports + Settings.)
2. **Action skills**: is a one-tap inline confirm (with what will be read/produced) enough
   for `scan_brand`, `improve_page`, `monthly_report`, or do you want a separate approval
   step like the site-edit hand-off flow?
3. **Single-brand accounts**: land directly on the brand Today (skip the portfolio),
   while 2+ brands keep the portfolio? 
4. **Language**: keep "Chat / 對話" as the destination label, or "Ask / 問 AI"?
5. **Slice 3 migration**: `studio_threads.skill` is a small additive migration; approve
   applying it (and recording it) when slice 3 lands, before merge?

## Appendix — current-state evidence (audit summary)

- Brand home blocks: 14; interactive anchors: 18+; tool tiles: 5; stat cards: 3 (all
  linking to the same results URL). Account home blocks: 4. Studio rail entries: 7;
  Studio home has ≈29 focusable controls (16 in the home column), 5 skill filters and 6
  skill cards that only prefill the composer. Nav: 5 sections / 9 sub-items / 12
  destinations for a brand; 8 routes with no discoverable entry (`observations`,
  `prompts`, `competitors`, `citations`, `visibility`, `outcomes`, `enterprise`,
  `this-month`).
- Tests pinning structure: `c8a-workspace-home` (24), `c8b-portfolio` (8), `app-shell`
  (8), `studio-shell` (11), `conversation-studio` (19 test definitions × 2 locales),
  `c9a`–`c9f`, prompt-bank specs, `report-print`, `a11y/design-system` (dashboard
  routes absent from the a11y matrix). Studio also has 43 unit files / 276 `it()` cases.
- Missing docs source of truth: `docs/ux/target-ia.md`, `docs/ux/visual-system.md`.
