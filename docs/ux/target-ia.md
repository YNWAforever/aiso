# Target information architecture — SME copilot

Status: approved 2026-11-12 (design spec: `docs/ux/sme-copilot-redesign.md`).
This file is the source of truth for navigation, destinations and route mapping.
[lib/dashboard-nav.ts](../../lib/dashboard-nav.ts) is the implementation of this file;
the sidebar, ⌘K palette and breadcrumbs all read it.

## 1. Destinations

Brand-scoped sidebar, in this order:

| # | Section key | Label en | Label zh-HK | Panel | Tab URLs (existing routes) |
| --- | --- | --- | --- | --- | --- |
| 1 | `today` | Today | 今日 | one primary action, ask composer, ≤3 numbers, monthly entry, collapsed setup + details | bare `/{lang}/dashboard/{clientId}`, `?step=home`, `?step=overview`, `?step=roi` card |
| 2 | `chat` | Chat | 對話 | copilot landing (composer + skills + recent threads) | `/{lang}/dashboard/{clientId}/studio`, `/studio/threads`, `/studio/weekly`, `/studio/documents`, `/studio/connections`, `/studio/tools` (tabs) |
| 3 | `what_ai_says` | What AI says | AI 這樣說 | evidence and monitoring | tabs: 能見度 (`?step=monitor`, `/visibility`), AI 回答記錄 (`/observations`), 引用來源 (`/citations`), 競爭對手 (`/competitors`), 監測問題 (`/prompts`) |
| 4 | `improve` | Improve | 改善 | find and do the work | tabs: 掃描 (`?step=scan`), 檢查結果 (`?step=results`), 優化建議 (`?step=improve`, `/opportunities`), 待辦 (`/tasks`, `/work-items/{id}/versions`) |
| 5 | `reports` | Reports | 報告 | the deliverables | tabs: 可分享報告 (`/reports`, `/reports/new`, `/reports/{reportId}`), 月度報告 (`/month`, `/month/report`), 全部品牌 (`/dashboard/this-month`) |

Account-scoped surfaces (avatar menu in `TopBar`, not sidebar items):

| Item | Label en | Label zh-HK | URL |
| --- | --- | --- | --- |
| brand profile | Brand profile | 品牌設定 | `/{lang}/dashboard/{clientId}/entities` |
| verified facts | Verified facts | 已核實資料 | `/{lang}/dashboard/{clientId}/sources` |
| pages | Pages | 頁面 | `/{lang}/dashboard/{clientId}/assets` |
| account & plan | Account & plan | 帳戶與方案 | `/{lang}/dashboard/settings` |
| billing | Billing | 帳單 | `/{lang}/dashboard/billing` |

Account home `/{lang}/dashboard`:

- one owned brand → the brand Today variant for that brand (no portfolio wall);
- two or more brands → portfolio with next-action cards;
- `#portfolio-brands` keeps working;
- account sidebar shows Home / Reports / Account; Reports opens the brand picker or the
  only brand's Reports tab.

Advanced-only pages stay reachable by URL and by the relevant tab, never as their own
sidebar entry: `visibility`, `outcomes`, `enterprise` (env flags),
`dashboard/this-month` (Reports → 全部品牌), `prompts` (What AI says → 監測問題, plan
gated), `sources` / `assets` (avatar menu), `step=improve/scan/results` (Improve tabs).

## 2. Rules

1. **Five sidebar items, one account menu.** `MONITOR_VISIBLE` stops controlling a
   hidden section; Monitor's four pages become What AI says tabs. Flag-only pages
   (`visibility`, `outcomes`, `enterprise`) show a tab only when their flag is on.
2. **One brand home.** With the SME UI flag on, a bare brand URL renders Today and never
   redirects to Studio. `STUDIO_DEFAULT_HOME` only applies when the flag is off (today's
   behaviour). `?step=overview` and `?step=home` render Today and never loop.
3. **Tabs are URLs.** Existing routes stay the tab URLs; no route is deleted. The tab
   chrome highlights the destination and the active tab. `?view=` aliases are added only
   after the nav ships and are documented here first.
