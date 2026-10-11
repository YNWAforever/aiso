# AISO Audit Fixes — Codex GPT‑6.1 Sol Implementation Plan

> **For agentic workers:** 使用 `superpowers:executing-plans` 按以下任務逐項實作。每項使用 checkbox 記錄進度。不要因本計劃而自動新增多代理；沿用執行環境及使用者已選擇的工作方式。

**Goal:** 完成 AISO 審核包 F38–F50 的修復，讓使用者能完成「設定品牌 → 首次監測 → 查看可信的部分／完整結果 → 找到引用證據 → 建立改善工作 → 重測」流程。

**Architecture:** 延伸現有 Neon 資料層、onboarding service、Pulse run ledger、觀測證據及 work-item 版本機制。先統一狀態及分母，再接通可恢復的執行流程；原始回答、來源版本及舊草稿保持可追溯。Ansvisor 只作互動及流程參考，不整套搬入其後端。

**Tech Stack:** 審核基準為 Node 24.x、Next.js 16.3.8 App Router、React 19、TypeScript、next-intl、Neon PostgreSQL／Neon Auth、OpenRouter、Vitest、Playwright；實作日依 repository lockfile 核實。

**Spec:** `AISO-Audit-2026-10-11.zip` 內的 `report.md`、`findings.csv`、`tasks.csv`、`operations.csv`、`user-cases.md`、`evidence/manifest.json`、`evidence/verification.json`。本計劃保留原 T01–T12、F38–F50、UC01–UC13 編號。

**建議存入 repository 的位置:** `docs/superpowers/plans/2026-10-11-aiso-audit-fixes.md`。本次交付是執行計劃，未實作產品修復。

## Global Constraints

- Repository：`https://github.com/YNWAforever/aiso`；live：`https://aiso-kappa.vercel.app/`。
- 審核 SHA：`783e54e3fa99f8c14e4cab84a67b42b0b1513c3c`。這是2026-10-11的證據基準，不是要求把新版本退回此 SHA。
- 先讀最新 `AGENTS.md`、`CLAUDE.md`、`README.md` 及相關 Next.js 本地指南；使用 `proxy.ts`，不新增 `middleware.ts`。
- `db()` 使用 tagged-template SQL；每個租戶資料查詢與寫入均以 server-derived `account_id` 及所屬 client 限定。不要復活 Supabase client；`supabase/migrations/` 只是現有遷移目錄名稱。
- 使用 `resolveCommercialEntitlement()`，不要只用 plan 字串判斷權限。前端禁用按鈕不能取代 API 驗證。
- 保留 `en`／`zh-HK`。香港市場、語言及品牌身份須明確確認，不能由介面語言或品牌名推斷。
- 缺資料不是0；已要求搜尋不是已確認搜尋；網站就緒分數不是AI產品排名；API樣本提及率不是收入成效。
- 不把「40筆／31已分類／9未完成」硬編碼進產品；它是回歸 fixture。
- 不將未知的 legacy 模型、市場、時間補成推測值；`created_at` 不自動等於採集時間。
- 保持來源核准、允許代理使用、發佈及交付的現有界線。改善流程不可自動發電郵、webhook或發佈內容。
- 不新增另一套 auth、job queue SaaS、CRM 或CMS。需要新依賴時先查 repository，僅新增完成任務所需的依賴及 lockfile。
- 不改写舊 migration；新 migration 依執行時最新序號新增。採 additive、可相容 rollout；保留原始證據。
- 審核時完整 unit suite 被自動審核阻擋，只有3檔64測試及typecheck通過。此紀錄不能作為新分支的測試結果，也不能藉更換命令繞過阻擋。
- 排程配置與已部署排程分開。部署入口為 `cloudflare/aiso-worker/wrangler.jsonc`；勿誤用 legacy config，亦勿自行啟用 trial-email／Search Console trigger。

## Review Focus

以下五類情境必須有對應測試，不能只驗正常路徑：

1. **Legacy與新ledger混合、沒有完整manifest**：保持未知分母、去重及原始證據；T02、T04。
2. **重複點擊、失聯回應、過期lease及worker重啟**：一個intent一個工作，已存原文不重採集；T03、T04、T05。
3. **其他租戶ID、方案降級、執行中修改問題**：拒絕越權、重新檢查權益、使用不可變snapshot；T04、T05、T10、T11。
4. **有來源但無競爭者網域、私有hosting suffix、URL長尾**：不足以比較與真正無缺口分開，來源不錯合併、不遺失；T07、T08、T12。
5. **舊報告或批次資料部分失敗**：所有頁面狀態一致；操作有明確全部成功／未提交／衝突；不顯示假成功；T01、T03、T10。

## 1. 執行方式與完成定義

請直接實作，不要重新寫一份只有建議的報告。每項先重現、完成修改、驗證、記錄證據，再移至下一項。遇到局部阻擋，記錄具體原因並繼續其他不受影響工作；不要在完成第一批UI後就結束。

每個 finding 狀態使用：`untriaged → reproduced → implementing → verified_local → verified_preview → verified_live`；另有 `already_fixed_verified`、`blocked`、`not_reproduced`。`not_reproduced` 必須寫出測試情境及可能差異，不能直接當作修復。外部配置未驗證時只能標示相應阻擋，不能宣稱全產品完成。

