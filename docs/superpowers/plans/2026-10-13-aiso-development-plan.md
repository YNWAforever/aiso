# AISO 後續產品開發 Implementation Plan

> **For agentic workers:** 使用 `superpowers:executing-plans`，按任務逐項實作及更新 checkbox。執行對象為使用者指定的 **Codex GPT-6.1 Sol**；本文件不聲稱目前工作階段已切換模型。預設由一位執行者順序完成；不自動派遣其他 agents。

**Goal:** 修復稽核中的可信度及操作問題，讓新用戶以網址、確認語言／市場及審閱草稿完成首個品牌，獲得清晰的監測下一步，並讓指定 Super Admin 安全查看全平台九類業務資料。

**Architecture:** 延伸現有 Next.js／Neon 架構、品牌草稿、onboarding intent、Pulse run ledger 及 Admin directory。AI 負責有來源的草稿；規則決定下一步、權限及可執行動作。每個工作流先在合成資料及隔離環境驗證，再以同版本證據驗收 hosted 部署。

**Tech Stack:** 稽核候選為 Node 24.x、Next.js 16.3.8、React 19.2.5、TypeScript、next-intl、Neon Auth/Postgres、既有 OpenRouter adapter、Vitest、Playwright、Vercel 及既有 Cloudflare Worker。執行時以當前 lockfile 為準；本計劃不要求升級依賴。

**Spec:** `docs/remediation/2026-10-12/source/AISO-Audit-2026-10-12.md`、同目錄 remediation/use-case CSV、`repro/audit-score-boundary.test.tsx`；以及本文件「產品行為規格」。原 ZIP 隨包保留。

**計劃日期：** 2026-10-13，Asia/Hong_Kong。**本次交付：** 計劃、任務及新增測試規格；沒有修改、測試執行或部署產品。

## Global Constraints

- 先讀 repo 的 `AGENTS.md`、`CLAUDE.md` 及 `node_modules/next/dist/docs/` 相關指南；沿用 `proxy.ts`，不新增 `middleware.ts` 或 Supabase client。
- SQL 使用 `db()` tagged template。租戶查詢明確包含 `account_id`；全平台查詢只可在 server-side platform-admin guard 後執行。
- EN 與 zh-HK 同等支援；新文案放 `messages/en.json`、`messages/zh-HK.json`。語言及市場由用戶確認，不因品牌名稱推測。
- 保留 F51–F65、UC20–UC59、T20–T29 的追蹤關係。新增 T30–T36、UC60–UC79；舊證據不覆寫成新版本通過。
- 稽核的 40 案為 22 pass／7 fail／9 blocked／2 not-tested；其中 24 個 live 案為 19 pass／5 fail。這些是 2026-10-12 結果，不是本計劃執行後結果。
- 區分 code-only、mock/fixture、隔離真實 Auth/DB、真實 provider、hosted、production；CI 綠燈及 deployment READY 不能代替真實流程驗收。
- UI／本機修復不依賴正式管理員授權。正式角色授予、migration、provider 費用、排程啟用、merge/deploy 需有適用授權，不能從本計劃推定。
- 保留兩項歷史自動審批拒絕：Vercel 預覽登入交界、正式 onboarding/readiness POST。未取得相應存取／操作授權前，不改通道或關閉保護來重試。
- 不重跑 063–070 migrations。報告只引述 PR89 已執行；若需確認，查當前 ledger、checksum、grants 及授權 release receipts。舊 `through062` 不是現況證據。
- 以原 run／intent 復原未知結果；不盲目再收集、再扣費或產生另一品牌。清理只限有清單的隔離合成資料。

## Review Focus

1. 小數接近評級門檻、動畫中段及 reduced motion：文字不升到下一級，最終值與儲存值一致。T20／T22；UC44、UC60。
2. 瀏覽器沒有可用 storage、重新整理、切換帳戶、AI 回應晚於人手編輯：不覆蓋輸入或讀取另一帳戶草稿。T28／T29；UC62、UC63。
3. 伺服器成功後回應遺失、同 intent 不同 payload、session 中途撤銷：不重複品牌／問題／run。T28／T34；UC48、UC58、UC64、UC78。
4. 監測關閉、額度不足、缺模型、legacy 資料及 unknown cost：不顯示假可用、零成本或假完成。T25／T31；UC35、UC65、UC66。
5. Admin 快速切換篩選、舊請求晚到、超過 25 筆、schema 查詢失敗：不混合帳戶結果，unknown 不變成空白健康狀態。T27；UC50–52、UC70、UC71。

---

## 1. 證據基準與開始方式

輸入：`AISO-Audit-2026-10-12.zip`，21 檔；其中 20 檔有 checksum，已逐檔核對一致。

ZIP SHA-256：`da78937890270fb1aca6a695c3afa47c932e3eb6737c08531b7007b314db20ca`。

