# Conversation Studio views and component handoff

**設計示例，非產品數據 / design mock — not product data**

This inventory describes future Stages 1–5 and references existing files at
`main@0766bdf6`. **Stage 0 changes none of those implementation files.** Willy
Approve via Rio/AISO on 2026-10-29 HKT covers Stages 0–5 continuous and selects
**Stage 5 Layout B full-bleed**. The current task ends at a Stage 0 draft PR.
Stage 6 remains NO_GO pending separate approval; Production FEATURE stays OFF.

Snapshot view IDs are local mock state, not existing application routes. In
route suggestions below, `brand` means `/{lang}/dashboard/{clientId}`. New
`/studio/*` routes are proposals; only `brand/studio` currently exists.

## View/component inventory

| Concept view / component | Reference and behavior | Future stage | Existing repo surfaces to consult/touch later |
| --- | --- | --- | --- |
| 開始工作 (`home`) | [Home screenshot](screenshots/01-home.webp): eyebrow/hero → central composer → saved-data/source bar → five category filters → six two-column task cards → 繼續工作. Selecting a template fills and focuses the composer; starting work opens a discussion. | 1: visual primitives; 2: home IA and template/filter behavior | [ConversationStudio.tsx](../../../components/dashboard/ConversationStudio.tsx), [Studio page](../../../app/[lang]/dashboard/[clientId]/studio/page.tsx), [template types](../../../lib/conversation-studio/types.ts), [saved reply composer](../../../lib/conversation-studio/reply.ts), messages catalogs |
| 討論串 (`threads`) | [Thread list screenshot](screenshots/03-threads.webp): 每件工作，各有脈絡; rows/statuses; new discussion. Proposed `brand/studio/threads`. Actual rows must be session/page-local and labelled 暫存 until persistence/ACL approval. | 5 | Existing thread/draft state in [ConversationStudio.tsx](../../../components/dashboard/ConversationStudio.tsx); current [Studio page](../../../app/[lang]/dashboard/[clientId]/studio/page.tsx) as route/ownership reference. No existing thread store. |
| 討論 (`thread`) | [Discussion screenshot](screenshots/02-discussion.webp): heading and scope badges → user bubble → AISO answer → research details → result cards/actions → follow-up composer. Branching carries context into another temporary discussion. Product says AISO · 回答; the snapshot says 示範回答. | 1: card/note/badge styles; 3: discussion composition; 4: inspector | [ConversationStudio.tsx](../../../components/dashboard/ConversationStudio.tsx), [StudioReply.tsx](../../../components/dashboard/StudioReply.tsx), [StudioLiveReply.tsx](../../../components/dashboard/StudioLiveReply.tsx), [ScanEvidencePanel.tsx](../../../components/result/ScanEvidencePanel.tsx). Preserve saved/live distinctions and B2 transport behavior. |
| 本次證據 inspector | Open/close evidence; 240px aside, below answer at ≤900px. Brand documents, Search Console, DataForSEO, Firecrawl, AI citations; source IDs, dates and explicit gaps. “缺少資料時顯示「待核實」，不填入推算數字。” | 4 (with Stage 1 styling) | [StudioReply.tsx](../../../components/dashboard/StudioReply.tsx), [StudioLiveReply.tsx](../../../components/dashboard/StudioLiveReply.tsx), [saved evidence loader](../../../lib/conversation-studio/evidence.ts), [source service](../../../lib/sources/service.ts), [Search Console state](../../../lib/integrations/search-console/state.ts) and [store](../../../lib/integrations/search-console/store.ts). New reads require session account ownership; no new vendor query. |
| 文件與成果 (`documents`) | In [inner snapshot](concept-inner.html): 資料與成果，都找得到; versioned brand inputs and work outputs. Proposed `brand/studio/documents`, read-only lists with links to existing source/version workflows. | 5 | [SourcePackWorkspace.tsx](../../../components/sources/SourcePackWorkspace.tsx), [sources page](../../../app/[lang]/dashboard/[clientId]/sources/page.tsx), [source service](../../../lib/sources/service.ts), [work-item service](../../../lib/work-items/service.ts), [versions page](../../../app/[lang]/dashboard/[clientId]/work-items/[workItemId]/versions/page.tsx). No snapshot document IDs or pretend approvals. |
| 資料連接 (`connections`) | [Connectors screenshot](screenshots/04-connections.webp): 讓答案有資料依據; GSC scope/owner/date and separate binding/sync/completeness states; DataForSEO and Firecrawl limitations. Proposed `brand/studio/connections`. | 5; source-bar status in 2; inspector rows in 4 | [SearchConsolePanel.tsx](../../../components/integrations/SearchConsolePanel.tsx), [connector state](../../../lib/integrations/search-console/state.ts), [binding](../../../lib/integrations/search-console/binding.ts), [guard](../../../lib/integrations/search-console/guard.ts). No DataForSEO/Firecrawl implementation exists in this base. Their product states remain 未連接 / 待核實, with no connect action. |
| 全部 AISO 工具 (`tools`) | In [inner snapshot](concept-inner.html): 原有功能，繼續直接使用; 16 legacy tool tiles. Proposed `brand/studio/tools`; links preserve existing route/role/entitlement behavior. | 5 | [dashboard-nav.ts](../../../lib/dashboard-nav.ts), [DashboardSidebar.tsx](../../../components/dashboard/DashboardSidebar.tsx), [TopBar.tsx](../../../components/dashboard/shell/TopBar.tsx), [command-palette.tsx](../../../components/ui/command-palette.tsx). The concept's generic destinations are not a replacement route contract. |
| Sidebar and shared chrome | AISO / BY FIMMICK; current-brand switcher; 開始新討論; five nav entries; 最近討論 · 私人 (up to four); brand-scope footer; brand/view breadcrumb, locale, mobile toggle and feedback. Discussion is selected through thread rows, not a sixth primary-nav button. | 1: visual chrome only; 5: full shell and navigation | [dashboard layout](../../../app/[lang]/dashboard/layout.tsx), [DashboardSidebar.tsx](../../../components/dashboard/DashboardSidebar.tsx), [TopBar.tsx](../../../components/dashboard/shell/TopBar.tsx), [MenuButton.tsx](../../../components/dashboard/shell/MenuButton.tsx), [owned-brand loader](../../../lib/workspace/list-owned-brands.ts), [dashboard-nav.ts](../../../lib/dashboard-nav.ts), [toast.tsx](../../../components/ui/toast.tsx). New Studio-specific components would be future work. |