建議三個可獨立review的PR階段，全部屬本次範圍：

| 階段 | 任務 | 可驗收成果 |
|---|---|---|
| A：可信顯示 | T01、T02、T06、T08 | 失敗無分數，部分結果可用，搜尋及競爭缺口不誤導 |
| B：首次成果 | T03、T04、T05、T09 | 新增品牌可恢復，監測可啟動、追蹤、修復，導覽有下一步 |
| C：日常維護 | T12、T07、T10、T11 | 完整引用、批次問題、合併行動及可比較重測 |

建議執行順序：**P00 → T01 → T02 → T06 → T08 → T03 → T04 → T05 → T09 → T12 → T07 → T10 → T11 → R01**。

T05依賴T03/T04/T06；T09依賴T05；T07採用T12的網域規則及T08的缺口狀態；T10依賴T03並遵守T04的snapshot規則；T11依賴T04/T05/T07/T10。不可把仍未完成的依賴標成已具備。

## 2. P00 — 先確認輸入、分支與測試邊界

- [ ] 讀取ZIP內七份內容文件，建立 `docs/remediation/2026-10-11/status.md`，逐一列出13 findings、12 tasks及13 user cases。
- [ ] 核對ZIP內容hash。本次已確認所有內容文件hash相符；原包 `checksums.json` 包含其自身的過期hash，只有自引用一項不符。保留原包，不把此一項誤判為內容被改動；將此已知包裝問題寫進輸入紀錄。其他hash不符須調查。
- [ ] `git status --short`、`git fetch origin`、記錄main SHA及與audit SHA的差異。使用獨立分支／worktree；不reset他人的未提交內容，不重做已合併且有驗證的修復。
- [ ] 檢查既有PR與近期migration，對每項 finding 做 `still_present / already_fixed / changed / blocked` 對照。由當前狀態實作。
- [ ] 讀 `.github/workflows/pr-gate.yml`、`vitest.config.ts`、`__tests__/setup/ci-network.ts`、相關測試及integration runner。先辨識出網來源／mock邊界，才運行相應suite；不能把環境審核限制當作測試失敗後忽略。
- [ ] 確認隔離preview資料庫、合成帳戶A/B、測試品牌、stub provider及可用部署權限。沒有preview帳戶時先完成pure/API測試與程式修改，將真實登入E2E單獨列blocked。
- [ ] 記錄目前資料表、migration版本及feature flags的**非秘密狀態**；不要印出credentials。核查 production 部署SHA與Worker實際狀態時，以可用授權工具讀取，不能只看repo配置。

**輸出：** baseline、finding狀態表、環境矩陣及已確認可安全執行的測試命令。P00不新增產品功能。

## 3. 共用設計契約

以下新增名称是實作目標，不代表repo已存在；如當前main已有同義型別，沿用並在狀態表記錄映射，避免第二套模型。

### 3.1 狀態與分母

T02在 `lib/view-models/pulse.ts` 定義／延伸：

```ts
type PulseDisplayState = 'not_configured' | 'empty' | 'pending' | 'partial' | 'complete' | 'failed' | 'blocked' | 'error';
type PulseCoverageView = {
  expected: number | null; // 只有可驗證manifest才有完整分母
  recorded: number;
  collected: number;
  classified: number;
  mentioned: number;
  collectionRate: number | null;
  classificationRate: number | null;
  mentionRate: number | null; // mentioned / classified；0 classified時null
  provenance: 'ledger' | 'legacy';
};
```

`classificationRate` 對已有原文的 collected 分母計算；UI另可顯示 `classified / recorded`，名稱不能混用。新ledger的 `expected/succeeded/failed/pending/blocked` 沿用 `RunCoverage`，不可把 classified 稱為成功採集數。Legacy只有40筆紀錄時可以呈現31/40已分類，卻不能推論整次工作預期只有40項。

### 3.2 執行身份

T04/T05以現有 `PulseScope = {accountId, clientId}` 為邊界。新增auth API的account由session取得，不接受body的accountId。一次使用者意圖有持久化 `intentKey`，而不是每次retry產生新key。

```ts
type PulseIntent = {
  intentKey: string;
  kind: 'initial' | 'repair' | 'retest';
  sourceRunId?: string;
};
type PulseStartResult = {
  runId: string;
  reused: boolean;
  status: PulseDisplayState;
  expectedItems: number;
  statusPath: string;
};
```

`repair`延續同一run，只處理未完成的collection/classification；`retest`建立新的可追溯樣本，保留原run。不把兩者當成同一按鈕。

外部供應商已接收請求但本地timeout時，無法單靠本地intent保證exactly-once收費。此類item保留`outcome_unknown`，先使用供應商實際支援的idempotency／查詢能力核對；無法核對時不得盲目自動重採集，須清楚顯示可能已有費用，另一次採集需要明確的新執行意圖及配額檢查。

目前migration 057及store有 `(client_id, scan_week)` 唯一性。要支援同週retest，T04須加入可區別run purpose/intent的身份：保留每品牌每週最多一個canonical weekly run，retest以account/client/intent去重。所有weekly rollup及引用查詢都要明確選run scope；不能只刪unique constraint便令retest重複灌入週分母。