| 稽核時版本 | SHA／狀態 | 執行者的處理 |
|---|---|---|
| main／production | `a7ab604e4b49a85e080e9cf447d2785c52b39968` | 先核對現在 main 及 live，不退回舊 SHA |
| PR90 | `ee9a457a26b274fd099616a325817c70f709a833`；當時 draft/open | 建議 drawer 與儲存復原已寫碼，先查是否合併，不重寫 |
| PR91 | 已合併進上述 main | 保留 request-context OIDC 限同 deployment 的修復 |
| PR92 | `03c7b806facfde73d20792f7ac2c121a72c9c18c`；當時 open | 公開頁／sign-in／result polish 已寫碼；需修 F61/F62/F64 |
| PR92 tested merge | `399b35ff372ff4e1064fd1aa2dc31072b9236771` | 當時 tree 與候選一致；不能替代新組合版本 CI |

本次僅讀取上述 PR92 本機 checkout 以核對檔案及介面，沒有重新查詢 GitHub／live 狀態。若檔案在現在分支已搬移，T30 記錄實際對應再執行。

稽核 CI：PR92 5,977 unit、958 browser、419 integration 通過；新重現 2 項 RED。PR90 的 994 browser 屬另一分支；不能把两組數字相加作 release 分母。

## 2. 產品行為規格

### A. 新用戶：少輸入，先得到可用結果

1. 網址為唯一必須手動輸入的起點；語言／市場清楚顯示並讓用戶確認。已選值不重問。
2. 沿用「AI 建立品牌草稿」；顯示品牌名稱、簡介、行業、來源首頁、讀取時間及「待你確認」。沒有證據的欄位顯示待補充，不填假資料。
3. 「使用這份草稿」只套入表單；最後「建立品牌」才提交。進階欄位如 competitors 可選填，首輪不新增必填欄位。
4. 生成中可轉人工；失敗、429、逾時、返回、reload 都保留網址／語言／市場／已編輯內容。人手修改後不被較遲 AI 回應覆蓋。
5. 沿用現有最多 24 條 seed questions 及類別／語言／市場契約；本輪不另改方案配額。品牌建立及問題生成分開顯示；問題失敗仍能进入品牌、編輯問題或安全重試。
6. 完成後落在已建立品牌頁，首頁只突出一個主要下一步。監測未開放時可查看／修改起始問題，不以停用按鈕作唯一終點。

### B. AI 協助日常工作

- AI 產出可編輯草稿，來源及未知項可查看；不新增全能聊天機器人。
- 下一步由已保存的品牌、問題、run、證據及工作項狀態決定，不額外呼叫 LLM。
- 有結果後導向「查看未完整回答／覆核證據」；需要改進時連到既有 opportunities → private work draft → 人手批准流程。
- 不把一次 API 回答稱為消費者搜尋排名；未分類回答不當「沒有提及」，不聲稱發布或成效改善已發生。

### C. Super Admin 的「所有用戶及資料」

本輪指九個已存在的業務目錄：users、accounts、brands、scans、prompts、observations、runs、sources、work。支援搜尋、帳戶篩選及每頁 25 筆；所有頁面都可逐頁瀏覽。排除 token、密碼、connection string、session 等秘密；不新增任意 SQL console、批量刪除、impersonation 或全庫匯出。

先完成 read-only 管理體驗及正向驗收。正式身份由 owner 指定 AISO 的 profile；其他產品的管理員 email 不是授權依據。

### D. 建議產品驗收目標（尚未量測）

| 目標 | 量測及門檻 |
|---|---|
| 首個品牌低操作量 | 首輪只需輸入網址、確認兩項 context、審閱及確認；5 位代表性測試者至少 4 位不需協助完成 |
| 首次設定時間 | 從開始輸入至品牌及問題狀態可讀，5 案中位數 ≤3 分鐘；分開記錄 active time、等待 AI、登入耗時 |
| AI 可信度 | UC53 的 5 網站×2 次：逐句人工核實，0 個無來源事實；這是樣本 gate，不是模型零幻覺保證 |
| 正確性 | 同 intent 重試只建立一次；分數不跨級；unknown 狀態不當 success |
| 無障礙 | EN／zh-HK、375／768／1440px；light/dark；375px 200% 文字；鍵盤、focus、44px 主要控制；新改動無未處理 serious/critical axe 問題 |

## 3. 發布切片與相依關係

| 切片 | 任務 | 可獨立交付成果 |
|---|---|---|
| 0 基準／調查 | T30 → T25；並核對 T26 身份需求 | 可追溯版本、監測停用原因及測試環境清單 |
| 1 信任與操作 | T20 → T21 → T22 → T23；T24 | 精確分數、可用 drawer、404/500、CSV 可修正錯誤 |
| 2 首品牌與監測 | T29 → T32 → T28；T25 → T31；然後 T33／T35 | AI 草稿可審核、重試安全、一個下一步、清楚監測狀態 |
| 3 管理員 | T26 → T27 的 hosted 驗收；T27 本機部分不需等 T26 | 九類目錄及診斷可用，角色邊界通過 |
| 4 整合驗收 | T34 → T36 | 同候選版本的隔離 E2E、受控 provider 評估及發布證據 |