Layout B means hiding the global dashboard rail for `/studio/*` and providing
the concept's Studio shell, while preserving authentication, account scope,
brand switching, command palette, breadcrumbs and return paths to existing
tools. The concept's embedded host frame/width cap does not constrain that
full-bleed product shell. At ≤620px its rail collapses behind the menu.

## Six home templates → existing capability

| Concept task | Stage 2/3 capability boundary |
| --- | --- |
| 找出香港內容機會 | Saved evidence plus a link to existing `/opportunities`; real opportunity-result integration (plan 6h) requires separate approval. No generated demand/ranking numbers. |
| 改善一個現有頁面 | Saved owned-scan evidence. No new crawl or saved work-item write. |
| 建立有來源的 brief | Existing B1 `brief` saved-evidence summary; attaching source text to a model and saving work items remain held. |
| 比較競爭對手的內容 | Existing B1 `competitors`; preserve evidence-insufficient comparison/market-ranking limitations. |
| 解釋本週能見度變化 | Existing B1 `pulse`; absent/incomplete answers never become zero mentions. |
| 整理客戶報告 | Existing B1 `report` plus a link to `/reports`; no automatic publication or reporting write. |

Filtering uses the concept categories 全部 / 發現機會 / 改善內容 / 觀察成效 /
交付報告. The existing B2 platform selector needs a quiet composer-footer
control; the concept has no equivalent selector. Its behavior, default-zero cap
and unverified/search-execution labels must remain accurate.

## Legacy tools — verified destination references

These paths describe current repository destinations. Reuse the navigation
module where it provides a destination; keep its visibility and entitlement
rules. In particular `MONITOR_VISIBLE=false` at this base: a concept tile does
not authorize exposing a hidden monitoring section. Settings/admin destinations
are account/platform scoped rather than brand tools.

| Concept tile | Existing destination |
| --- | --- |
| 品牌概覽 | `brand?step=home` |
| 網站掃描 | `brand?step=scan` |
| 掃描結果 | `brand?step=results`; specific saved scan at `brand/result/{scanId}` |
| 改善建議 | `brand?step=improve` (existing plan gate) |
| Pulse 監測 | `brand?step=monitor` (existing visibility/feature rules) |
| Local Trust／ROI | `brand?step=roi` (overview card; existing gate) |
| 品牌實體 | `brand/entities` |
| 內容機會 | `brand/opportunities` |
| 觀察紀錄 | `brand/observations` |
| 核准來源 | `brand/sources` |
| 問題庫 | `brand/prompts` (existing plan gate) |
| 競爭對手 | `brand/competitors` |
| 引用來源 | `brand/citations` |
| 客戶報告 | `brand/reports` |
| 帳戶設定 | `/{lang}/dashboard/settings` |
| 管理工具 | `/admin` (existing admin authorization) |

## Interaction holds and later acceptance

- Stage 1 styles existing behavior without new IA/data flow; Stage 2 separates
  home/discussion and can read actual saved connector state. “選文件” stays
  disabled or links to existing sources.
- Stage 3 presents only steps that actually ran (load saved week, select records,
  compose extracts). The mock's vendor-query research theatre is never copied as
  a completed product run. Live output stays distinct and unverified.
- Stage 4 uses approved source versions and real binding/sync state read-only;
  absent GSC execution says “本次未查詢”. DataForSEO/Firecrawl remain unconnected.
  Retain observation/scan IDs, platform/time and confirmed/unknown search status.
- Stage 5 reads existing sources/work items through their owned services;
  switching brands isolates temporary drafts. Never imply durable private ACL
  or sharing based on the mock sidebar wording.
- Stage 6 remains held: attaching documents to prompts (6a), saving a work item
  (6b), persistent threads/ACL (6c), GSC queries (6d), DataForSEO (6e), Firecrawl
  (6f), durable quota (6g), and real opportunity-result integration (6h).

Future acceptance compares Home, Discussion, Thread list and Connectors with
the supplied screenshots and the inner baseline at 1440/900/390, en/zh-HK and
light/dark. Preserve keyboard/focus behavior, ≥44px targets, live announcements,
IME/newline behavior, draft isolation and refresh reset. Keep saved/live honesty
reachable in notes/inspectors and run the appropriate existing Studio/a11y tests
when implementation begins. Stage 0 does not implement or claim those results.