### 3.3 API錯誤與版本

沿用repo error conventions，最少區分400格式、401未登入、404不屬帳戶、409版本／intent衝突、403權益、429配額、5xx服務問題。新多列寫入採transaction；樂觀版本衝突不得悄悄覆蓋。202表示持久工作已接受，不代表模型已完成。

## 4. T01 — 失敗掃描在所有入口一致無分數

**對應：** F43／UC05；無依賴。

**檔案：** 修改 `components/dashboard/RecentScans.tsx`、`lib/workspace/load-owned-portfolio.ts`、`lib/workspace/load-owned-workspace.ts`、`lib/types.ts` 及結果／匯出相關projection；沿用 `lib/scan-evidence.ts` 的evidence reader。新增 `lib/view-models/scan-status.ts` 如當前沒有共用projection。

**介面：** `projectScanStatus(input: { score: number | null; grade: string | null; evidence: unknown }): { state: 'scored' | 'failed' | 'limited' | 'unknown'; score: number | null; grade: string | null }`。以現有報告詳情的可信分數predicate為準；缺欄位的legacy資料不得一律假定failed或scored。

- [ ] 在 `__tests__/components/recent-scans.test.ts` 與新增 `__tests__/lib/scan-status.test.ts` 加回歸：同一 `failedEvidence` 即使raw score=3.5、grade=F，display score/grade也為null；明確成功舊報告保持原分數；unknown標示未知。
- [ ] 先运行指定測試並確認失敗原因命中問題；修改reader帶回必要evidence並共用projection，卡片顯示「掃描未完成／查看原因」。不可更改資料庫原始分數掩蓋問題。
- [ ] 核對portfolio、品牌最近掃描、結果詳情及現有匯出使用同一規則。保留目前無效URL攔截，不重寫scan引擎。
- [ ] 執行上述tests及相關result tests；preview重現失敗卡片→詳情一致，並核對一個正常報告。
- [ ] 提交 `fix: keep failed scan scores out of summary views`，記錄UC05證據。

## 5. T02 — 保留部分結果，清楚顯示覆蓋率

**對應：** F40／UC03；無依賴。

**檔案：** `lib/pulse/observed-summary.ts`、`lib/view-models/pulse.ts`、`lib/view-models/portfolio.ts`、`lib/workspace/load-owned-pulse.ts`、`lib/workspace/load-owned-portfolio.ts`、`components/pulse/ObservedPulseView.tsx`、`components/dashboard/BrandCard.tsx`、`components/dashboard/WorkspaceHome.tsx`，及相關翻譯。

**介面：** `projectObservedSummary()`保留existing consumers的兼容入口，增加3.1的coverage與狀態；`buildPulseView()`將它原樣傳到UI，不能再次縮成ready/empty。完整KPI及部分樣本KPI分開標示。

- [ ] 擴充 `__tests__/lib/pulse-view.test.ts`、`__tests__/lib/portfolio.test.ts`、`__tests__/components/pulse-view-render.test.tsx`：fixture 40紀錄、31已分類、9unknown、3提及，assert state=partial、mentionRate≈3/31，而非3/40；0 classified→null；31個全negative→0且有分母。
- [ ] 增加legacy expected=null、provider失败、DB读取失败、周次缺口的fixtures；確認error不被呈現empty，缺週不補0。
- [ ] 實作projection及三個入口一致的coverage。UI顯示「31／40個已記錄回答完成分類」及查看未分類項目連結；有manifest時另示完成採集／預期項目。
- [ ] 原文仍可閱讀；不因partial隱藏所有圖表。部分點以不同標記與提示呈現；不同scope或缺背景時不顯示可比較增幅。
- [ ] 執行上述指定tests及 `tests/e2e/c8c-pulse.spec.ts` 的fixture驗證，提交 `fix: expose partial pulse coverage consistently`。

## 6. T06 — 搜尋請求與搜尋證據分開

**對應：** F42／UC06；先於T04。

**檔案：** `lib/pulse/grounding.ts`、`lib/openrouter.ts`、`lib/pulse/runs/schema.ts`、`components/observations/ObservationDetail.tsx`、`components/observations/copy.ts`、`messages/en.json`、`messages/zh-HK.json`。

**介面：** 保留legacy `grounding` 可讀；新增 `SearchEvidence = { requested: 'web' | 'native' | 'none' | 'unknown'; execution: 'confirmed' | 'unknown'; basis: 'provider-search-event' | 'request-only' | 'legacy'; }`。只從供應商明確search事件／協議證據確認execution；一般citation列表本身不自動等於即時search。

- [ ] 在 `__tests__/lib/pulse-grounding.test.ts`、`__tests__/components/provider-citations-render.test.tsx` 測 `web + no confirmation → requested/unknown`；native capability亦不保證每次列出引用。
- [ ] 實作記錄和顯示：「已要求網絡搜尋」與「供應商已確認搜尋」分開；unknown、recorded empty及有citations保持三種狀態。
- [ ] 移除「Perplexity一定會列出來源」；保留模型API樣本與消費者AI產品的分別。
- [ ] 驗證中英文及舊回答沒有被錯標confirmed；提交 `fix: distinguish requested search from confirmed evidence`。