4. **One shell.** Brand pages, including Chat, render inside `DashboardChrome`
   (topbar + sidebar). Studio's separate shell and 7-entry rail are removed in slice 2;
   until then Chat links to the existing Studio route.
5. **Breadcrumbs cover every page.** `locateDashboard` gains `this-month`, `billing`,
   `visibility`, `outcomes`, `enterprise`, and all `studio/*` segments; a page must never
   render a trail that lights nothing.
6. **Locks and plans.** Locked tabs keep a lock and an upgrade link; entitlement is still
   `resolveCommercialEntitlement`. `agent_recs`, `client_reports_online`,
   `edit_prompts`, `local_trust_roi`, `platform_access` and brand capacity do not change.
7. **Deep links keep working.** Every URL listed in the design spec §10 must resolve to
   the same content (tab chrome may wrap it). Redirects are allowed only where a URL's
   meaning is replaced, and must be recorded here: `/studio/overview` → Today (slice 2).
8. **Account menu is not a destination.** It opens a menu; each item is a full page with
   the normal shell and breadcrumbs under "Account".
9. **No page is advertised to an SME before it can be used.** Hidden-flag pages never
   appear in the sidebar or palette for a brand whose plan/flag lacks them; the palette
   search may reveal them only when their tab is enabled.

## 3. Flag and rollout

- New server flag `FEATURE_SME_COPILOT_UI` (exactly `'1'`, default off). When off:
  today's `buildDashboardNav`, WorkspaceHome, Studio default-home and shell are unchanged.
- When on: this file's IA, Today pages and account menu replace the current nav; Chat
  still renders the existing Studio route until slice 2.
- Rollout: flag on in preview → owner checks Today/Chat/account menu → flag on in
  production with a named approval and a redeploy (env values set with `--value 1`, never
  piped through PowerShell).

## 4. What the implementation must touch (slice 1)

- `lib/flags.ts` — `sme_copilot_ui` in `FeatureFlag` (default off).
- `lib/dashboard-nav.ts` — new section keys and items, `brandHomeHref`, `locateDashboard`
  segments (`today`, `chat`, `what_ai_says`, `improve`, `reports`, account items),
  account nav, labels via existing message keys (new keys added in both catalogs).
- `components/dashboard/DashboardSidebar.tsx` — 5 items when flag on; locked tabs keep
  lock; account section removed from sidebar (avatar menu owns it).
- `components/dashboard/shell/TopBar.tsx` — avatar menu with the five account links.
- `app/[lang]/dashboard/[clientId]/page.tsx` — flag branch: Today when on (Studio
  redirect only when off).
- `app/[lang]/dashboard/page.tsx` / `components/dashboard/PortfolioView.tsx` — account
  Today branch and single-brand variant.
- New `components/dashboard/today/{BrandToday,AccountToday}.tsx` and their message keys.
- Tests: `__tests__/lib/dashboard-nav.test.ts`, `dashboard-sidebar*.test.*`,
  `top-bar.test.tsx`, `workspace-home-page.test.tsx`, `portfolio-page.test.tsx`,
  `__tests__/components/*home*render*`, fixtures `tests/fixtures/{workspace-home,portfolio}.ts`,
  e2e `c8a`, `c8b`, `app-shell`; new offline-fixture axe spec for Today.

## 5. Acceptance for slice 1

- Today shows one recommended action, one composer, ≤3 numbers; all other content is
  behind 詳情 / 設定檢查 disclosures; every previous anchor still resolves.
- Sidebar has exactly five brand items (plus locks); account pages are in the avatar menu;
  ⌘K palette and breadcrumbs use the same model.
- `?step=home|overview|roi` render Today; bare brand URL does not redirect when the flag
  is on; flag off is byte-for-byte today's IA.
- Unit, lint, typecheck and PR gate green; axe zero violations on the new offline
  fixtures; no horizontal scroll at 320/375/768/1440 in both locales and themes.
- Honesty copy unchanged: freshness unknown, "records do not establish delivered
  improvements", 未記錄／未連接, no fake zeros.