T25 是 P1 調查，開始時就做，不能被 UI polish 長期延後。若預覽／身份／provider 受阻，完成其他獨立本機任務；只暫停受影響步驟。

建議分為 5 個可審查 PR：①分數與公開頁／PR90整合；②CSV；③監測狀態；④入門＋下一步＋量測；⑤Admin＋跨租戶回歸。每個 PR 都以當前 main 為基準，避免重複套入已合併 PR。總工程規劃約 **9–15 個人日**，不含身份、存取、費用及發布等待；完成 T30/T25 後重新估算，不承諾固定交付日期。

## 4. 任務規格

每個程式碼任務共用步驟：先加能證明缺陷的行為測試並記錄 RED → 最小修改 → 針對性測試、lint/typecheck → 記錄證據 → 一個聚焦 commit。若当前分支已修好，驗證後標「待 hosted 驗收」，不為製造 RED 回退產品。

### T30 — 重建當前基準及可執行範圍（新增，P1）

**Files:** 讀取 `AGENTS.md`、`CLAUDE.md`、`package.json`、`.github/workflows/pr-gate.yml`；新增 `docs/remediation/2026-10-13/baseline.md` 及 `execution-evidence.json`。
**Interfaces:** 產出 commit／tree／PR 狀態／部署 SHA／角色／環境／可用測試指令；下游以這份基準判斷是否仍有缺陷。

- [ ] 檢查工作區未提交修改，保留用戶改動；在隔離 branch/worktree 工作。
- [ ] 讀源 ZIP 及校驗，核對現在 main、PR90/91/92、deployment，分類「已合併／待整合／已部署／未验收」。
- [ ] 記錄普通租戶A/B、Admin及 provider 測試環境的可用性，不記錄秘密值；受阻動作沿用 blocker。
- [ ] 建立新的執行結果欄，不修改原 40 案 actual/result；確認 `baseline.md` 無不明版本假設。

**驗收：** UC79；可從證據辨識每個測試的版本和環境。**回退：** 僅文件，可回退此 commit。

### T20 — 分數精度與動畫（F61，P2）

**Files:** 新增 `lib/score-display.ts`、`__tests__/lib/score-display.test.ts`；修改 `components/result/ScoreReveal.tsx`、`__tests__/components/score-reveal.test.tsx`。將原 `repro/audit-score-boundary.test.tsx` 放入 `__tests__/components/`。以搜尋定位其他 scan score 顯示／分享／匯出 consumers；列出位置後統一，勿套到百分比、金額或 visibility metrics。
**Interfaces:** `formatScanScore(value: number): string`；對合法 0–100、最多兩位小數的持久分數輸出去尾零文字，不改 `assignGrade()`／DB。`59.97→'59.97'`、`63.5→'63.5'`、`74→'74'`。

- [ ] 執行 ZIP 的真 scorer→真 component 重現；EN/zh-HK 都應保留59.97/D。加入49.97/F、69.97/C、79.97/B、89.97/A、0/F、50/D、60/C、70/B、80/A、90/A+、100/A+。
- [ ] 修 formatter；動畫中段數字不得高於最終 score，避免59.97動畫暫時跳成60；reduced motion 直接顯示最終值。
- [ ] `npx vitest run __tests__/lib/score-display.test.ts __tests__/components/score-reveal.test.tsx __tests__/components/audit-score-boundary.test.tsx`，全部通過。
- [ ] 跑 UC44／UC60，提交 `fix(scoring): preserve scan score precision`。

**回退：** 回退 formatter/consumer 改動，保留失敗證據；不回寫分數或評級。

### T21 — 評級區間無小數缺口（F62，P2）

**Depends:** T20（共用其建立的 `score-display.ts`）。
**Files:** 修改 `app/[lang]/(marketing)/page.tsx`、兩語 messages；在 `lib/score-display.ts` 新增區間描述，測試加入 `__tests__/lib/score-display.test.ts`；讀 `lib/scoring.ts` 作 oracle。
**Interfaces:** `SCAN_GRADE_BANDS: readonly {grade:string; minInclusive:number; maxExclusive:number|null}[]`：F=[0,50)、D=[50,60)、C=[60,70)、B=[70,80)、A=[80,90)，A+的minInclusive=90、maxExclusive=null；所有輸入仍受合法0–100契約限制，最後一項 UI 顯示 `90 ≤ score ≤ 100`。

- [ ] 測每個合法百分位小數0.00–100.00均只落一區，grade 等於 `assignGrade(score)`；加入59.5、69.5、79.5、89.5。
- [ ] 兩語用半開區間呈現，提供可讀的 accessible label；首頁示例74由同一評級函數得B。
- [ ] 跑上述單測及首頁E2E，UC21／UC45通過；提交 `fix(marketing): explain decimal grade boundaries`。