## 7. T08 — 競爭引用的設定前置狀態

**對應：** F45／UC08；無依賴。

**檔案：** `lib/citations/report.ts`、`components/dashboard/CitationExplorer.tsx`、`lib/competitors/store.ts` 及翻譯；先保留T07將延伸的report型別。

**介面：** `gapCoverage: { state: 'not_configured' | 'partial_config' | 'no_observations' | 'ready'; configuredCompetitors: number; competitorsWithDomains: number }`。

- [ ] 擴充 `__tests__/lib/citation-sources.test.ts`、`__tests__/components/citation-explorer.test.tsx`：0競爭者→not_configured；有名稱無domain→partial_config；完整設定無回答→no_observations；有有效觀測且無gap才可顯示沒有缺口。
- [ ] 實作設定提示及「設定競爭對手網域」CTA；部分競爭者有domain時列比較範圍及缺少數量。
- [ ] 保留 `lib/competitors/store.ts` 已有legacy names sync/mirror，不重建競爭者資料層。
- [ ] 通過指定tests，preview核對四種狀態；提交 `fix: show citation comparison prerequisites`。

## 8. T03 — 統一新增品牌與可恢復onboarding

**對應：** F38、F50／UC01、UC02、UC13。

**檔案：** `components/dashboard/AddBrandWizard.tsx`、`components/onboarding/OnboardingWizard.tsx`、`app/api/dashboard/clients/route.ts`、`app/api/onboarding/complete/route.ts`、`lib/onboarding/schema.ts`、`lib/onboarding/service.ts`、`lib/onboarding/store.ts`。

**介面：** 沿用 `parseOnboardingInput()`、`completeOnboarding(scope, input, generate)` 及 `OnboardingProgress`。Portfolio新增品牌導到共用wizard；舊clients POST若仍有caller則成為相同brand validation/store的compat adapter，不能另走沒有進度的insert路徑。缺語言／市場確認的legacy request可以保留品牌，但狀態必須待設定，不能偷偷seed英文。

- [ ] 擴充 `__tests__/lib/onboarding-schema.test.ts`、`__tests__/api/onboarding-flow.test.ts`、`__tests__/api/onboarding.test.ts`，新增必要的 `__tests__/api/dashboard-client-create.test.ts`。測試空白brand、非string domain、malformed JSON、過長輸入、跨帳戶clientId及容量限制。
- [ ] 測試相同account+intentKey兩次提交回同一client；response遺失後重試不多建品牌；相同intent不同payload返回409。seed失敗後可重试同一品牌。
- [ ] 統一industry canonical values並為既有顯示值提供兼容讀取；不批量改写歷史資料。domain驗證與正規化使用現有安全規則，不因建立品牌就自動抓取陌生URL。
- [ ] 接通四步wizard與新增入口；加try/catch/finally、非JSON錯誤fallback、欄位錯誤和可恢復狀態。更新成功後進入新品牌的問題確認步驟。
- [ ] 保留既有24題種子上限及四類問題，先讓用戶檢視確認。審核提議先呈現5–10題屬UX建議，本輪不另行改動seed數量／採樣策略，避免把缺陷修復變成未驗證採樣政策變更。
- [ ] 移除沒有事實依據的「下次掃描自動開始」提示；T05接好後顯示開始監測CTA。
- [ ] 執行指定unit/API tests、`tests/e2e/onboarding-recovery.spec.ts` 與 `tests/e2e/prompt-context.spec.ts`；提交 `fix: unify resumable brand onboarding`。

## 9. T04 — 完整採集背景、分類修復與run隔離

**對應：** F41／UC04；依賴T06契約。這是資料修復核心，不能以顯示文案取代。

**檔案：** `lib/pulse/runs/{schema,store,service,classification,queue,worker}.ts`、`lib/openrouter.ts`、`lib/pulse/summary.ts`、`lib/workspace/load-owned-pulse.ts`、`lib/observations/{types,store}.ts`、`app/api/pulse/run/route.ts`、`app/api/cron/pulse/route.ts`；必要新migration。

**介面：** 保留 `runPulseChunk()`、`classifySavedAnswers()`、lease/fence及worker ports。`createOrResumeRun()`延伸至3.2的intent/purpose；新增 `repairLegacyClassifications(scope: PulseScope, input: { observationIds: string[]; intentKey: string; deadlineAt: number }): Promise<{ classified: number; unchanged: number; failed: number }>`，batch上限沿用現有安全限制；如沒有可用限制，明確設50並在schema驗證。

- [ ] 在 `__tests__/lib/pulse-run-ledger.test.ts`、`__tests__/lib/pulse-classification.test.ts`、`__tests__/lib/pulse-worker.test.ts` 及integration `pulse-runs.test.ts` 加repro：已有raw answer的unknown只呼叫classifier，answer collector次數=0；同intent再次repair不增加成功classification版本。
- [ ] 測試兩個worker搶同item、stale lease完成、timeout outcome unknown、供應商實際model缺失、計劃降級、跨tenant observation ID；原文與原provider citations始終不被覆寫。
- [ ] 新採集保留requested/actual model、provider request ID（僅內部必要欄位）、collectedAt UTC、prompt snapshot、language/market、finish reason、search evidence及供應商usage。unknown維持null；建立明確source與schema版本。
- [ ] 修復相容writer丟metadata及question-only context；新run優先走ledger。舊raw可追加classification修復紀錄，不偽造舊manifest，也不重新付費採集原文。分類本身的模型成本仍要記錄。
- [ ] 根據3.2建立同週retest身份；legacy run保留canonical標記。交易性claim/resume維持唯一性及帳戶scope。migration先在隔離DB驗證，再計算受影響行數；不可自動對production大批重算。
- [ ] 全面核對weekly summary、observed counts、citation report、opportunity readers：canonical weekly與retest互不重複計算；使用者選run後資料來源一致。測試 `new retest → canonical weekly denominator unchanged`。
- [ ] 再開來源不完整舊記錄，能看到真實已保存欄位及unknown；完成分類後coverage可更新且原文hash不變。
- [ ] 通過focused tests與真實隔離DB persistence/concurrency測試，提交 `fix: preserve pulse provenance and repair saved answers`。若正式flag未確認，狀態停在verified_preview而非fixed_live。

## 10. T05 — 首次監測、進度、修復與排程

**對應：** F39／UC01、UC03、UC04；依賴T03/T04。

**檔案：** 新增 `app/api/dashboard/clients/[clientId]/pulse-runs/route.ts`（GET/POST）、`app/api/dashboard/clients/[clientId]/pulse-runs/[runId]/route.ts`（GET）、`lib/pulse/runs/user-dispatch.ts`、`components/pulse/RunProgress.tsx`；延伸 `lib/view-models/daily-work.ts`、`components/dashboard/WorkspaceHome.tsx`、`components/observations/RunTroubleshooting.tsx` 及現有worker。

**介面：** `startOrResumeUserPulse(scope: PulseScope, intent: PulseIntent): Promise<PulseStartResult>`；clientId取URL，account取session，kind/intentKey經schema驗證。GET只讀同帳戶run、coverage、可安全顯示的reason及下一步。

- [ ] 新增 `__tests__/api/user-pulse-runs.test.ts`：未登入401；他人client/run 404；無權益拒絕；未确认context拒絕；無active prompts顯示not_configured；雙POST同intent只有一run與一份reservation。
- [ ] 啟動前展示問題數×可用model variants、剩餘配額、搜尋選項；無provider成本估算時只顯示可驗證的工作量，不捏造金額。成本／配額reservation要transactional，不能先花費再拒絕。
- [ ] POST先持久化工作再回202；復用現有bounded worker及server-side trigger喚醒。`after()`只能作喚醒，不能是唯一可恢復紀錄；中斷後既有巡檢／repair機制能找到queued work。不得把cron secret發給瀏覽器。
- [ ] initial使用canonical週run；repair續既有run；retest是新intent與新manifest。按鈕清楚區分，已完成工作不因reload重跑。
- [ ] UI顯示queued/running/partial/complete/failed/blocked、採集及分類數、原因與可用retry；poll有退避、離頁停止，重新進入可恢復。分類不完整不能只因採集完成就顯示全部完成。
- [ ] `nextDueAt`只能來自已驗證的實際排程設定；分開設定未知、已停用、下一次到期及最近成功。UTC儲存、香港時間顯示。repo的daily cron不是每個品牌每日再付費跑整週。
- [ ] 新增 `tests/e2e/first-pulse-run.spec.ts`，真實preview持久層＋stub provider驗证開始→部分完成→修復→完整；重啟worker後可續；再測權益在執行中改變。
- [ ] 提交 `feat: start and recover authenticated pulse runs`。部署驗收要另外確認worker可工作；202本身不算完成。

## 11. T09 — 清晰品牌選擇及啟用下一步

**對應：** F46／UC01、UC09；依賴T05。

**檔案：** `components/dashboard/{DashboardSidebar,ActivationProgress,PortfolioView,WorkspaceHome,BrandCard}.tsx`、`lib/view-models/{activation-progress,daily-work}.ts` 及翻譯。

**介面：** 下一步projection輸出 `{ kind, labelKey, href, reasonKey? }`；kind覆蓋 `create_brand | confirm_prompts | start_run | review_results | review_opportunity`，而非把URL判斷散落在元件。

- [ ] 擴充 `__tests__/components/dashboard-sidebar-portfolio.test.tsx`、`__tests__/components/portfolio-activation.test.tsx`、`__tests__/lib/daily-work.test.ts`：有Pro但未選品牌顯示先選品牌；無權益才顯示方案限制；下一步連結真實可到達。
- [ ] 首頁以一個主要CTA顯示眼前最需要的動作：設定不足→補設定；沒有run→開始；partial→修復／查看；complete→結果與行動。
- [ ] 新增首次結果／首次改善的derived進度，保留原核准／交付audit milestones，不批量改寫歷史達成紀錄。來源核准在需要使用來源時才作contextual下一步。
- [ ] 收起重複證據限制詳情，保留影響本次判讀的coverage及未知背景；修正raw industry key顯示。
- [ ] 驗證desktop及375px viewport、鍵盤焦點、螢幕閱讀器label；提交 `fix: guide users from brand setup to first result`。