**回退：** 回退文案及區間 helper，不變更評分算法。

### T22 — 修正 fixtures，補語義回歸（F64，P2）

**Depends:** T20、T21。
**Files:** 修改 `lib/e2e-fixtures.ts`、`tests/e2e/pages/HomePage.ts`、`tests/e2e/pages/ResultPage.ts`；新增 `tests/e2e/score-precision.spec.ts`；修改相關 component 測試。
**Interfaces:** fixtures 的 scan score/grade 須互相一致；比較使用真正 scorer/grade，不能 mock 被驗邏輯。

- [ ] 將63.5/D修為63.5/C；更新失效 heading selector 為實際 accessible role/name；不刪掉原來的行為斷言。
- [ ] 瀏覽器驗 final分數、兩語、動畫與 reduced-motion；分享／匯出只驗實際存在的 scan score 頁面，不造新功能。
- [ ] `npx playwright test tests/e2e/score-precision.spec.ts`；UC44–46通過，原 RED 留在歷史 evidence。
- [ ] 提交 `test(scoring): cover fractional boundary rendering`。

**回退：** 可回退 fixture 修改，但不得用恢復錯誤fixture換取CI綠燈。

### T23 — PR90／PR92 組合候選與公開恢復路徑（F58/F59/F60/F63，P1）

**Depends:** T22；hosted 部分需預覽存取。
**Files:** 既有 `components/pulse/SuggestQuestionsPanel.tsx`、`app/not-found.tsx`、`app/[lang]/error.tsx`、`app/[lang]/(marketing)/pricing/page.tsx`；drawer實際diff以PR90當前內容為準。新增 `tests/e2e/public-recovery.spec.ts`，沿用 `tests/e2e/prompt-bank-accessibility.spec.ts` 及 `tests/e2e/a11y/pricing-contrast.spec.ts`。
**Interfaces:** 沿用 PR90 的 modal/save recovery 契約及 PR92公開頁，不建第二套drawer。只有最終組合 tree 的證據可以通過本 gate。

- [ ] 以T30結果整合尚未落地改動；測具名dialog、開啟焦點、Tab trap、Escape、返回 opener、關閉後 body scroll 還原。
- [ ] 保留未知save結果、重開告警及雙擊一次POST；不使用「全部再試」造成重複。
- [ ] 測EN/zh-HK unknown URL、隔離可控500→retry→home；support digest可顯示但無stack／secret。測375px／200%文字的pricing，整頁無橫向溢出，必要表格在有名稱容器內捲動。
- [ ] 跑UC21、28、40、46、54–57；預覽存取仍受阻時列blocked，不把READY當通過。
- [ ] 完成組合CI及發布候選說明；此任務準備候選，不包含未授權merge/deploy。提交 `fix(ux): integrate accessible recovery flows`。

**回退：** 單一相容UI候選；不更動DB、Auth保護或正式排程。

### T24 — CSV 逐列修正與可信預覽（F65，P2）

**Files:** 修改 `lib/prompts/bulk.ts`、`lib/prompts/bulk-store.ts`、`components/pulse/PromptBulkPanel.tsx`、兩語 messages、`__tests__/lib/prompt-bulk.test.ts`；新增 `tests/e2e/prompt-bulk-recovery.spec.ts`。
**Interfaces:** 導出 `PromptBatchPreview`，保留 `validRows/errors/duplicates/activeAfter/version`；新增 `summary:{totalRows,applicableRows,duplicateRows,invalidRows}`。列分類互斥；validRows不含重複或無效列。`activeAfter` 為修正錯誤後可套用有效列的投影，不稱已寫入。

- [ ] 原 mixed CSV 明確期待 total=3、applicable=1、duplicate=1、invalid=1；8條原問題加有效新題的投影=9，畫面說明尚未套用；有錯仍全批禁止儲存。
- [ ] 中文逐列顯示原因、修正方法、HK及四種合法category示例；原code可作次要診斷，不能成為唯一訊息。提供含標頭的合成範例下載。
- [ ] 版本改變回409並要求重新預覽；同intent／失去回應只套一次。invalid更新列不能把原問題從投影中移除；不同列錯誤不重複計數。
- [ ] 跑 `npx vitest run __tests__/lib/prompt-bulk.test.ts` 及新增E2E；UC41–43、58、61通過。提交 `fix(prompts): make bulk preview actionable and accurate`。

**回退：** UI及預覽契約一起回退；保持server驗證、intent與atomic apply，不默默改成部分套用。

### T25 — 查明首次監測為何停用（F51，P1，調查）