## 12. T12 — 正確處理公共及私有網域後綴

**對應：** F49／UC12；先於T07。

**檔案：** `lib/citations/normalize.ts`、`lib/citations/classify.ts`、`lib/citations/report.ts`，必要的dependency/lockfile。

**介面：** 保留 `registrableDomain(host: string): string` 及 `isWithin()`契約，以維護中的PSL實作並啟用private suffix支援；依執行時官方文件核實選定library API。聚合規則記 `normalizationVersion`，舊原始URL不改寫。

- [ ] 純URL測試assert：`foo.github.io !== bar.github.io`，而`personal.hsbc.com.hk → hsbc.com.hk`；測`.co.uk`、IP、localhost輸入邊界、IDN及不合法host。明確invalid策略，不讓invalid與真domain相撞。
- [ ] 測同一正規化domain的分類穩定且與input order無關；owned/competitor使用完整scope，不因hosting suffix誤匹配。
- [ ] 替换手寫suffix規則，保留tracking query正規化既有行為，不順便更改URL身份政策。
- [ ] 跑 `__tests__/lib/citation-sources.test.ts`；輸出舊／新聚合差異的dry run規格，需重算時先量度，不能靜默改報表歷史。
- [ ] 提交 `fix: isolate citation sites using public suffix rules`。

## 13. T07 — 完整引用篩選、分頁、匯出與回答回溯

**對應：** F44／UC07；依賴T08/T12，讀取T04的run scope。

**檔案：** `lib/citations/report.ts`、新 `lib/citations/query.ts`、`components/dashboard/CitationExplorer.tsx`、`app/api/dashboard/clients/[clientId]/citations/route.ts` 及觀測detail連結。

**介面：** `CitationQuery = { kind?: CitationKind; domain?: string; platform?: string; promptId?: string; runId?: string; from?: string; to?: string; page: number; pageSize: number }`；`CitationPage<T> = { items: T[]; total: number; page: number; pageSize: number; scopeKey: string }`。pageSize預設25、最大100；預設時間scope沿用現有8週，UI明示，所有子表／CSV沿用相同scopeKey。

- [ ] 擴充 `__tests__/lib/citation-sources.test.ts`、`__tests__/api/citations.test.ts`、`__tests__/components/citation-explorer.test.tsx`：60domain fixture，第51項唯一review；篩選review得到該項，full total=60；排序同值有穩定次序；page無重複漏項。
- [ ] 改成先scope→aggregate→filter→sort→paginate。來源類型列表與總數取完整scope，不從當前頁推算。不能只把TOP=50改大。
- [ ] 對domains/URLs/gaps統一日期、platform、prompt及run scope；server驗證filter及租戶權限。大量資料採資料庫聚合／有界分頁，不把所有raw answers送browser。
- [ ] CSV使用同一query但遍歷完整結果，清楚顯示匯出範圍與筆數；有上限時拒絕或明示分段，不靜默截斷。防CSV formula injection，保持中文UTF‑8及quote正確。
- [ ] 網域／URL可展開對應的prompt、platform、run及回答證據；只有讀取授權範圍內的回答，外部引用開新頁不帶referrer。
- [ ] 加無資料、filter無結果、讀取error及匯出error狀態；preview完成第51項查找→原回答→CSV行數核對。
- [ ] 提交 `feat: make citation exploration complete and traceable`。

## 14. T10 — 問題庫批次維護及明確市場背景

**對應：** F47／UC10；依賴T03/T04。

**檔案：** `components/pulse/{PromptBankEditor,QuestionBankSection,QuestionRow}.tsx`、`app/api/dashboard/clients/[clientId]/prompts/route.ts`、`app/api/dashboard/clients/[clientId]/prompts/[promptId]/route.ts`、`lib/prompts/{context,categories,guard}.ts`；新增 `lib/prompts/bulk.ts` 及 `app/api/dashboard/clients/[clientId]/prompts/bulk/route.ts`，需要時新增import preview route。

**介面：** `previewPromptImport(scope, rows) → { validRows, errors: {row, field, code}[], duplicates, activeAfter }`；`applyPromptBatch(scope, { intentKey, changes, expectedVersion }) → { updatedIds, activeCount, version }`。確定寫入前重新驗證scope、版本、active上限及配額，preview結果本身不授權寫入。

- [ ] 擴充 `__tests__/api/prompt-bank.test.ts`、`__tests__/components/prompt-bank-network.test.tsx`、`__tests__/lib/prompt-context.test.ts`，新增 `__tests__/lib/prompt-bulk.test.ts`：24及50題；含quoted comma/newline的CSV；重複／空白／非法language/market；超MAX_PROMPTS；跨tenant混入ID。
- [ ] 採全有或全無transaction，任一行不合法不部分儲存；返回可修正的row errors。版本衝突409，重複intent不重寫。
- [ ] 顯示可排序及篩選的題目清單、多選啟停、批次市場語言編輯、CSV預覽與確認；保留逐題editor。僅顯示一處active總數。
- [ ] 選擇範圍明示「目前頁／已選N題」，不能將隱藏結果默認全選。缺市場標「未設定」；修改確認後才儲存。
- [ ] 每題顯示最近run、採集／分類覆蓋及觀測連結。執行中變更題目只影響下一個manifest，不改正在跑的snapshot或舊回答背景。
- [ ] 執行 `tests/e2e/prompt-bank-accessibility.spec.ts`、`tests/e2e/prompt-context.spec.ts`；提交 `feat: support safe bulk prompt maintenance`。

## 15. T11 — 合併證據成可驗收的改善工作

**對應：** F48／UC11；依賴T04/T05/T07/T10。

**檔案：** `lib/opportunities/{types,rules,service,store,fingerprint,presentation}.ts`、`lib/work-items/{schema,service,store,snapshot,edit-input}.ts`、`components/opportunities/OpportunityWorkspace.tsx`；延伸既有work-item API及版本畫面，先用 `rg` 確定當前router位置，勿另開重複work系統。

**介面：** 新增 `OpportunityGroup = { key: string; promptId: string | null; scopeKey: string; evidenceRefs: SourceRef[]; platforms: string[]; savedWorkItemId: string | null }`；`groupOpportunities(input: Suggestion[]): OpportunityGroup[]`。按client、不可變問題內容／context及同run或明確相同觀察scope分組；不同市場、語言或不同題目版本不能只按promptId合併。

- [ ] 在 `__tests__/opportunities/rules.test.ts`、`fingerprint.test.ts`、`store.test.ts`、`ac-06-convergence.test.ts` 及 `__tests__/components/opportunity-render.test.tsx` 測：同scope的5平台→一個group保留5項證據；不同market→不同group；rerender／reload→相同key；同intent不多建draft。
- [ ] 現有單source `DraftSnapshotV1`保留讀取；如需多證據快照用versioned V2並加adapter，不重寫舊草稿或更換既有ID。與現有multi-source旗標及source approval機制兼容。
- [ ] 增加 `targetUrl`、`ownerId`、`dueAt`、`acceptanceCriteria` 及操作進度；targetUrl只允許HTTP(S)，owner必須屬帳戶。操作進度與審批／發佈状态分開，不把保存或done當作已核准／已發佈。
- [ ] 使用可解釋優先序：證據新鮮度／數量、問題意圖、使用者已確認的重要性及所需工作；缺商業數據標未知，不輸出臆測ROI或保證曝光提升。
- [ ] 工作卡顯示「改哪頁、改甚麼、依據、完成條件、負責人、期限」；目標頁未知要提示使用者填寫，不能由隱去path的舊scan證據編造exact page。
- [ ] 完成改善可啟動retest，沿用之前問題、市場、語言、platform/model manifest；如果模型或scope不能保持一致，明示不可直接比較。重測不修改原run，canonical週報不重複計數。
- [ ] 新增 `tests/e2e/opportunity-action-loop.spec.ts`：觀測→引用→合併行動→保存→記錄人工完成→stub retest→展示差異與限制；不執行外寄或自動發佈。
- [ ] 提交 `feat: connect grouped evidence to measurable work items`。

## 16. R01 — 回歸、preview、發布與重新審查

### 測試層次

先讀實際測試檔，確認合成fixture與禁止非預期出網；每task以小範圍測試開始。對低影響文案／樣式不另建鏡像實作的測試，使用既有render/E2E驗證；狀態、分母、交易、租戶、重試及資料兼容必須有行為測試。

每次相關focused tests可用以下形式，路徑取該task已確認的檔案：

```bash
CI=1 node_modules/.bin/vitest run __tests__/lib/pulse-view.test.ts __tests__/components/pulse-view-render.test.tsx
npm run typecheck
npm run lint
```

完整suite只有在已查清出網問題、具備隔離與授權後才執行 `CI=1 npm run test:unit`；若環境仍拒絕，不移除CI guard、不換network path重試，記錄blocked並使用可運行的獨立測試。現有CI也不能把skipped integration當pass。

- [ ] 按最新 `.github/workflows/pr-gate.yml` 完成 static、unit-contract、integration、e2e-accessibility、build、cloudflare-worker 六類job及aggregate gate；文件舊稱四類不作準。
- [ ] `npm run build`使用repository支援的fixture配置及synthetic `NEON_AUTH_COOKIE_SECRET`；不從production提取秘密。Neon integration採可丟棄隔離環境，不對production執行fixture或migration測試。
- [ ] E2E使用repository的component fixture preparation及`E2E_FIXTURE_MODE`流程；API／DB／worker的integration另行驗證。不能用靜態fixture E2E取代真實persistence測試。
- [ ] 同一份preview部署完成UC01–UC13；記錄fixture、帳戶role、期望、實際、commit、環境、日期、結果及證據路徑。
- [ ] 375px及desktop完成主要五步、keyboard焦點、錯誤訊息、loading、雙擊、返回及reload；檢查最少正常／空／partial／error各一種。
- [ ] 量度citation查詢及批次API在最大支援fixture下的時間和rows，與同環境baseline比較；查清明顯回退及query plan，不能只以主觀「快」驗收。不要為此向production壓測。