**Files:** 讀 `components/pulse/RunProgress.tsx`（報告稱FirstMonitoringPanel，實際檔案是RunProgress）、`lib/pulse/runs/user-dispatch.ts`、`lib/flags.ts`、`app/api/dashboard/clients/[clientId]/pulse-runs/route.ts` 及release runbooks。新增 `docs/remediation/2026-10-13/monitoring-readiness.md`。
**Interfaces:** 輸出「已觀察原因／證據／未知／用戶可做下一步／營運才可解除項目」。GET 的 `enabled`來自`pulse_attempts`，不等於已證明provider／Worker全鏈可用。

- [ ] 在可授權唯讀範圍核對實際target、runtime、flag、有效方案／模型、問題context、quota、producer／Worker狀態與release receipts。
- [ ] 分清刻意暫停、應用錯誤、資料缺失及無法核實；不要因讀取恢復而自動解除監測暫停。
- [ ] 提供給T31的可證明原因；記錄UC35基準。若需要付費canary，列精確環境、上限及操作清單交T36。

**回退：** 調查唯讀，无設定修改。根因未知時保持unknown，不指定虛構修復。

### T31 — 監測可用性及下一步（新增，P1）

**Depends:** T25。
**Files:** 新增 `lib/pulse/runs/availability.ts`、`__tests__/lib/pulse-availability.test.ts`；修改 `user-dispatch.ts`、`user-access.ts`、`RunProgress.tsx`、兩語 messages、`tests/e2e/first-pulse-run.spec.ts`。
**Interfaces:** `derivePulseAvailability(input:PulseAvailabilityInput): PulseAvailability`。輸入型別為 `{enabled:boolean; variants:number; prompts:number; contextConfirmed:boolean; remaining:number; expected:number; currentCanonicalId:string|null; legacyCurrentWeek:boolean}`；輸出為 `{canStart:boolean; reasons:PulseBlockReason[]; action:'start'|'edit_prompts'|'view_existing'|'wait'}`。Reason enum：`paused,no_models,no_prompts,context_missing,quota_exceeded,existing_run,legacy_review_required`；API讀失敗由UI另顯示unavailable。action優先順序：有existing/legacy資料→view_existing；缺問題/context→edit_prompts；餘下blocker→wait；無blocker→start；所有原因仍須顯示。

- [ ] 每種原因及多原因組合測試；任一blocker時canStart=false。unknown read、未知成本或排程不可被顯示為0／已安排。
- [ ] GET additive回傳availability；UI顯示原因、已知問題×模型工作量、剩餘answer quota與有效下一步。後端POST仍重新驗角色／flag／quota，不能信任UI canStart。
- [ ] 無結果時不顯示「監測完成」；本週已有run導向原run；legacy需先覆核／分類，不重新收集。
- [ ] 跑新增單測、`__tests__/api/user-pulse-runs.test.ts`、first-pulse-run E2E；UC35／65／66通過，提交 `feat(pulse): explain monitoring availability`。

**回退：** 移除additive狀態展示即可；保留既有server gate及暫停設定。

### T29 — 入門恢復行為的保留驗收（F55，P2）

**Files:** 既有 `components/onboarding/OnboardingWizard.tsx`、`BrandAssistant.tsx`、`tests/e2e/onboarding-recovery.spec.ts`。
**Interfaces:** 原UC32／33已在舊production通過；新候選必須保留網址、語言、市場、步驟及焦點。

- [ ] 在新候選重跑AI→人工、第三步reload、返回第一步；不得要求已輸入欄位重填。
- [ ] 加storage拋錯與session切換測試，draft按既有身份scope隔離；新的登入用戶看不到上一人的表單暫存。
- [ ] 跑onboarding-recovery E2E及UC32／33／62；只有同候選通過才更新本輪狀態。

**回退：** 只針對有失敗的部分修復；原「已驗證完成」僅保留為source status，現在候選標待驗收。

### T32 — AI 品牌草稿的來源與覆核（新增，P1）

**Depends:** T29。
**Files:** 修改 `lib/onboarding/brand-draft.ts`、`brand-assistant.ts`、`components/onboarding/BrandAssistant.tsx`、`__tests__/lib/brand-assistant.test.ts`、`tests/e2e/onboarding-assistant.spec.ts`、兩語 messages；新增 `lib/onboarding/brand-evidence.ts` 及其單測。
**Interfaces:** 在 `brand-draft.ts` 導出 `BrandDraftEvidence={field:'brandName'|'description'|'industry';quote:string}`；在 `BrandDraft` additive加入 `evidence?: BrandDraftEvidence[]`、`reviewRequired?: boolean`。`validateBrandEvidence(pageText:string,candidates:unknown): BrandDraftEvidence[]`只保留原頁可定位、1–240字、最多6段引文。比對時兩邊同樣NFC及合併連續空白；不可用模型的相似度代替匹配。sourceUrl/fetchedAt仍由server產生，不能由模型提供。

- [ ] 用5個合成首頁fixture覆蓋清楚身份、中文、資料稀少、redirect、頁內惡意指令。假quote剔除；不明行業保留null；不支持的事實不得直接套用。
- [ ] 維持public-only安全fetch及既有逾時／大小限制；回傳來源時間、引用及「需你核實」。引用匹配不代表語義已證實；沒有可靠引文則標「未能核實，請手動補充」，不显示可信百分比。
- [ ] AI回應綁定request與context版本；人工接手／更改context後忽略舊回應。apply只更新表單，明確的最後確認才建立品牌。
- [ ] 單測及onboarding-assistant E2E；UC63／67／68通過。真實5網站×2次留到T36，不在unit/e2e呼叫付費provider。提交 `feat(onboarding): make brand drafts reviewable`。

**回退：** optional欄位可不渲染，保留既有BrandDraft相容；不更換模型或建立另一AI服務。

### T28 — 第一品牌端到端與安全重試（F52/F51，P1）

**Depends:** T32、T31；可先完成品牌本身的本機測試，不需監測在正式環境開啟。
**Files:** `OnboardingWizard.tsx`、`lib/onboarding/schema.ts`、`service.ts`、`store.ts`、`app/api/onboarding/complete/route.ts`；`__tests__/integration/onboarding-resume.test.ts`、`__tests__/api/onboarding-flow.test.ts`、onboarding-recovery E2E。
**Interfaces:** 保留 `OnboardingInput.intentKey`、`OnboardingProgress`、request hash、claim lease及seed去重；不因reload生成新intent。`prompts:'failed'`與`brand:'ready'`必須能同時顯示。

- [ ] 建立前顯示品牌、domain、context及將生成問題的確認摘要；使用既有流程，減少重複輸入。
- [ ] 隔離測試：成功後丟失回應、同intent重送、不同payload、兩個tab、seed失敗／重試、lease到期；驗同意圖只有一brand、seed不重複且已成功項不被覆寫。
- [ ] 問題失敗仍提供「前往品牌／手動整理問題」；成功落地正確brand，首次監測獨立確認，不由建立品牌自動觸發。
- [ ] 在隔離DB及mock provider跑既有integration、API、E2E；UC48／64通過。新Google／magic-link UC59需受控真人登入；舊session不算新登入。
- [ ] 提交 `feat(onboarding): finish resumable first brand setup`。

**回退：** 相容UI／service回退；保留brand、intent及所有attempt證據，不刪資料重跑。

### T33 — 品牌首頁只突出一個下一步（新增，P2）

**Depends:** T28、T31。
**Files:** 延伸既有 `lib/view-models/primary-next-step.ts`、`__tests__/lib/primary-next-step.test.ts`、`lib/view-models/daily-work.ts`、`components/dashboard/WorkspaceHome.tsx`、`lib/workspace/load-owned-workspace.ts`、`lib/view-models/workspace-home.ts`、兩語 messages、`tests/e2e/c8a-workspace-home.spec.ts`。這些檔案已有主要下一步；不再建立另一張卡片或平行規則引擎。
**Interfaces:** 保留 `projectPrimaryNextStep({lang,clientId,setup,daily}):PrimaryNextStep`，additive加入 `availability?:PulseAvailability|null`。輸出保留kind/labelKey/href/reasonKey；kind增加 `monitoring_status|review_run|review_work`，labelKey增加 `status|work`，reasonKey允許T31的PulseBlockReason及unknown。`OwnedWorkspace`加入optional `monitoring?:WorkspaceRead<PulseAvailability|null>`，由已授權的 `readUserPulseOptions` 投影；沿用read失敗包裝，避免額外建立一個polling loop。

- [ ] 優先順序：無brand→onboarding；setup讀失敗→monitoring_status／unknown；缺問題/context→整理問題；run pending→查看進度；partial/failed或需分類→查看證據／既有run；daily.nextActions中的review-source/open-draft→既有来源／私人草稿；complete→查看結果；其餘依availability.canStart顯示開始或監測狀態。availability未知不得顯示可開始。
- [ ] 延伸現有header primary CTA，其他功能保留；href只來自已授權client及既有server產生的daily actions。不能因先前跑過scan就虛構監測或改進完成。
- [ ] CTA只導航或明確唯讀刷新；任何AI生成／run／發布依既有確認流程。不增加LLM呼叫。
- [ ] 單測各狀態及讀取失敗；E2E UC69／75通過，提交 `feat(workspace): guide the next useful action`。

**回退：** 回退primary-next-step的additive規則及欄位，原dashboard及工作流保持可用。

### T26 — 指定 AISO Admin 身份（F57，P1，營運前置）

**Files:** 沿用 `scripts/grant-platform-admin.ts`、`__tests__/scripts/grant-platform-admin.test.ts`、`__tests__/integration/platform-admin-grants.test.ts`；新增 `docs/remediation/2026-10-13/admin-acceptance.md`。
**Interfaces:** owner指定AISO登入身份→對應唯一active profile UUID→dry-run→在獨立grant授權存在時apply→讀回ledger及實際登入驗收。無需新增grant API。