### 發布順序

- [ ] 先部署向後兼容schema及readers，再部署writer／worker，再讓UI導向新路徑。feature flag狀態、migration ID及actual deployment SHA記在release記錄。
- [ ] 經preview驗證後，在既有使用者授權及環境允許範圍內完成merge/deploy；如果尚欠特定授權，先做好可審PR、migration dry run、preview證據與rollback，最後一次清楚說明需要確認的實際動作。不要為可逆實作反覆詢問。
- [ ] 核對Vercel alias實際SHA；另核對Cloudflare Worker實際部署及觸發紀錄。兩者成功不能互相代替。
- [ ] 只有具體允許的合成scope與已確認配額可作真實provider smoke；其餘使用stub。記錄採集成功、分類成功、費用及provenance。未授權／不可用時，只把此一項列blocked，不能假稱live閉環已驗證。
- [ ] 正式站先唯讀重查失敗卡片、partial結果、來源分頁及空競爭者提示；涉及新品牌或付費run則沿用已批准測試scope。
- [ ] 排程驗收包括至少一次實際執行receipt或已授權受控觸發；若仍未觀察定時觸發，明示待觀察，不以repo cron字串結案。

### 回退

先停止新dispatch／新入口，再回退app或worker到兼容版本；保留run、attempt、原文、來源及草稿。不要drop新表或把UNKNOWN填0以求舊頁正常。遷移後的舊版本相容性須在preview先驗證。T01/T02等修復不應以重新顯示錯分數或假完整狀態作長期rollback。

## 17. 最终交付與自我檢查

提交以下內容，並以同一SHA串起程式與證據：

- `docs/remediation/2026-10-11/status.md`：13 findings各自的修復／已修／阻擋狀態及證據。
- `docs/remediation/2026-10-11/implementation-notes.md`：關鍵設計、schema與compatibility、與本計劃的必要差異。
- `docs/remediation/2026-10-11/acceptance-results.csv`：UC01–UC13，以及新增concurrency/tenant/retest案例。
- `docs/remediation/2026-10-11/release-runbook.md`：migration、feature flags、app/worker順序、配額、health及rollback。
- 測試摘要與可定位log；PR連結／commit、preview、production驗證狀態。秘密或完整客戶原文不得進repo。

**完成條件：** T01–T12都有實作或可核實的已修證據；UC01–UC13在相應層次有結果；新增行為通過必要CI；first-run、repair、same-week retest不因本地重複提交而重採集或污染週報，外部outcome_unknown依3.2處理；舊資料可讀；剩餘阻擋具體寫明。只「程式能build」、只「按鈕存在」、只「202 accepted」均不足以結案。

本計劃自我檢查：F38/F50→T03；F39→T05；F40→T02；F41→T04；F42→T06；F43→T01；F44→T07；F45→T08；F46→T09；F47→T10；F48→T11；F49→T12。13項全部有對應；原audit 9項未測範圍仍須在R01說明哪些已補足、哪些保持未測。

## 18. 可直接貼入 Codex GPT‑6.1 Sol 的啟動指令

```text
你是 Codex GPT‑6.1 Sol，請實作 AISO 審核修復，不要只輸出另一份計劃。

Repository: https://github.com/YNWAforever/aiso
Live: https://aiso-kappa.vercel.app/
附件：AISO-Audit-2026-10-11.zip
執行計劃：AISO_Codex_GPT-6.1-Sol_Implementation_Plan_2026-10-11.md

先讀兩份附件的完整內容、AGENTS.md及CLAUDE.md，從最新main建立隔離工作分支；核對審核SHA與現在的差異，避免覆蓋他人工作或重做已修項目。

依計劃 P00 → T01 → T02 → T06 → T08 → T03 → T04 → T05 → T09 → T12 → T07 → T10 → T11 → R01 執行，完成全部12項修復及13個案例的適用驗證。保留F/T/UC編號，逐項更新狀態。

沿用Neon、現有onboarding service、Pulse run ledger、worker及work-item版本機制。不要重建auth或移植Ansvisor整個系統。先修可信狀態，再接通「品牌→問題→首次監測→回答與引用→改善工作→重測」流程。

特別防止：把unknown當0、把partial當empty、把requested search當confirmed、重試重採已有原文、重複點擊多建品牌或多付費、same-week retest污染canonical週報，以及跨tenant存取。

先閱讀出網及fixture配置才跑測試。審核包的64/64不是本次完整驗證；不要繞過自動審核、關掉network guard或把skipped測試算pass。使用合成fixture與隔離preview完成回歸，阻擋某一項時繼續其他可做工作。

合理的可逆實作自行決定；必要時記錄取捨，不反覆詢問。對外寄送、發佈、付費及正式環境變更遵守本session已有授權與環境限制；如缺必要授權，先完成PR、preview、測試及rollback，再提出具體的最後確認。

持續工作直至修復、必要測試、review、preview及可執行的發布步驟完成。最終交付finding狀態表、UC驗收結果、commit/PR、測試結果、部署SHA、release/rollback及未完成的具體阻擋。沒有live證據的項目不得稱為verified_live。
```