- [ ] 先準備隔離環境admin/tenant fixtures，正式身份未知不妨礙T27本機開發。
- [ ] owner指定身份後驗證profile；沿用命令的預設dry-run。**不要捏造 `--dry-run` 旗標**；既有腳本沒有它，`--yes`才寫入。
- [ ] 只有相應授權成立才apply；核對grant ledger、一般租戶仍被拒，記錄UC31／50／72。

**回退：** 同腳本受審計revoke；不刪profile，不賦予DB owner登入產品。

### T27 — 九類 Super Admin 目錄與可恢復狀態（F56/F57，P1）

**Depends:** T30；hosted正向驗收需T26。
**Files:** `components/admin/AdminDirectory.tsx`、`SchemaHealthPanel.tsx`、`lib/admin/directory-schema.ts`、`directory.ts`、`schema-health.ts`、`app/api/admin/directory/route.ts`；既有admin-directory API/SQL/component/E2E及schema-health tests。
**Interfaces:** 保留 `DirectoryQuery`、`DirectoryResult`、`PAGE_SIZE=25`及9 views；SchemaHealth原狀態為 `columns_present|attention|unavailable`，不得把columns_present改稱整個產品ready。

- [ ] 每個view建立至少26筆固定順序的合成記錄，分屬A/B；測搜尋、帳戶filter、page1/2、不重複不漏筆、換query回page1。
- [ ] loading、真的empty、403、503、retry、stale response各自有明確UI；請求識別或AbortController防止舊查詢覆蓋新帳戶。
- [ ] 清楚顯示當前scope及頁碼；UI只顯示允許欄位。查詢由server admin guard保護，不能只藏連結。
- [ ] schema缺列／讀取失敗用隔離fixture注入，不破壞production schema；顯示checkedAt及診斷範圍限制。
- [ ] 跑既有API/SQL/component/E2E；UC50–52／70–72通過。T26受阻時僅hosted案例保留blocked，提交 `feat(admin): complete directory review workflows`。

**回退：** UI／query修改可回退；權限guard、審計及來源資料保留。

### T34 — 跨租戶及未知結果的整合邊界（新增，P1）

**Depends:** T24、T28、T31、T27的本機部分。
**Files:** 延伸 `__tests__/integration/onboarding-resume.test.ts`、`pulse-runs.test.ts`；新增 `__tests__/integration/audit-tenant-boundaries.test.ts`，沿用現有integration setup及真實Auth驗收runbook。
**Interfaces:** 每個資源至少驗A own成功、B foreign拒絕、anonymous拒絕；依既有路由契約區分401／403／404，不把405算權限拒絕。

- [ ] 對onboarding、prompt bulk、run/read/repair、observations及Admin讀取建立owned/foreign pairs；另測session撤銷、身份變更、同intent payload衝突。
- [ ] 注入伺服器commit後網路中斷；核對一brand、一批更改、一個run/reservation，舊原文與canonical結果不改。
- [ ] 真實Auth＋隔離DB驗證用目前candidate；mock authentication的單測另外記錄，不能代替它。
- [ ] 執行UC49／58／64／78；針對路由必要tests後執行完整CI gate，提交 `test(tenancy): verify onboarding and monitoring isolation`。

**回退：** 清理限定測試資料；不放寬權限來讓測試通過。

### T35 — 量測首次價值，不捏造啟用成功（新增，P2）

**Depends:** T28、T33。
**Files:** `lib/funnel-client.ts`、`lib/observability/funnel.ts`、`app/api/funnel-events/route.ts`、現有funnel tests；只讀 `lib/telemetry/activation.ts`；新增 `docs/remediation/2026-10-13/activation-measurement.md`。
**Interfaces:** 同時擴充client/server allowlist：`onboarding_started,brand_draft_requested,brand_draft_reviewed,onboarding_manual_selected`。仍使用attemptId／locale；不把瀏覽器event當brand已建立。完成時間用既有持久化brand/onboarding/run資料導出。

- [ ] 測新event只接受allowlist欄位、去除姓名／email／URL／草稿／prompt／raw answer；網路失敗不阻擋產品。
- [ ] 列開始、人工接手、草稿覆核、品牌建立、首個可讀結果的分母；讀取失敗用unknown，不當0成功。
- [ ] 記錄5位代表性測試者的active/wait/login時間與是否求助，測UC73／74；未招募就標not-tested，不編百分位。
- [ ] 新events僅診斷嘗試；持久milestones仍使用DB事實，不加平行成功事件表。提交 `feat(onboarding): measure first value with minimal telemetry`。

**回退：** 關閉新增診斷events即可，不改功能資料。

### T36 — 受控 canary、同版本驗收與發布包（新增，P1）

**Depends:** T23、T24、T31、T33、T34、T35；完整Admin gate另需T26/T27 hosted。
**Files:** 新增 `docs/remediation/2026-10-13/release-checklist.md`、`acceptance-results.csv`；沿用 `docs/runbooks/aiso-remediation-release.md` 及既有Worker／provider runbooks。
**Interfaces:** 產出「候選SHA/tree、CI、部署SHA、UC結果、未解限制、授權操作清單、回退版本」完整release packet。

- [ ] 保存同候選CI的lint/typecheck/build/unit/browser/integration/Worker結果，必要suite零skip/flaky；任何skip明列，不能視為pass。核對tested tree與候選tree一致。
- [ ] Preview受保護且未能合法存取時停在候選驗收blocked，繼續其他工作；不更換保護策略。
- [ ] provider分兩包：①沿用既有運輸canary（專用限時key、provider強制USD1、不reset、包含BYOK、最多5 answers＋5 classifiers、無retry/fallback）；②UC53品質評估5網站×2次，需**另列**專用預算及請求上限，不能借①擴大費用授權。沒有上限就只做mock，付費步驟blocked。
- [ ] ①未知結果或缺usage即停下一請求並唯讀對賬；②逐句來源人工覆核，記錄模型ID、prompt版本、source/fetchedAt、延遲、tokens及實際費用。0 unsupported claims才通過樣本gate；失敗則修draft策略後在原預算範圍重評或申請新範圍。
- [ ] 隔離真實Auth完成首品牌→問題→明確確認首次run→讀結果→回到原角色；跑原UC20–59與新UC60–79，按環境分表。每案寫actual、result、evidence、cleanup。
- [ ] 如獲發布授權，先merge/deploy指定候選，再驗正式站74/B、59.97/D、drawer、404、onboarding及指定admin。全局Pulse／daily cron只在producer inventory、限額及端到端canary均通過且有activation授權後啟用。
- [ ] 尚未發布時交付可審查PR及release packet，狀態寫「待發布／待live驗收」，不得寫「已修好正式站」。

**回退：** 先停止新增監測dispatch，對賬in-flight及unknown intents，再回退已核實與現行schema相容的應用／Worker。保留additive schema及ledger，不自動回退到較舊且不相容版本，不刪attempt或重寫canonical週報。

## 5. 測試命令與證據格式

執行時先核對package scripts；以下是本次讀取checkout已有命令，不代表已執行：

```bash
npm ci
npm run lint
npm run typecheck
npm run test:unit
npm run build
npm run e2e
# 僅已核對的隔離integration環境、有Neon測試分支能力時：
REQUIRE_INTEGRATION_TESTS=1 npm test
```

不要為了跑測試從production複製DB秘密；`.env.local`不可假設是隔離環境。targeted tests隨每task跑，完整gate在組合候選跑；不用每個文案commit重跑付費或完整integration。Worker依當前pr-gate定義驗證，不捏造新的release指令。

新增UC60–79詳見 `docs/remediation/2026-10-13/additional-use-cases.csv`，全部初始not-tested；原UC20–59原封保留。新結果記錄：

```json
{
  "taskId": "T20", "caseId": "UC44", "candidateSha": "actual-sha",
  "testedTree": "actual-tree", "environment": "local-component",
  "result": "pass|fail|blocked|not-tested", "observedAt": "ISO-8601",
  "evidencePath": "relative-redacted-evidence", "cleanup": "none-or-actual"
}
```

這是schema示例，不是已取得證據。每個task狀態只用待開始／進行中／受阻／待驗收／已驗證完成；`已驗證完成`需對應該task要求的環境，不能用本機證據關閉production缺陷。

## 6. 開始前不需反覆詢問的事項／真正依賴

收到實作指示後，可以持續進行版本核對、隔離branch、單測、修復、fixtures、文件及候選準備。遇到外部依賴先把可審查結果做完，再只處理該項阻塞：

| 外部依賴 | 完成前可做 | 解鎖的動作 |
|---|---|---|
| AISO Admin指定profile及grant範圍 | 九視圖、合成角色、權限單測／隔離測試 | 正式Admin正向驗收 |
| 可授權的preview存取 | 本機、CI及candidate bundle | hosted候選驗收 |
| 隔離真實Auth A/B | mock契約、DB測試及fault注入 | 真session跨租戶、UC59 |
| 有硬上限的provider測試包 | 合成首頁、schema、fallback、來源測試 | 真AI品質／成本、Pulse canary |
| 候選發布及監測啟用範圍 | PR、CI、release packet及rollback | 對應merge/deploy或activation；彼此不互相包含 |

首批執行：**T30 → T25調查 → T20／T21／T22 → T23本機部分 → T24**。其後完成T29/T32/T28/T31/T33及T27本機部分；不要因單一外部blocker把整個計劃停下來。

交付時回答四件事：改了甚麼、哪個版本及環境通過、還有甚麼未驗／受阻、下一個具體操作。保留失敗及限制，避免「全部功能完成」等無分母結論。
