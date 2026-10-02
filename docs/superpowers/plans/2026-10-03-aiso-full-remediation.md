# AISO Full Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 交接對象：**Codex GPT‑6.1 Sol**；預設單一執行者逐批完成。如環境沒有此技能，依本文同等流程執行，不自行新增工具或改動權限。

**Goal:** 修復稽核的19項發現，讓AISO診斷可信、來源核准可完成、Pulse失敗可追蹤與續跑，並以真實角色驗收onboarding及日常維護。

**Architecture:** 延用Next.js App Router、Neon Auth/Postgres、既有source/work-item版本鏈及Cloudflare scheduler。來源核准採原子資料狀態轉換；Pulse以Neon持久run/item/attempt為真相，原有API及報表逐步相容接入。先交付核心修復，再整理後台操作，最後以同一SHA驗收。

**Tech Stack:** 稽核基線為Node 24.x、Next.js 16.2.4、React 19.2.x、TypeScript 5.9.x、Neon serverless 1.1.x／Neon Auth 0.4.2-beta、Vitest 4、Playwright 1.60、Cloudflare Worker、Vercel。

**Spec:** 隨包的 `audit/AISO-audit-report.md`、`audit/AISO-repair-tasks.csv`、`audit/AISO-findings.csv`、`audit/AISO-user-cases.csv`、`audit/AISO-operation-inventory.csv`及`audit/evidence/E01–E20`。原始`evidence/AISO-audit-evidence.zip`保留不變；本計劃只解釋如何修，不將缺陷證據改成通過證據。

日期：2026-10-03，Asia/Hong_Kong。本文是**實作計劃，尚未執行產品修復、migration或部署**。

## Global Constraints

- 固定稽核基線：`main f49e1bd8951394cf88250b3ea88847d0038db491`；當時Vercel alias與該SHA一致。開始實作必須fetch並記錄最新main與部署差異；本輪沒有重新宣稱最新遠端已修或未修。
- 不重編F01–F19、T00–T20、UC01–UC19、OP01–OP63。狀態只可用：待開始、進行中、受阻、待驗收、已驗證完成。
- 先讀目前checkout的`AGENTS.md`、`CLAUDE.md`及`README.md`，Next.js改動先讀本機`node_modules/next/dist/docs/`。使用`proxy.ts`，不建立`middleware.ts`。
- 使用`db()`的guarded Neon tagged-template SQL；每個一般讀寫都由session取得account scope，所有新API自行授權。不要回到已移除的Supabase client，不修改DB binding guard來讓測試通過。
- migrations仍放`supabase/migrations/`（只是舊目錄名，目標是Neon）。runtime用`aeo_app`；DDL用已授權的migration角色及`MIGRATE_DATABASE_URL`，先核對project/branch/role，不打印DSN。
- 正式來源只有同時「版本已核准＋允許代理使用＋未撤回」才可引用。源內容是資料，保留CSV公式防護、純文字呈現及prompt資料隔離。
- 模擬UA能抓取不等於收錄、排名或引用；OpenRouter model variants不等於五個消費者產品。未知資料不填成功、不當作0成本、不自動補現在模型／市場。
- 保留已知良好行為：品牌409草稿恢復、source去重、獨立覆核、未核准不匯出／交付、scope limitation、Free/Pro entitlement及50個active prompts上限。
- 新變更用隔離branch、fixture、DB branch及收件箱。正式品牌不注入故障，不啟用合成來源、不重開試用。實作到可審閱commit/preview後，才處理具體發布授權。

## Review Focus

以下五类邊界在本計劃中補成明確驗收，不把普通happy path當成替代：

1. **來源版本與核准並行**：使用者看v1時別人匯入v2；只能核准明確review過的版本，舊expected version回409。歸T04／AC22。
2. **CSV只修錯誤行**：重試失敗行不能覆蓋或丟失已驗證的其餘問答。預覽合成完整來源版本再一次寫入。歸T12／AC23。
3. **舊worker晚到／provider已回覆但DB失敗**：lease過期結果不得覆蓋新worker；同item不重複計數，外部重複費用風險可見。歸T05/T07／AC24。
4. **中文字形與品牌子字串歧義**：Unicode正規化、混合語言、Apple/pineapple、負評及未知分類不污染分母。歸T08／AC25。
5. **編碼過的return-to與過期session**：外站、反斜線、雙重編碼及敏感OAuth query都不成為跳轉目的地或紀錄。歸T14／AC26。

---

## 1. 本次輸入與完成定義

| 項目 | 已核對內容 |
| --- | --- |
| Repo | https://github.com/YNWAforever/aiso |
| Live | https://aiso-kappa.vercel.app/zh-HK |
| Dashboard | https://aiso-kappa.vercel.app/zh-HK/dashboard |
| 證據包 | AISO-audit-evidence.zip，報告版本2，994843 bytes |
| SHA-256 | c8479913f5ca74f476aa6b9d0e78f75cc9c69597a5c82eb0d8378069343218a5 |
| 範圍 | 19 findings（10 P1、9 P2），21 tasks，19 user cases，63 operations |
| 稽核操作結果 | 35 pass／9 fail／7 blocked／12 not-tested；這是舊基線，不是修復驗收 |
| 登入結果 | 5個工具入口已達：4可用，問題庫為Free→Pro門檻 |
| 本計劃起始狀態 | 19項修復任務待開始；T00及T16受存取／角色／資料限制 |

F16是正式排程證據不足的調查／發布閘口，**不能當成已確認的漏跑事故**。Free品牌0觀察亦不能證明排程壞了。F05–F08等code-only問題要在隔離環境重現後修，不能虛構正式受影響比例。

**執行前校正：** 原任務文案的「三語」與repo不符；`i18n/routing.ts`及messages只有`en`與`zh-HK`，本計劃以這兩語验收，不新增第三語。舊README/CLAUDE中的環境與migration狀態只作歷史背景，以當次runtime/schema證據為準。

完成一項功能修復須有：目前SHA上的缺陷重現→修復→正確期望的測試通過→相應隔離DB/UI驗收→證據及rollback。只做到commit/local green標「待驗收」；需要live的任務仍缺證據時不可標「已驗證完成」。正式發布整體完成另由T17判定。

## 2. 執行次序及交付批次

| 批次 | 任務次序 | 交付結果／退出條件 |
| --- | --- | --- |
| B0 基線 | T00；同步準備T16所需fixture | 記錄HEAD差異、環境與存取缺口；T00受阻不擋獨立程式修復 |
| B1 核心修復 | T04 → T01 → T02 → T06 → T10 | 來源核准、可信掃描、候選遍歷及可恢復onboarding；每項獨立commit/PR |
| B2 Pulse可靠性 | T05 → T07 → T08 → T09 | 固定分母、持久續跑、降級分類、可覆核答案；整組完成前不開正式新writer |
| B3 後台維護 | T18 → T20 → T14 → T13 → T11 → T03 → T19 → T12 → T15 | 完成驗證首用、草稿列表、登入回跳、問題維護、優先排序、批次及每日工作 |
| B4 驗收發布 | T16 → 重新核对T00 → T17 | 真實角色与同SHA全量gate；正式migration/app/worker發布須具體授權 |

批次是預設排程，不是額外技術依賴。T18/T20可在等待Pulse隔離DB時穿插；所有正式依賴以任務CSV為準。T06可以先獨立修，T07才依賴T05＋T06。前端或文案不必等Cloudflare存取才開始。

第一個工作日的實際動作是B0後開始T04，接着T01/T02。若DB整合存取尚缺，先完成T04程式與mock/contract證據，標待驗收，繼續其他独立任务；不能整輪停在「等登入」。現有登入已成功。

## 3. 開工程序與命令

以下命令供未來實作者在repo執行；**本次只核對命令存在，沒有執行修復測試或migration**。

```bash
git status --short
git fetch origin
git rev-parse origin/main
git rev-parse --is-shallow-repository
```

如是shallow clone且相關history fixture需要完整歷史，才執行`git fetch --unshallow`。有使用者未提交變更則建立隔離worktree；不reset/clean覆蓋。以下branch及目錄若已存在，選新的唯一名稱：

```bash
git worktree add -b fix/aiso-audit-20261003 ../aiso-remediation origin/main
```

進入該worktree後，以Node24及lockfile安裝：

```bash
node --version
npm ci
npm run lint
npm run typecheck
npm run test:unit
```

把當前HEAD相對稽核SHA的相關diff映射到F/T ID。若新main已改某項，先重現/驗收，標待驗收；不要覆蓋較新實作。讀`audit/probes/audit.test.ts`及R01–R07：**原7個綠燈表示缺陷被重現**，修復測試要改用正確期望並放回repo正式suite，不能原樣複製綠燈當成功。

原unit首輪為5022測試：5004 pass、18受環境影響失敗；10個受影響files後來分兩批重跑通過。這不是本次candidate的全量green；在新環境重新建立baseline，區分環境失敗與產品失敗，不降低測試門檻掩蓋。

## 4. 共享資料與行為契約

### C1 來源核准、內容版本與引用資格

`SourceScope`沿用`{accountId,clientId,actorId}`，account/actor只來自session。核准鎖定`sourceId+versionId+expectedLatestVersion+expectedContentHash`；同hash重匯入不新增版本，但明確approve要求不可被unchanged分支吞掉。已核准重試保持首次actor/time。核准不是開啟agent許可，亦不是change-set的兩人覆核。

來源版本insert、latest pointer與相同內容核准在單一原子SQL/CTE中完成；需跨語句時只用目前guard支持的非互動batch transaction，不開BEGIN後再用不同HTTP查詢假扮同一transaction。[Neon官方driver說明](https://neon.com/docs/serverless/serverless-driver)將HTTP定位為非互動transaction；此計劃優先使用repo現有CTE寫入模式。

### C2 掃描語義、歷史結果與優先次序

本次選定c6為`/llms.txt`內容完整度（選配）；保留舊資料key及函數簽名，修正文案與Markdown解析。不是新增排名必要檔案。所有行業平均常數從正式比較移除；權重保持原值。parser或collector定義改變要升check/scanner version，不能回寫舊報告分數。

可行動的檢查先滿足applicable＋complete，再按fail>warn；採集失敗/unknown提供重試或補資料，不生成確定修復。技術抓取、API回答觀察、消費者產品曝光各自標明量度來源，不能互相代替。

### C3 Pulse的持久分母與lease

以下表名與介面是**擬新增**，不是宣稱repo已具備：

| 表／類型 | 不可破壞的契約 |
| --- | --- |
| pulse_runs | account_id/client_id/scan_week；每品牌每週一個weekly run。run status：queued/running/partial/completed/failed/blocked；manifest與week一旦開始即固定 |
| pulse_run_items | 每個run×prompt snapshot×實際model variant一筆；unique(run_id,prompt_snapshot_id,model_id)。state：queued/running/retry_wait/succeeded/failed/blocked；lease owner/token/expiry及下一次due持久保存 |
| pulse_item_attempts | 每次實際呼叫一筆append-only證據；unique(item_id,attempt_number)。記成功/錯誤代碼、時間、model、原文、usage、分類方法，未獲知成本則unknown |
| 租戶與一致性 | 新表都有account/client scope及相應composite FK；特許跨tenant的cron選取要在既有tenancy inventory中明確聲明，不把一般API變成跨租戶 |
| pulse_metrics相容投影 | nullable run_item_id＋partial unique。舊資料保留，不用現在設定補歷史；新的成功輸出原子投影，不delete再insert，不從metric數量推進cursor |
| lease/fencing | claim為原子DB行為；commit必須符合當前lease token，舊worker晚到不能蓋新值。已成功item重跑不再呼叫provider |

`RunCoverage={expected,succeeded,failed,pending,blocked,classified,mentioned}`，所有值非負。`expected=succeeded+failed+pending+blocked`；pending涵蓋queued/running/retry_wait。採集coverage為succeeded/expected；提及率為mentioned/classified；情緒只用已分類且有合法情緒的樣本。分母0顯示N/A。R06只有1個成功而expected=15時，coverage為1/15，不能顯示全部100%。

只有expected>0且全數succeeded才標完整完成；全terminal failed為failed，部分成功/未完為partial，全部不合資格為blocked或明確no-work原因。原始答案採集成功、分析失敗仍保留成功答案，classification=unknown，兩種成功率分開。

week key明定UTC週一，UI顯示香港時間；跨週repair仍回原run。外部LLM採至少一次呼叫風險模型，DB去重不等於供應商exactly-once計費。timeout後provider結果未知時記錄uncertain outcome並受最多3次retry與token budget限制。

### C4 排程與維運

保留原repo基線時程：Pulse週一04:17UTC（香港12:17）、Alert週一07:47UTC（15:47）、trial email及Search Console每日09:00UTC（17:00）。T00核對實際部署是否相符。T07重用現有daily trigger添加repair分支，與email/SC分開結果，任何一項失敗不吞掉其餘結果。

45秒工作deadline＋至少5秒保存餘量是本次初始設計值，仍在現有60秒route設定內。停止開新工作、保存checkpoint後回partial；不要一口氣串行開3個最壞45秒問題。每日repair只續未完run，不能每天重新消費完整題庫。正式更高頻率或更長timeout需有容量證據，不是本次默認補丁。

### C5 Onboarding、語言與市場

同一account＋intentKey只建一個onboarding進度。brand/seed/scan步驟分開，brand建立後seed失敗是可恢復partial。重試沿同一client，不重開trial；實際題數可少於模型要求的24，不能把200回應解作24題已準備。

新題預設承接已確認品牌context，使用者可選en/zh-HK及現有market值；語言不能從當前UI語言盲目覆寫歷史題。超過50個active prompts的競態由後端限制；已開始的Pulse manifest保持原context。

### C6 大量來源、CSV與清單

來源頁預設50/max100筆；穩定keyset與filter/asOf契約，summary不夾帶全部entries。201個source packs要全可到達，latest run的250筆觀察候選範圍要可翻查，不能只把LIMIT調大。

CSV是**一份來源內最多200組問答**。預覽保留每行的rowNumber、valid/invalid/duplicate與原因；失敗列重試只做重新驗證，最終把完整有效集合一次提交為來源版本。後端再次驗內容及expected version；不能相信client宣稱valid。若使用者排除錯誤行，先明示被排除內容再建立版本。不同答案但相同問題需處理衝突，不可偷偷挑一個。

### C7 錯誤、權限與日常UX

每個mutating API：未登入401、非法輸入400/413、非本tenant或不存在404、版本衝突409、依賴故障503；權限/方案不足按既有契約403。UI保留草稿、pending避免重複提交、錯誤可重試、取消回原焦點。不能把DB錯誤回200，亦不能把DB查詢失敗偽裝404。

日常首頁沿用現有最多3項工作，依freshness/coverage/source approval/work-item review導向真正可執行步驟。保留「私人身份不改變品牌量度」「下載不等於交付」「變化不等於因果」說明。

## 5. 檔案責任與遷移策略

| 範圍 | 重用／新增位置 | 負責任務 |
| --- | --- | --- |
| 掃描可信度 | lib/checks、impact、scan-evidence、types、result元件；新增小型check-priority | T01/T02/T03 |
| 來源核准與維護 | sources store/service/schema；版本approve route；query/import-preview純邏輯 | T04/T12 |
| Pulse資料真相 | lib/pulse/runs/schema/store/service＋migration056；openrouter adapter | T05 |
| Pulse消費與分析 | runs/worker、cron route/Worker；analysis-fallback與analysis；observations detail | T07/T08/T09 |
| Onboarding與context | lib/onboarding三個小模組＋migration055；prompt context＋migration057 | T10/T11 |
| 後台操作 | 既有Entities/Opportunity/Prompt editor、auth-return-to、workspace-home | T13/T14/T15/T18/T19/T20 |
| 環境與發布 | 現有runbook、recordRun、CI與驗收文件 | T00/T16/T17 |

055/056/057是稽核tip=054時的建議新檔名；執行時若最新main已占用，採下一個可用號碼並更新計劃／矩陣，不改或重號既有已部署migration。新表權限、索引、constraints及schema-equivalence manifest一起驗；使用expand-contract，不DROP歷史資料。T04現有核准欄位可用，無必要不另造重複核准表。

先在隔離Neon branch replay全部migrations，驗權限、account邊界、guard、失敗回滾及新writer的向後相容。`migrate --verify`主要查已記錄物件，不能單獨證明每個新column/index/constraint正確。正式migration前要有schema diff、backup/restore責任人和對應candidate。

## 6. 任務總覽

| ID | P | 發現 | 依賴 | 角色 | 估算人日 | 起始狀態 |
| --- | --- | --- | --- | --- | --- | --- |
| T00 | P1 | F16 | 無 | 維運/產品負責人 | 0.5–1人日 | 受阻 |
| T04 | P1 | F09 | 無 | 後端/全端 | 1–2人日 | 待開始 |
| T01 | P1 | F01;F03 | 無 | 全端/產品 | 1–2人日 | 待開始 |
| T02 | P1 | F02 | 無 | 產品/前端 | 0.25–0.5人日 | 待開始 |
| T06 | P1 | F07 | 無 | 後端 | 0.5–1人日 | 待開始 |
| T10 | P1 | F10 | 無 | 全端 | 1–2人日 | 待開始 |
| T05 | P1 | F06 | 無 | 後端/資料工程 | 3–5人日 | 待開始 |
| T07 | P1 | F08 | T05;T06 | 後端/維運 | 2–4人日 | 待開始 |
| T08 | P1 | F05 | T05 | AI/後端 | 1–2人日 | 待開始 |
| T09 | P2 | F12 | T05;T08 | 全端/資料工程 | 2–3人日 | 待開始 |
| T18 | P2 | F17 | 無 | 全端 | 0.5–1人日 | 待開始 |
| T20 | P2 | F19 | 無 | 前端 | 0.5–1人日 | 待開始 |
| T14 | P2 | F15 | 無 | 全端 | 0.5–1人日 | 待開始 |
| T13 | P2 | F14 | 無 | 前端 | 0.5人日 | 待開始 |
| T11 | P2 | F11 | T10 | 全端/產品 | 0.5–1人日 | 待開始 |
| T03 | P2 | F04 | T01 | 全端 | 0.5–1人日 | 待開始 |
| T19 | P2 | F18 | T01;T03 | 產品/全端 | 0.5–1人日 | 待開始 |
| T12 | P2 | F13 | T04 | 全端 | 2–4人日 | 待開始 |
| T15 | P2 | F12;F13;F16 | T07;T09;T12 | 產品/全端 | 2–3人日 | 待開始 |
| T16 | P1 | F09;F10;F11;F12;F13;F14;F15 | 無 | QA/使用者協作 | 1–2人日 | 受阻 |
| T17 | P1 | F01;F02;F03;F04;F05;F06;F07;F08;F09;F10;F11;F12;F13;F14;F15;F16;F17;F18;F19 | T00;T01;T02;T03;T04;T05;T06;T07;T08;T09;T10;T11;T12;T13;T14;T15;T16;T18;T19;T20 | QA/維運 | 1–2人日 | 待開始 |

人日沿用稽核規劃估算，不是交期承諾；不含存取等待、人工覆核、OAuth交接及等待實際job。每個任務的發现、UC、E-ID與rollback在CSV保留完整關係。

## 7. 逐項執行步驟

每個修改任務都先用下面指定情境寫有意義的失敗測試；Red應由目標行為缺陷造成，不能把缺credential、DB不可達或測試没被發現當Red。T00/T16/T17是調查／整體驗收，按其專屬證據門檻處理。每步以勾選及證據路徑追蹤。

### T00 · 確認正式排程與rollout證據

**追蹤：** P1；F16；UC13;UC15；來源E01;E04;E08;E11。依賴：無。批次B0。

**Files:**

- Modify／重用：`docs/runbooks/deploy-cron-worker.md`
- Modify／重用：`README.md`
- Modify／重用：`cloudflare/cron-worker/wrangler.jsonc`
- Modify／重用：`lib/cron/recordRun.ts`
- Create／擬新增：`docs/runbooks/aiso-runtime-evidence.md`

**Interfaces:** 輸出 RuntimeEvidence：app SHA/alias、worker deployment/origin/schedules、schema ledger、flag enabled/disabled/unknown、各job lastCompleteSuccess/lastAttempt/outcome/coverage/nextDueAt。只記名稱與已遮蔽值，不記密鑰。

- [ ] **Step 1: 建立本任務的證據清單**

這是調查任務，不寫鏡像單元測試。缺worker、DB或flag資料時，對應欄位必須unknown；HTTP 200或空log不能推出健康。

- [ ] **Step 2: 執行可取得的檢查／驗收**

核對實際worker部署及指向，不因source預設aeo.fimmick.com就改成vercel.app。讀取最近7日cron_runs與scheduler摘要，區分未啟用、沒有合資格品牌、成功、部分完成、失敗；按目前部署SHA核對migration。Pricing的Pulse承諾只按已證實rollout更新；歷史CLAUDE.md日期不能代替查核。

- [ ] **Step 3: 執行指定命令**

環境前置條件滿足才執行；讀完整exit code與結果。缺必要存取就受阻，不改成skip成功。

```bash
npm run migrate -- --verify
npm run migrate -- --dry-run
```

- [ ] **Step 4: 核對完成門檻**

以上命令只在目標已核實且有唯讀／dry-run授權時執行；不執行migration或排程。缺權限列受阻並繼續B1。T17前須補齊，或由產品負責人明確接受關閉相關功能。 列出每個job最近成功、失敗、覆蓋品牌数、下一次HKT時間；證明worker指向預期app；區分停用与失敗；缺資料維持unknown。

- [ ] **Step 5: 保存紀錄與狀態**

只提交已遮蔽runbook／測試及證據索引；建議commit：`docs(ops): record verified AISO runtime and rollout state`。未取得live證據保持待驗收或受阻。

**目前受阻：** 尚未取得worker及執行摘要；不需要提供秘密值

### T04 · 修復既有來源版本核准與匯入原子性

**追蹤：** P1；F09；UC05；來源E06:R07;E08;E16。依賴：無。批次B1。

**Files:**

- Modify／重用：`lib/sources/store.ts`
- Modify／重用：`lib/sources/service.ts`
- Modify／重用：`lib/sources/schema.ts`
- Modify／重用：`lib/view-models/source-pack.ts`
- Modify／重用：`app/[lang]/dashboard/[clientId]/sources/page.tsx`
- Modify／重用：`components/sources/SourcePackWorkspace.tsx`
- Modify／重用：`messages/en.json`
- Modify／重用：`messages/zh-HK.json`
- Modify／重用：`__tests__/integration/client-sources.test.ts`
- Create／擬新增：`app/api/clients/[clientId]/sources/[sourceId]/versions/[versionId]/approve/route.ts`
- Create／擬新增：`__tests__/api/source-version-approval.test.ts`

**Interfaces:** 新增 approveSourceVersion(scope: SourceScope, input: {sourceId:string; versionId:string; expectedLatestVersion:number; expectedContentHash:string}): Promise<ApprovalResult>。ApprovalResult.kind為approved/already-approved/conflict/revoked/not-found。POST /api/clients/:clientId/sources/:sourceId/versions/:versionId/approve；actor從session取得。DTO補approvedBy，沿用既有approved_at/approved_by欄位。

- [ ] **Step 1: 寫失敗測試**

source_v1_same_content_can_be_approved：先approve=false匯入，核准同v1後expect(latestVersion).toBe(1)、expect(approvedAt).not.toBeNull()、actor正確、agentUseAllowed仍false。重複核准不改首次actor/time。新v2與舊v1核准並行，舊expected version回409；A不可核准B來源。

- [ ] **Step 2: 確認Red並保存基線**

先跑下列命令中的unit／fixture部分；確認至少一個命名案例因目標行為失敗。對DB競態須在隔離DB另重現，不只mock SQL字串。證據放`artifacts/aiso/T04/before/`。

- [ ] **Step 3: 實作最小完整修復**

新增版本專屬核准動作與UI「核准此版本」。保留import approve=true的相容行為：same-hash仍可核准，回應要同時表達content unchanged與approval outcome。將來源row鎖、hash判斷、version insert及latest pointer寫入改為單一原子SQL/CTE；不能在HTTP driver上用互動式transaction callback。已撤回來源不復活；內容核准不開啟agentUseAllowed；這不是change-set的雙人覆核，沿用來源本來的帳戶權限。

- [ ] **Step 4: 驗證Green及整合**

下列命令預期exit 0、所有指定案例被發現且通過；integration不能skip。

```bash
npm run test:unit -- __tests__/api/source-version-approval.test.ts __tests__/lib/source-pack.test.ts __tests__/components/source-pack-render.test.tsx
npm run test:integration -- __tests__/integration/client-sources.test.ts
```

- [ ] **Step 5: 執行UC／UI驗收**

在隔離DB注入pointer更新失敗，來源/版本/核准全部回滾；兩個同hash提交只一版本。重跑UC05，截圖+GET重讀+已遮蔽actor/time證據。既有正式AUDIT來源保持不動，以隔離複製資料測試。

驗收條件：未核准v1同內容可核准；重覆核准不增版本；無權限者拒絕；並行版本衝突明確；pointer更新失敗整筆回滾；R07改成期望已核准。

- [ ] **Step 6: 提交及更新追蹤**

只stage本任務檔案與必要遷移/測試，建議commit：`fix(sources): approve existing versions atomically`。把candidate SHA、命令、fixture、結果與證據填入矩陣；尚缺UI/live則待驗收。回退：向後相容欄位；回退新入口，保留核准審計資料

### T01 · 統一檢查語義與AI平台證據

**追蹤：** P1；F01;F03；UC01;UC02；來源E02;E06;E08;E09。依賴：無。批次B1。

**Files:**

- Modify／重用：`lib/checks/llmsFullTxt.ts`
- Modify／重用：`lib/checks/botAccess.ts`
- Modify／重用：`lib/checks/robots.ts`
- Modify／重用：`lib/robots-policy.ts`
- Modify／重用：`lib/impact.ts`
- Modify／重用：`lib/types.ts`
- Modify／重用：`lib/scan-evidence.ts`
- Modify／重用：`lib/checkExplanations.ts`
- Modify／重用：`components/result/TopIssueCard.tsx`
- Modify／重用：`components/result/ResultClient.tsx`
- Modify／重用：`messages/en.json`
- Modify／重用：`messages/zh-HK.json`
- Create／擬新增：`__tests__/checks/llms-content-quality.test.ts`

**Interfaces:** 沿用check key c6_llms_full_txt與checkLlmsFullTxt(baseUrl, fetcher)呼叫簽名；新版契約明定檢查/llms.txt的內容完整度，展示名改「llms.txt內容完整度（選配）」。新增CollectorAccess DTO {crawler,role:search|training|user_triggered,policy:allowed|blocked|unknown,probe:reachable|unreachable|not_measured}；實際品牌曝光另欄，不由此推導。

- [ ] **Step 1: 寫失敗測試**

markdown_links_are_counted：三個Markdown連結的R01 fixture不再得0；純文字URL、混合/重複/相對連結有固定規則。gptbot_block_does_not_block_search：只封GPTBot，OAI搜尋不得被判不可見；沒有consumer觀察時所有曝光結論為未量度。

- [ ] **Step 2: 確認Red並保存基線**

先跑下列命令中的unit／fixture部分；確認至少一個命名案例因目標行為失敗。對DB競態須在隔離DB另重現，不只mock SQL字串。證據放`artifacts/aiso/T01/before/`。

- [ ] **Step 3: 實作最小完整修復**

固定本次預設為修正名稱與parser，不新增必備llms-full檔案要求、不改weights。保留舊c6識別供資料相容，更新c6 check version與SCANNER_VERSION，舊evidence保持舊版本與歷史分數；解析改變造成新結果差異也不可冒充同方法成效。crawler mapping分search/training/user-triggered；UA probe只表示技術抓取，不證實provider IP存取或平台收錄。既有安全fetcher及每跳redirect/DNS檢查保留。

- [ ] **Step 4: 驗證Green及整合**

下列命令預期exit 0、所有指定案例被發現且通過；integration不能skip。

```bash
npm run test:unit -- __tests__/checks/llms-content-quality.test.ts __tests__/checks/robots-policy.test.ts __tests__/checks/botAccess.test.ts __tests__/checks/scan-compatibility-freeze.test.ts __tests__/components/result-platform-status.test.ts __tests__/lib/impact.test.ts
```

- [ ] **Step 5: 執行UC／UI驗收**

en/zh-HK公開與登入報告名稱一致；舊報告不回寫分數、對不同check/scanner版本顯示不可直接比較。若executor認為要改權重，另列提案，不混進這個修復。

驗收條件：fixture驗證llms.txt/llms-full有無與Markdown連結；只封GPTBot不判OAI搜尋不可見；GoogleAIO未量測則顯示未量測；不聲稱llms為排名必要條件；score改動須版本化。

- [ ] **Step 6: 提交及更新追蹤**

只stage本任務檔案與必要遷移/測試，建議commit：`fix(scan): align optional llms diagnostics and crawler evidence`。把candidate SHA、命令、fixture、結果與證據填入矩陣；尚缺UI/live則待驗收。回退：獨立commit回退；保留舊score版本

### T02 · 撤下未有依據的行業平均

**追蹤：** P1；F02；UC01；來源E02;E08。依賴：無。批次B1。

**Files:**

- Modify／重用：`lib/impact.ts`
- Modify／重用：`components/result/ScoreReveal.tsx`
- Modify／重用：`messages/en.json`
- Modify／重用：`messages/zh-HK.json`

**Interfaces:** ImpactReport中的benchmark改為可空：benchmark:null在沒有已核實資料集時為唯一正式預設。可驗證benchmark若日後加入必須有source/sampleSize/asOf/methodVersion，不在此任务製造資料。

- [ ] **Step 1: 寫失敗測試**

unverified_benchmark_is_hidden：technology掃描不顯示「平均61」與相對平均+12；自身技術分数和明確標示的改善情境估算仍可讀。

- [ ] **Step 2: 確認Red並保存基線**

先跑下列命令中的unit／fixture部分；確認至少一個命名案例因目標行為失敗。對DB競態須在隔離DB另重現，不只mock SQL字串。證據放`artifacts/aiso/T02/before/`。

- [ ] **Step 3: 實作最小完整修復**

移除正式頁對INDUSTRY_BENCHMARKS常數的行業平均比較；如sample-report保留示例則明示合成且不可流入正式DTO。不要把文字改成很小的免責聲明而仍保留平均徽章。清理使用者看到的相依差值，但不順便重寫評分模型。

- [ ] **Step 4: 驗證Green及整合**

下列命令預期exit 0、所有指定案例被發現且通過；integration不能skip。

```bash
npm run test:unit -- __tests__/lib/impact.test.ts __tests__/components/public-impact-estimate.test.tsx __tests__/sample-report.test.tsx
```

- [ ] **Step 5: 執行UC／UI驗收**

有效掃描重新讀取：沒有無來源的平均數，現有73/B之類歷史分數仍可解釋。兩語及public/full路徑一致。

驗收條件：en／zh-HK兩語均不把常數稱市場平均；有資料才顯示source/n/date；公開與登入版一致。

- [ ] **Step 6: 提交及更新追蹤**

只stage本任務檔案與必要遷移/測試，建議commit：`fix(report): remove unsupported industry benchmark claims`。把candidate SHA、命令、fixture、結果與證據填入矩陣；尚缺UI/live則待驗收。回退：回退文案commit

### T06 · 避免不合資格客戶餓死排程

**追蹤：** P1；F07；UC07；來源E06:R05;E08。依賴：無。批次B1。

**Files:**

- Modify／重用：`lib/pulse/schedule.ts`
- Modify／重用：`app/api/cron/pulse/route.ts`
- Modify／重用：`__tests__/api/cron-pulse.test.ts`
- Create／擬新增：`__tests__/lib/pulse-schedule-pagination.test.ts`

**Interfaces:** 新增selectPendingClientPage(sql, {limit,after,scanWeek,deadlineMs}): Promise<{items:PendingClient[];nextCursor:CandidateCursor|null;exhausted:boolean;scanned:number}>。CandidateCursor={createdAt:string;clientId:string}。保留既有PendingClient形狀到T05/T07接管；不得把items=[]等同exhausted。

- [ ] **Step 1: 寫失敗測試**

expired_oldest_does_not_starve_paid_client：R05的過期override排最前，limit=1仍可找到後面有效付費品牌。連續101個無效候選跨頁後仍找到有效者；到deadline返回exhausted=false及cursor。

- [ ] **Step 2: 確認Red並保存基線**

先跑下列命令中的unit／fixture部分；確認至少一個命名案例因目標行為失敗。對DB競態須在隔離DB另重現，不只mock SQL字串。證據放`artifacts/aiso/T06/before/`。

- [ ] **Step 3: 實作最小完整修復**

SQL用穩定created_at,id keyset讀候選；每頁呼叫resolveCommercialEntitlement，不重寫一套SQL entitlement。遍歷至取得足量有效品牌、真正耗盡或deadline。時間到保存cursor供續行；cron以exhausted區分done與deferred。全無品牌、全不合資格、全部完成回應分開。

- [ ] **Step 4: 驗證Green及整合**

下列命令預期exit 0、所有指定案例被發現且通過；integration不能skip。

```bash
npm run test:unit -- __tests__/lib/pulse-schedule-pagination.test.ts __tests__/api/cron-pulse.test.ts
npm run test:integration -- __tests__/integration/pulse-summary.test.ts
```

- [ ] **Step 5: 執行UC／UI驗收**

本任務先消除選取飢餓；完成不等於F06游標或F08續跑已修。T05/T07再把完成判定切到manifest/item ledger。

驗收條件：最舊過期override後仍選下一付費品牌；連續多個無效候選不誤判done；無品牌與全完成分開；不複製商業規則。

- [ ] **Step 6: 提交及更新追蹤**

只stage本任務檔案與必要遷移/測試，建議commit：`fix(pulse): paginate eligibility candidates without starvation`。把candidate SHA、命令、fixture、結果與證據填入矩陣；尚缺UI/live則待驗收。回退：回退selector；不刪任何工作紀錄

### T10 · 讓onboarding可恢復及可觀察

**追蹤：** P1；F10；UC04；來源E08。依賴：無。批次B1。

**Files:**

- Modify／重用：`components/onboarding/OnboardingWizard.tsx`
- Modify／重用：`app/api/onboarding/complete/route.ts`
- Modify／重用：`messages/en.json`
- Modify／重用：`messages/zh-HK.json`
- Modify／重用：`__tests__/api/onboarding-flow.test.ts`
- Create／擬新增：`lib/onboarding/schema.ts`
- Create／擬新增：`lib/onboarding/store.ts`
- Create／擬新增：`lib/onboarding/service.ts`
- Create／擬新增：`supabase/migrations/055_onboarding_progress.sql`
- Create／擬新增：`__tests__/integration/onboarding-resume.test.ts`
- Create／擬新增：`tests/e2e/onboarding-recovery.spec.ts`

**Interfaces:** OnboardingProgress={clientId:string|null;brand:pending|ready;prompts:pending|running|ready|failed;promptCount:number;scanId:string|null;retryable:boolean;errorCode:string|null}。complete/resume使用同一account+intentKey；回應保留原clientId/scanId/trialEndsAt並新增progress。retryOnboardingSeed(scope,clientId):Promise<OnboardingProgress>僅恢復缺失步驟。

- [ ] **Step 1: 寫失敗測試**

network_rejection_releases_loading：fetch拒絕與invalid JSON都解除loading且保留輸入。seed_failure_resumes_same_client：第一次brand成功/seed失敗，第二次只補題；expect(clientCount).toBe(1)，trial起訖不變；兩個並行重試不重複24題。

- [ ] **Step 2: 確認Red並保存基線**

先跑下列命令中的unit／fixture部分；確認至少一個命名案例因目標行為失敗。對DB競態須在隔離DB另重現，不只mock SQL字串。證據放`artifacts/aiso/T10/before/`。

- [ ] **Step 3: 實作最小完整修復**

Wizard以try/catch/finally覆蓋完整提交。新增小型持久進度與seed lease，brand建立成功但seed失敗回partial progress，給重試生成／先進工作區選擇。existingClient路徑也讀真實進度；指定client必須驗account，不隨意取其他品牌。保存seed version、實際題數與錯誤代碼；恢復不覆寫人手問題、不重建品牌、不重開trial，遵守MAX_PROMPTS=50。

- [ ] **Step 4: 驗證Green及整合**

下列命令預期exit 0、所有指定案例被發現且通過；integration不能skip。

```bash
npm run test:unit -- __tests__/api/onboarding-flow.test.ts __tests__/components/onboarding-wizard-bilingual.test.tsx
npm run test:integration -- __tests__/integration/onboarding-resume.test.ts
npm run e2e -- tests/e2e/onboarding-recovery.spec.ts --project=chromium
```

- [ ] **Step 5: 執行UC／UI驗收**

新隔離帳戶在brand insert後、scan關聯後、seed途中各中斷重入；只恢復缺失步驟。Migration055為基線後建議名，開工先確認號碼未被新main占用。

驗收條件：networkreject/invalidJSON/seedtimeout皆有下一步；草稿保留loading解除；重試同client不重開試用；已建品牌但0題有明確恢復入口。

- [ ] **Step 6: 提交及更新追蹤**

只stage本任務檔案與必要遷移/測試，建議commit：`fix(onboarding): resume failed setup without duplicate brands or trials`。把candidate SHA、命令、fixture、結果與證據填入矩陣；尚缺UI/live則待驗收。回退：停新resume入口；保留舊成功路徑及step紀錄

### T05 · 建立Pulse固定run與attempt ledger

**追蹤：** P1；F06；UC08；來源E06:R06;E08。依賴：無。批次B2。

**Files:**

- Modify／重用：`app/api/pulse/run/route.ts`
- Modify／重用：`lib/openrouter.ts`
- Modify／重用：`lib/pulse/summary.ts`
- Modify／重用：`lib/pulse/observed-summary.ts`
- Modify／重用：`lib/pulse/schedule.ts`
- Modify／重用：`lib/pulse/platforms.ts`
- Modify／重用：`lib/flags.ts`
- Modify／重用：`scripts/schema-equivalence/manifest.mjs`
- Create／擬新增：`lib/pulse/runs/schema.ts`
- Create／擬新增：`lib/pulse/runs/store.ts`
- Create／擬新增：`lib/pulse/runs/service.ts`
- Create／擬新增：`supabase/migrations/056_pulse_run_ledger.sql`
- Create／擬新增：`__tests__/lib/pulse-run-ledger.test.ts`
- Create／擬新增：`__tests__/integration/pulse-runs.test.ts`

**Interfaces:** 定義PulseRun/PulseRunItem/PulseItemAttempt及RunCoverage（見共享契約C3）。createOrResumeRun(scope,{scanWeek,manifest}):Promise<PulseRun>；claimDueItems(runId,{owner,leaseUntil,limit}):Promise<LeasedItem[]>；commitAttempt(lease,output):Promise<committed|stale-lease|already-recorded>；readRunCoverage(scope,runId):Promise<RunCoverage>。所有HTTP成功/失敗均保留item與attempt證據。

- [ ] **Step 1: 寫失敗測試**

three_by_five_has_fifteen_items：3題×5個實際model variants=15；首題全失敗仍有5個failed/retry_wait項，後兩題不被跳過。two_workers_one_item_one_commit：同item同lease只一個被接受。rerun_keeps_success：已成功答案不被delete。late_worker_cannot_overwrite_new_lease：舊lease晚到結果不得覆寫。

- [ ] **Step 2: 確認Red並保存基線**

先跑下列命令中的unit／fixture部分；確認至少一個命名案例因目標行為失敗。對DB競態須在隔離DB另重現，不只mock SQL字串。證據放`artifacts/aiso/T05/before/`。

- [ ] **Step 3: 實作最小完整修復**

新增三表固定run/預期item/實際attempt；唯一鍵與lease/fencing在DB層。首次開run快照問題、語言、市場、模型ID及版本；修改/停用prompt不變更既有manifest。先保存原始回應與採集結果，再分類；失敗item仍在分母。對pulse_metrics加nullable run_item_id及partial unique以向後相容投影，legacy rows不硬補unknown模型或期望分母。停止delete-before-insert；新writer先由FEATURE_PULSE_ATTEMPTS控制，只在隔離環境打開。

- [ ] **Step 4: 驗證Green及整合**

下列命令預期exit 0、所有指定案例被發現且通過；integration不能skip。

```bash
npm run test:unit -- __tests__/lib/pulse-run-ledger.test.ts __tests__/api/pulse-run.test.ts __tests__/lib/pulse-summary.test.ts
npm run test:integration -- __tests__/integration/pulse-runs.test.ts __tests__/integration/pulse-summary.test.ts
```

- [ ] **Step 5: 執行UC／UI驗收**

測provider成功後DB寫入失敗、consumer重啟、雙worker、prompt刪改、週界及相同run重試。exactly-once只保證DB接受結果，不聲稱LLM外部呼叫不會重複收費；未知回應須記錄並受retry預算限制。

驗收條件：3題×5模型產生15預期項；首題全失敗不漏題；部分成功顯示coverage；雙worker不重複；重試不刪成功答案；修改問題庫不改既有manifest；跨週續跑原run。

- [ ] **Step 6: 提交及更新追蹤**

只stage本任務檔案與必要遷移/測試，建議commit：`feat(pulse): persist run manifests and durable attempt evidence`。把candidate SHA、命令、fixture、結果與證據填入矩陣；尚缺UI/live則待驗收。回退：expand-contract migration；停用新writer；保留既有metrics及新attempt審計

### T07 · 持久續跑、隔離失敗及時間預算

**追蹤：** P1；F08；UC08;UC13；來源E08;E11。依賴：T05;T06。批次B2。

**Files:**

- Modify／重用：`app/api/cron/pulse/route.ts`
- Modify／重用：`app/api/pulse/run/route.ts`
- Modify／重用：`cloudflare/cron-worker/src/index.ts`
- Modify／重用：`cloudflare/cron-worker/test/scheduled.test.ts`
- Modify／重用：`lib/cron/recordRun.ts`
- Modify／重用：`lib/alerts/evaluate.ts`
- Modify／重用：`vercel.json`
- Modify／重用：`docs/runbooks/deploy-cron-worker.md`
- Create／擬新增：`lib/pulse/runs/worker.ts`
- Create／擬新增：`__tests__/lib/pulse-worker.test.ts`

**Interfaces:** consumeDuePulseWork({deadlineAt,owner,mode:weekly|repair}):Promise<{outcome:complete|partial|failed|blocked;processed:number;remaining:number;failed:number;runIds:string[]}>。使用T05 lease/attempt，不以HTTP self-call當持久狀態。候選遍歷採T06的exhausted契約。

- [ ] **Step 1: 寫失敗測試**

interrupted_after_budget_resumes_original_week：一項slow45s與中途終止留下可恢復checkpoint；隔天repair續同scanWeek。bad_client_does_not_block_next：A錯誤仍處理B。chain_cap_is_partial：cap不能記成完整成功。

- [ ] **Step 2: 確認Red並保存基線**

先跑下列命令中的unit／fixture部分；確認至少一個命名案例因目標行為失敗。對DB競態須在隔離DB另重現，不只mock SQL字串。證據放`artifacts/aiso/T07/before/`。

- [ ] **Step 3: 實作最小完整修復**

每次route採45秒工作deadline、至少5秒保存餘量；剩餘時間不夠不開新item。provider call timeout受剩餘budget限制；初始retry最多3次、退避60/300/1800秒，retry_wait持久化。保留現有週trigger；現有每日09:00UTC fan-out追加repair，只恢復due unfinished runs，不每天新建Pulse、不重寄其他job。自呼叫只可加快處理，丟失後仍靠每日repair；所有client隔離錯誤。Alert只在所依run完整時給確定結論，partial顯示採集未完成。

- [ ] **Step 4: 驗證Green及整合**

下列命令預期exit 0、所有指定案例被發現且通過；integration不能skip。

```bash
npm run test:unit -- __tests__/lib/pulse-worker.test.ts __tests__/api/cron-pulse.test.ts __tests__/api/cron/evaluate-alerts.test.ts __tests__/config/function-durations.test.ts
npm --prefix cloudflare/cron-worker run test
npm --prefix cloudflare/cron-worker run typecheck
npm run test:integration -- __tests__/integration/pulse-runs.test.ts
```

- [ ] **Step 5: 執行UC／UI驗收**

確實測失去self-call後由另一個trigger恢復。初始repair為每日，不承諾分鐘級恢復；較高頻率是後續容量決定。控制每run最大嘗試與token上限，輸出unknown成本時不可當0。跨週不切run。不得用加大timeout代替checkpoint。

驗收條件：slow45s情境在route截止前保存checkpoint；壞client不阻塞其他；self-call丟失可補跑；chaincap標partial；每日repair可續原週；告警不基於不完整分母。

- [ ] **Step 6: 提交及更新追蹤**

只stage本任務檔案與必要遷移/測試，建議commit：`fix(pulse): resume durable work within bounded cron budgets`。把candidate SHA、命令、fixture、結果與證據填入矩陣；尚缺UI/live則待驗收。回退：停新scheduler；單一consumer；保留queue供回退接續

### T08 · 分類降級顯式化並建立準確度基準

**追蹤：** P1；F05；UC03;UC09；來源E06:R02,R03;E08。依賴：T05。批次B2。

**Files:**

- Modify／重用：`lib/pulse/analysis.ts`
- Modify／重用：`app/api/pulse/run/route.ts`
- Modify／重用：`lib/pulse/summary.ts`
- Modify／重用：`lib/pulse/runs/schema.ts`
- Modify／重用：`lib/pulse/runs/store.ts`
- Create／擬新增：`lib/pulse/analysis-fallback.ts`
- Create／擬新增：`__tests__/lib/pulse-analysis-fallback.test.ts`
- Create／擬新增：`tests/fixtures/pulse-analysis-labelled.json`
- Create／擬新增：`scripts/evaluate-pulse-analysis.ts`

**Interfaces:** AnswerAnalysisV2={classificationStatus:classified|fallback|failed|legacy_unknown;method:string;version:string;brandMentioned:boolean|null;sentiment:positive|neutral|negative|unknown;matchedText:string[];competitorsMentioned:string[]}。naiveAnalysis保留可疑字面匹配證據，但不產生肯定情緒；unknown不進提及或情緒已分類分母。

- [ ] **Step 1: 寫失敗測試**

fallback_negative_is_unknown：R02負評在classifier失敗時sentiment=unknown，不是positive。pineapple_is_not_apple：R03不認Apple。unicode_brand_match_is_explicit：NFC、全半形、中文連續字及混合語言有固定fixture；無把握回unknown。

- [ ] **Step 2: 確認Red並保存基線**

先跑下列命令中的unit／fixture部分；確認至少一個命名案例因目標行為失敗。對DB競態須在隔離DB另重現，不只mock SQL字串。證據放`artifacts/aiso/T08/before/`。

- [ ] **Step 3: 實作最小完整修復**

把provider採集成功與分析成功分開；分類失敗可以重用已保存答案重試，不再付費重採。將純fallback抽至analysis-fallback.ts，原analysis.ts重新匯出；離線script只用相對.ts路徑匯入此純模組，無@/alias或付費provider依賴。引入status/method/version，legacy缺資料顯示unknown；私人entities aliases不擅自成為量度身份。建立120個合成標註案例（中英各60，正/負/中性/未提及/歧義/故障每類20），標明人工覆核與未覆核標記；輸出混淆矩陣、n、precision/recall、失敗數。

- [ ] **Step 4: 驗證Green及整合**

下列命令預期exit 0、所有指定案例被發現且通過；integration不能skip。

```bash
npm run test:unit -- __tests__/lib/pulse-analysis-fallback.test.ts __tests__/lib/pulse-summary.test.ts
node --experimental-strip-types scripts/evaluate-pulse-analysis.ts --input tests/fixtures/pulse-analysis-labelled.json --mode fixtures --output artifacts/pulse-analysis-evaluation.json
```

- [ ] **Step 5: 執行UC／UI驗收**

新增script只用fixtures模式作必跑gate，不能默認呼叫付費API。人工未覆核標籤不得宣稱gold set；實際模型評測另需明確環境及費用上限。最低gate為R02/R03不再出錯、所有unknown分母處理一致。

驗收條件：R02負評fallback不是positive；R03不直接認Apple；分類失敗顯示unknown並排除情緒分母；中英標註集公布n、precision/recall與混淆矩陣。

- [ ] **Step 6: 提交及更新追蹤**

只stage本任務檔案與必要遷移/測試，建議commit：`fix(pulse): expose uncertain analysis and prevent positive fallbacks`。把candidate SHA、命令、fixture、結果與證據填入矩陣；尚缺UI/live則待驗收。回退：可停新分類器；歷史欄位不破壞；保存方法版本

### T09 · 可覆核的觀察詳情及採集定義

**追蹤：** P2；F12；UC09;UC15；來源E08。依賴：T05;T08。批次B2。

**Files:**

- Modify／重用：`lib/observations/types.ts`
- Modify／重用：`lib/observations/schema.ts`
- Modify／重用：`lib/observations/store.ts`
- Modify／重用：`lib/observations/service.ts`
- Modify／重用：`components/observations/ObservationWorkspace.tsx`
- Modify／重用：`messages/en.json`
- Modify／重用：`messages/zh-HK.json`
- Create／擬新增：`app/api/clients/[clientId]/observations/[observationId]/route.ts`
- Create／擬新增：`components/observations/ObservationDetail.tsx`
- Create／擬新增：`__tests__/api/observation-detail.test.ts`

**Interfaces:** GET /api/clients/:clientId/observations/:observationId → {observation:ObservationDetailDto}，含rawAnswer、promptSnapshot、model/collector/market/collectedAt、classification、links[{url,kind:text-link|provider-citation}]及limitations。只讀T05/T08持久欄位；legacy可null。

- [ ] **Step 1: 寫失敗測試**

observation_detail_replays_snapshot：改現行題目/模型後，舊觀察detail仍讀原快照。other_tenant_gets_404：A不能讀B原文。text_link_is_not_verified_citation：regex URL不能標provider citation；unsafe URL不成可執行連結。

- [ ] **Step 2: 確認Red並保存基線**

先跑下列命令中的unit／fixture部分；確認至少一個命名案例因目標行為失敗。對DB競態須在隔離DB另重現，不只mock SQL字串。證據放`artifacts/aiso/T09/before/`。

- [ ] **Step 3: 實作最小完整修復**

列表保持精簡，點列開詳情drawer/頁面；原文作純文字，載入/錯誤/重試/無原文狀態明確。模型ID與collector分欄，API樣本不能命名consumer ranking；缺欄位不以目前設定回填。關閉drawer回原篩選與焦點；篩選變更使cursor失效並回首頁。

- [ ] **Step 4: 驗證Green及整合**

下列命令預期exit 0、所有指定案例被發現且通過；integration不能skip。

```bash
npm run test:unit -- __tests__/api/observation-detail.test.ts __tests__/observations/projection.test.ts __tests__/components/observation-render.test.tsx
npm run test:integration -- __tests__/integration/feature-store-tenancy.test.ts
npm run e2e -- tests/e2e/c9b-observations.spec.ts --project=chromium
```

- [ ] **Step 5: 執行UC／UI驗收**

以非空隔離觀察驗答案、兩週、兩模型、空白、出錯重試及跨租戶。未經核准的資料不得在summary、export或error中旁路洩漏。

驗收條件：授權角色可讀原文與快照；跨租戶不可讀；API sample不寫成consumer rank；文字URL與verified citation分開；舊資料仍明示unknown。

- [ ] **Step 6: 提交及更新追蹤**

只stage本任務檔案與必要遷移/測試，建議commit：`feat(observations): provide tenant-scoped answer evidence details`。把candidate SHA、命令、fixture、結果與證據填入矩陣；尚缺UI/live則待驗收。回退：新增詳情feature flag；保留舊投影

### T18 · 補齊網域驗證的首次取得內容流程

**追蹤：** P2；F17；UC17；來源E13;E19。依賴：無。批次B3。

**Files:**

- Modify／重用：`components/entities/DomainVerificationPanel.tsx`
- Modify／重用：`lib/domain-verification/service.ts`
- Modify／重用：`app/[lang]/dashboard/[clientId]/entities/page.tsx`
- Modify／重用：`messages/en.json`
- Modify／重用：`messages/zh-HK.json`
- Create／擬新增：`__tests__/components/domain-verification-first-use.test.tsx`

**Interfaces:** DomainVerificationPanel增加needs-token/loading-token/ready/checking/error視圖狀態；明確「取得驗證內容」按鈕呼叫現有GET domain-verification。取得內容後才顯示放檔說明及檢查按鈕。POST仍只由檢查動作觸發。

- [ ] **Step 1: 寫失敗測試**

new_brand_gets_token_before_probe：token=null時不能先POST檢查；按取得內容後看到path和token。GET失敗顯示可重試，reload不重設既有token；domain變更按既有規則invalidate。

- [ ] **Step 2: 確認Red並保存基線**

先跑下列命令中的unit／fixture部分；確認至少一個命名案例因目標行為失敗。對DB競態須在隔離DB另重現，不只mock SQL字串。證據放`artifacts/aiso/T18/before/`。

- [ ] **Step 3: 實作最小完整修復**

接回已有GET readDomainVerification，不新增第二套token或在SSR render偷偷寫資料。既有驗證狀態、可達性保護及tenant授權不變；取得與檢查pending分開，複製完成有可讀回饋。

- [ ] **Step 4: 驗證Green及整合**

下列命令預期exit 0、所有指定案例被發現且通過；integration不能skip。

```bash
npm run test:unit -- __tests__/components/domain-verification-first-use.test.tsx __tests__/api/domain-verification.test.ts
npm run test:integration -- __tests__/integration/domain-verification.test.ts
npm run e2e -- tests/e2e/c9a-entities.spec.ts --project=chromium
```

- [ ] **Step 5: 執行UC／UI驗收**

隔離受控網域完成「取得→放檔→檢查」；無受控網域時positive分支用受控server fixture，production驗證保留待驗。不要再次probe example.com作為網域成功證明。

驗收條件：全新品牌先取得完整內容才顯示檢查步驟；重試沿用token；取得失敗不顯空內容要求上傳；既有已驗證品牌不被重設；仍遵守tenant及domain變更規則。

- [ ] **Step 6: 提交及更新追蹤**

只stage本任務檔案與必要遷移/測試，建議commit：`fix(entities): show verification content before the first check`。把candidate SHA、命令、fixture、結果與證據填入矩陣；尚缺UI/live則待驗收。回退：回退前端新入口；保留已發token及驗證審計。

### T20 · 所有草稿入口載入完整清單首頁

**追蹤：** P2；F19；UC19；來源E14;E19。依賴：無。批次B3。

**Files:**

- Modify／重用：`components/opportunities/OpportunityWorkspace.tsx`
- Create／擬新增：`tests/e2e/opportunity-draft-list.spec.ts`

**Interfaces:** 同一ensureDraftListLoaded():Promise<void>供tab click、save成功與open成功使用；listState=idle|loading|loaded|error，selectedId與editor dirty state獨立。游標append按workItem.id去重。

- [ ] **Step 1: 寫失敗測試**

saving_b_keeps_existing_a_visible：fixture已有A，save B進drafts，等待後A/B均可見且B選中。list_failure_keeps_editor：list失敗不丟B或未存內容；retry成功恢復清單。

- [ ] **Step 2: 確認Red並保存基線**

先跑下列命令中的unit／fixture部分；確認至少一個命名案例因目標行為失敗。對DB競態須在隔離DB另重現，不只mock SQL字串。證據放`artifacts/aiso/T20/before/`。

- [ ] **Step 3: 實作最小完整修復**

修正save/open直接setView繞過list的路徑，呈現真實loading/error而非看似完整單項清單。refresh只更新已儲存列表；不能自動覆蓋dirty editor；返回與多次切tab不重複觸发fetch。

- [ ] **Step 4: 驗證Green及整合**

下列命令預期exit 0、所有指定案例被發現且通過；integration不能skip。

```bash
npm run test:unit -- __tests__/components/opportunity-render.test.tsx
npm run e2e -- tests/e2e/opportunity-draft-list.spec.ts --project=chromium --project=mobile
```

- [ ] **Step 5: 執行UC／UI驗收**

用E14「刷新前只有新稿／刷新後兩份」作回歸案例。以第三頁資料驗append去重；舊草稿原語系與內容保留。

驗收條件：已有A草稿時由suggestion保存B，即顯示A/B或明確loading；open同樣載入首頁；列表失敗可重試；不丟尚未儲存編輯；cursor append去重；重整後選中B。

- [ ] **Step 6: 提交及更新追蹤**

只stage本任務檔案與必要遷移/測試，建議commit：`fix(opportunities): load saved drafts from every entry path`。把candidate SHA、命令、fixture、結果與證據填入矩陣；尚缺UI/live則待驗收。回退：回退單一前端commit，不更改已儲存草稿資料。

### T14 · 安全保留工具登入目的地

**追蹤：** P2；F15；UC10；來源E03;E07;E08。依賴：無。批次B3。

**Files:**

- Modify／重用：`lib/auth.ts`
- Modify／重用：`lib/auth-client.ts`
- Modify／重用：`components/auth/LoginForm.tsx`
- Modify／重用：`components/auth/AuthComplete.tsx`
- Modify／重用：`app/[lang]/dashboard/layout.tsx`
- Modify／重用：`proxy.ts`
- Create／擬新增：`lib/auth-return-to.ts`
- Create／擬新增：`__tests__/lib/auth-return-to.test.ts`
- Create／擬新增：`tests/e2e/auth-return-to.spec.ts`

**Interfaces:** safeReturnTo(raw:unknown,lang:en|zh-HK):string，以URL parser及path allowlist只接受本站已知dashboard子路徑。requireAuth新增可選returnTo；login→auth/complete→站內目的地共享同一sanitizer。保留目前SDK verifier/challenge分支。

- [ ] **Step 1: 寫失敗測試**

deep_link_returns_to_same_tool：五工具各驗一次安全目的地。reject_encoded_external_return：//evil、反斜線、%2f%2f、雙重編碼、javascript:、CRLF、登入循環都fallback dashboard；OAuth secret query不寫進return-to或log。

- [ ] **Step 2: 確認Red並保存基線**

先跑下列命令中的unit／fixture部分；確認至少一個命名案例因目標行為失敗。對DB競態須在隔離DB另重現，不只mock SQL字串。證據放`artifacts/aiso/T14/before/`。

- [ ] **Step 3: 實作最小完整修復**

在proxy覆寫而非信任client送來的path header，讓layout拿到安全pathname及有限query（例如step），或用repo既有可信path機制。只保留業務query allowlist；session verifier等敏感值剔除。Google與magic-link callback均保存站內目的地；不碰Neon Auth核心交換機制。

- [ ] **Step 4: 驗證Green及整合**

下列命令預期exit 0、所有指定案例被發現且通過；integration不能skip。

```bash
npm run test:unit -- __tests__/lib/auth-return-to.test.ts __tests__/components/google-auth-start-route.test.ts __tests__/lib/auth-client.test.ts __tests__/proxy.test.ts
npm run e2e -- tests/e2e/auth-return-to.spec.ts --project=chromium
```

- [ ] **Step 5: 執行UC／UI驗收**

本機fixture測redirect contract；真實OAuth及magic link各有一次人工登入續驗，沒有安全登入就保持待驗，不把mock callback當實際Google成功。

驗收條件：五條深連結登入後回原工具；拒絕外站與//URL；過期session重登入仍可恢復；敏感query不進紀錄。

- [ ] **Step 6: 提交及更新追蹤**

只stage本任務檔案與必要遷移/測試，建議commit：`fix(auth): preserve validated workspace return destinations`。把candidate SHA、命令、fixture、結果與證據填入矩陣；尚缺UI/live則待驗收。回退：回退return-to功能；fallback dashboard

### T13 · 補齊問題庫可存取控件

**追蹤：** P2；F14；UC06;UC14；來源E08。依賴：無。批次B3。

**Files:**

- Modify／重用：`components/pulse/PromptBankEditor.tsx`
- Modify／重用：`messages/en.json`
- Modify／重用：`messages/zh-HK.json`
- Create／擬新增：`tests/e2e/prompt-bank-accessibility.spec.ts`

**Interfaces:** 每題toggle具role=switch、aria-checked及包含問題名稱的accessible name；編輯input有顯式label；保存狀態透過status/alert宣讀。

- [ ] **Step 1: 寫失敗測試**

keyboard_toggle_announces_question_and_state：鍵盤定位與切換後名稱/checked正確；network failure保留原值及草稿、可重試，focus回到原題。360/390px無遮蔽且觸控區至少44 CSS px。

- [ ] **Step 2: 確認Red並保存基線**

先跑下列命令中的unit／fixture部分；確認至少一個命名案例因目標行為失敗。對DB競態須在隔離DB另重現，不只mock SQL字串。證據放`artifacts/aiso/T13/before/`。

- [ ] **Step 3: 實作最小完整修復**

沿用現有按鈕及網絡錯誤處理，只補可識別狀態、focus與hit area；取消/保存後有明確焦點，不把所有題目讀成同一「啟用」。

- [ ] **Step 4: 驗證Green及整合**

下列命令預期exit 0、所有指定案例被發現且通過；integration不能skip。

```bash
npm run test:unit -- __tests__/components/prompt-bank-editor.test.tsx __tests__/components/prompt-bank-network.test.tsx
npm run e2e -- tests/e2e/prompt-bank-accessibility.spec.ts --project=chromium --project=mobile
```

- [ ] **Step 5: 執行UC／UI驗收**

在Pro隔離角色補keyboard與screenreader人工操作；44px為本專案目標，不宣稱本次測試等同整站WCAG認證。Free gate應仍存在。

驗收條件：鍵盤可新增編輯取消；每題開關報名稱與狀態；失敗訊息讀出；360/390px無操作遮蔽；不靠顏色傳達。

- [ ] **Step 6: 提交及更新追蹤**

只stage本任務檔案與必要遷移/測試，建議commit：`fix(prompts): expose accessible editing and toggle states`。把candidate SHA、命令、fixture、結果與證據填入矩陣；尚缺UI/live則待驗收。回退：回退CSS/markup commit

### T11 · 正確保存問題語言與市場

**追蹤：** P2；F11；UC04;UC06；來源E08。依賴：T10。批次B3。

**Files:**

- Modify／重用：`components/pulse/PromptBankEditor.tsx`
- Modify／重用：`components/onboarding/OnboardingWizard.tsx`
- Modify／重用：`app/api/onboarding/complete/route.ts`
- Modify／重用：`app/api/dashboard/clients/[clientId]/prompts/route.ts`
- Modify／重用：`app/api/dashboard/clients/[clientId]/prompts/[promptId]/route.ts`
- Modify／重用：`lib/onboarding/service.ts`
- Modify／重用：`messages/en.json`
- Modify／重用：`messages/zh-HK.json`
- Create／擬新增：`lib/prompts/context.ts`
- Create／擬新增：`supabase/migrations/057_prompt_context.sql`
- Create／擬新增：`__tests__/lib/prompt-context.test.ts`

**Interfaces:** PromptContext={language:en|zh-HK;market:string|null}；parsePromptContext(input,brandDefaults):PromptContext使用repo既有市場值驗證，UI locale僅作初次預設。prompt語言／市場隨T05 manifest快照。舊language值需adapter，不能破壞既有可讀資料。

- [ ] **Step 1: 寫失敗測試**

zh_hk_prompt_round_trips_context：中文新增後重讀language=zh-HK、market=香港對應既有enum。seed_payload_contains_context：生成指令有確認語言與市場；非法值拒絕、未分類舊值顯示未知不盲改。

- [ ] **Step 2: 確認Red並保存基線**

先跑下列命令中的unit／fixture部分；確認至少一個命名案例因目標行為失敗。對DB競態須在隔離DB另重現，不只mock SQL字串。證據放`artifacts/aiso/T11/before/`。

- [ ] **Step 3: 實作最小完整修復**

移除固定language:en；表單可確認語言和市場，預設品牌設定。必要時加nullable prompt market欄位；舊資料保留原值/unknown，沒有根據UI locale全量回填。seed schema驗證category與context，歧義不悄悄標英語；context在新run生效，已開始run維持原快照。

- [ ] **Step 4: 驗證Green及整合**

下列命令預期exit 0、所有指定案例被發現且通過；integration不能skip。

```bash
npm run test:unit -- __tests__/lib/prompt-context.test.ts __tests__/api/prompt-bank.test.ts __tests__/components/onboarding-wizard-bilingual.test.tsx
npm run test:integration -- __tests__/integration/onboarding-resume.test.ts __tests__/integration/pulse-runs.test.ts
```

- [ ] **Step 5: 執行UC／UI驗收**

核對當前schema/enum再新增migration057；若現有prompt語言採其他代碼，在context adapter集中映射並以既有API相容測試約束，不能只改前端。

驗收條件：繁中與英文新增后重讀標籤正確；市場可確認；server拒絕未知enum；seed包括locale/market；不盲目覆寫舊資料。

- [ ] **Step 6: 提交及更新追蹤**

只stage本任務檔案與必要遷移/測試，建議commit：`fix(prompts): persist confirmed language and market context`。把candidate SHA、命令、fixture、結果與證據填入矩陣；尚缺UI/live則待驗收。回退：回退UI；保留新增metadata，舊紀錄不自動改寫

### T03 · 以完整證據決定首項改善

**追蹤：** P2；F04；UC02；來源E02;E06:R04;E08。依賴：T01。批次B3。

**Files:**

- Modify／重用：`lib/result-access.ts`
- Modify／重用：`lib/view-models/owner-priorities.ts`
- Modify／重用：`components/result/ResultClient.tsx`
- Create／擬新增：`lib/view-models/check-priority.ts`
- Create／擬新增：`__tests__/lib/check-priority.test.ts`

**Interfaces:** rankActionableChecks(checks):RankedCheck[]先collection=complete且applicable，再fail>warn，最後穩定check key tie-break；不可行動的unknown/collection-failed另輸出資料不足卡。public結果、owner及T19使用同一resolver。

- [ ] **Step 1: 寫失敗測試**

confirmed_failure_precedes_warning：R04 c6 warn/c8 fail選c8。incomplete_check_is_retry_not_fix：較嚴重但採集不完整者不當已證實缺陷；全unknown時只提供重試。

- [ ] **Step 2: 確認Red並保存基線**

先跑下列命令中的unit／fixture部分；確認至少一個命名案例因目標行為失敗。對DB競態須在隔離DB另重現，不只mock SQL字串。證據放`artifacts/aiso/T03/before/`。

- [ ] **Step 3: 實作最小完整修復**

把業務順序與證據資格規則抽成小型純函數，不以magic array任意挑首項。保留原報告可公開的資料範圍，不能為排序洩漏付費詳情。

- [ ] **Step 4: 驗證Green及整合**

下列命令預期exit 0、所有指定案例被發現且通過；integration不能skip。

```bash
npm run test:unit -- __tests__/lib/check-priority.test.ts __tests__/lib/result-access.test.ts __tests__/lib/owner-priorities.test.ts __tests__/components/top-issue-card.test.tsx
```

- [ ] **Step 5: 執行UC／UI驗收**

兩語、公开和登入版同一組fixture排序一致；單一warn、所有pass、unknown與not-applicable各有清楚結果。

驗收條件：c6warn/c8fail選擇符合公開規則；collectionfailed不當已確認fail；全部unknown時提供重試而非確定修復。

- [ ] **Step 6: 提交及更新追蹤**

只stage本任務檔案與必要遷移/測試，建議commit：`fix(report): prioritize actionable evidence by severity`。把candidate SHA、命令、fixture、結果與證據填入矩陣；尚缺UI/live則待驗收。回退：回退resolver adapter

### T19 · 改善建議改為可理解及可行動的內容

**追蹤：** P2；F18；UC12;UC19；來源E14;E19。依賴：T01;T03。批次B3。

**Files:**

- Modify／重用：`lib/opportunities/rules.ts`
- Modify／重用：`lib/opportunities/service.ts`
- Modify／重用：`components/opportunities/OpportunityWorkspace.tsx`
- Modify／重用：`messages/en.json`
- Modify／重用：`messages/zh-HK.json`
- Modify／重用：`lib/checkExplanations.ts`

**Interfaces:** 重用現有check explanation/catalogue，新增opportunity title/action映射；排序呼叫T03 rankActionableChecks。raw checkKey仍保留為debug/evidence識別，不作主標。

- [ ] **Step 1: 寫失敗測試**

localized_action_describes_check_without_guessing_page：c11呈「檢查常見問題內容」等人可理解標題；origin-only資料不能冒出頁面路徑；c10 warn不能只因字典順序排在c11 fail前。

- [ ] **Step 2: 確認Red並保存基線**

先跑下列命令中的unit／fixture部分；確認至少一個命名案例因目標行為失敗。對DB競態須在隔離DB另重現，不只mock SQL字串。證據放`artifacts/aiso/T19/before/`。

- [ ] **Step 3: 實作最小完整修復**

主標使用業務名稱、正文說明證據支持的下一步；沒有頁面摘錄時引導重掃或定位內容，保留限制提示。既有English草稿是歷史snapshot，不自動重寫；新保存草稿才用所選語系文案。排序改動若影響rule fingerprint，版本化rule並保留舊草稿來源。

- [ ] **Step 4: 驗證Green及整合**

下列命令預期exit 0、所有指定案例被發現且通過；integration不能skip。

```bash
npm run test:unit -- __tests__/opportunities/rules.test.ts __tests__/components/opportunity-render.test.tsx __tests__/lib/check-explanations-parity.test.ts
npm run e2e -- tests/e2e/c9c-opportunities.spec.ts --project=chromium
```

- [ ] **Step 5: 執行UC／UI驗收**

16候選fixture由非技術同事讀出問題及下一步；沒有憑origin捏造確切頁面、排名或提升幅度。

驗收條件：en／zh-HK兩語卡片主標不用裸checkKey；只按保留證據描述；origin-only不捏造確切頁；c10warn不僅因字典順序凌駕較嚴重項；既有英文草稿快照不強制重寫。

- [ ] **Step 6: 提交及更新追蹤**

只stage本任務檔案與必要遷移/測試，建議commit：`fix(opportunities): show useful localized actions and priorities`。把candidate SHA、命令、fixture、結果與證據填入矩陣；尚缺UI/live則待驗收。回退：回退卡片呈現；保留原始evidence和draft snapshot。

### T12 · 來源與改善候選分頁及批次維護

**追蹤：** P2；F13；UC11;UC12；來源E08。依賴：T04。批次B3。

**Files:**

- Modify／重用：`lib/sources/store.ts`
- Modify／重用：`lib/sources/schema.ts`
- Modify／重用：`lib/sources/service.ts`
- Modify／重用：`lib/view-models/source-pack.ts`
- Modify／重用：`app/api/clients/[clientId]/sources/route.ts`
- Modify／重用：`app/[lang]/dashboard/[clientId]/sources/page.tsx`
- Modify／重用：`components/sources/SourcePackWorkspace.tsx`
- Modify／重用：`lib/opportunities/store.ts`
- Modify／重用：`lib/opportunities/service.ts`
- Modify／重用：`lib/opportunities/types.ts`
- Modify／重用：`app/api/clients/[clientId]/opportunities/route.ts`
- Modify／重用：`app/[lang]/dashboard/[clientId]/opportunities/page.tsx`
- Modify／重用：`components/opportunities/OpportunityWorkspace.tsx`
- Modify／重用：`lib/observations/query.ts`
- Modify／重用：`messages/en.json`
- Modify／重用：`messages/zh-HK.json`
- Create／擬新增：`lib/sources/query.ts`
- Create／擬新增：`lib/sources/import-preview.ts`
- Create／擬新增：`app/api/clients/[clientId]/sources/import-preview/route.ts`
- Create／擬新增：`__tests__/lib/source-pagination.test.ts`
- Create／擬新增：`__tests__/lib/source-import-preview.test.ts`

**Interfaces:** SourcePage={items:SourceSummary[];nextCursor:string|null;total:number;asOf:string}；預設50/max100，summary不含entries。詳細沿用readSource。PreviewRows={rows:[{rowNumber,entry|null,errorCode|null,duplicateOf|null}];validCount;invalidCount;contentHash}。preview不持久匯入；正式import仍server重驗並使用expectedLatestVersion。

- [ ] **Step 1: 寫失敗測試**

all_201_sources_are_reachable：按游標取得201筆無重複遺漏。all_250_observations_have_candidate_scope：latest週250觀察可翻頁。retry_invalid_csv_rows_preserves_valid_rows：預覽200行含錯誤，重驗失敗行後完整有效集合仍在，最終一次匯入只增一版，不以修正行覆蓋全包。

- [ ] **Step 2: 確認Red並保存基線**

先跑下列命令中的unit／fixture部分；確認至少一個命名案例因目標行為失敗。對DB競態須在隔離DB另重現，不只mock SQL字串。證據放`artifacts/aiso/T12/before/`。

- [ ] **Step 3: 實作最小完整修復**

來源清單改keyset分頁+精簡DTO，逐筆按需讀內容；來源頁與view-model一併改接SourceSummary，entryCount由server投影，統計標清全範圍與本頁。保留既有grounding資格及上下文上限，不因分頁而把所有頁面的來源塞入LLM；基線沒有獨立source picker，不額外新增。Opportunity候選依最新固定週/scan snapshot分頁，API route傳入cursor，service/types/page/元件一起更新，保留range/total/truncated揭露。沿用T19優先序並以穩定tie-break分頁；不能每頁各排一次卻宣稱全局最高優先，無法作全局排序時明示所選範圍。CSV的200是單一來源的問答行數，不是200個source packs。逐行預覽、衝突/空白/超限原因及CSV公式防護；只重送錯誤行供重新驗證，正式建立版本前須合成完整有效集合並重新驗證，沒有半包偷偷上線。

- [ ] **Step 4: 驗證Green及整合**

下列命令預期exit 0、所有指定案例被發現且通過；integration不能skip。

```bash
npm run test:unit -- __tests__/lib/source-pagination.test.ts __tests__/lib/source-import-preview.test.ts __tests__/opportunities/store.test.ts __tests__/opportunities/service.test.ts __tests__/components/source-pack-render.test.tsx __tests__/components/opportunity-render.test.tsx __tests__/lib/work-item-sources.test.ts
npm run test:integration -- __tests__/integration/client-sources.test.ts
```

- [ ] **Step 5: 執行UC／UI驗收**

游標綁定tenant與filter，換filter回首頁；新資料/編輯後刷新列表epoch，說明範圍。每field4000字、每pack200行及API body cap 262144 bytes各自生效，先顯限制。來源核准與agent許可獨立。首屏50列無entries載荷，詳情按需讀。

驗收條件：201來源可全到達且總數正確；250觀察候選範圍完整或清晰選擇；混合200列預覽逐筆錯誤；重試只重送失敗列且無重複；明示本頁/全部符合。

- [ ] **Step 6: 提交及更新追蹤**

只stage本任務檔案與必要遷移/測試，建議commit：`feat(maintenance): paginate evidence and preview source imports safely`。把candidate SHA、命令、fixture、結果與證據填入矩陣；尚缺UI/live則待驗收。回退：回退前端入口；游標API向後相容；保留原資料

### T15 · 建立每日工作摘要與工具下一步

**追蹤：** P2；F12;F13;F16；UC12;UC13；來源E08;E11;E12;E14;E15;E18。依賴：T07;T09;T12。批次B3。

**Files:**

- Modify／重用：`lib/view-models/workspace-home.ts`
- Modify／重用：`lib/view-models/owner-priorities.ts`
- Modify／重用：`components/dashboard/WorkspaceHome.tsx`
- Modify／重用：`components/observations/ObservationWorkspace.tsx`
- Modify／重用：`components/opportunities/OpportunityWorkspace.tsx`
- Modify／重用：`components/sources/SourcePackWorkspace.tsx`
- Modify／重用：`messages/en.json`
- Modify／重用：`messages/zh-HK.json`

**Interfaces:** DailyWorkSummary={coverage:RunCoverage|null;lastCompleteAt:string|null;nextDueAt:string|null;state:not_configured|pending|partial|complete|failed|disabled|unknown;nextActions:Action[]}，nextActions最多3項。從既有persisted run/source/work-item狀態derive，不增第二套狀態真相。

- [ ] **Step 1: 寫失敗測試**

partial_run_guides_to_failed_items：缺2/15項時首頁顯partial而非100%；可進失敗篩選。unapproved_source_links_to_exact_version：待核准工作到正確來源版本。free_empty_is_not_scheduler_failure：Free0觀察不展示錯誤漏跑結論。

- [ ] **Step 2: 確認Red並保存基線**

先跑下列命令中的unit／fixture部分；確認至少一個命名案例因目標行為失敗。對DB競態須在隔離DB另重現，不只mock SQL字串。證據放`artifacts/aiso/T15/before/`。

- [ ] **Step 3: 實作最小完整修復**

沿用現有owner-priorities和首頁3项工作，不重做dashboard。依角色/方案提供可操作下一步，進階run/model資料可展開。貫通觀察→機會→來源版本→私人草稿→独立覆核→人工交付→再量測；下載不是交付，變化不是因果成效。

- [ ] **Step 4: 驗證Green及整合**

下列命令預期exit 0、所有指定案例被發現且通過；integration不能skip。

```bash
npm run test:unit -- __tests__/lib/workspace-home.test.ts __tests__/components/workspace-home-priorities.test.tsx
npm run e2e -- tests/e2e/c8a-workspace-home.spec.ts --project=chromium --project=mobile
```

- [ ] **Step 5: 執行UC／UI驗收**

由日常維護角色完成UC12，不靠開發者解释內部代號；下一次HKT時間來自實際部署配置，資料不足就unknown。

驗收條件：首頁可辨資料是否新鮮及未完成原因；從失敗觀察到機會到草稿可追溯；來源顯示核准/可用/撤回；別名目前不影響觀察須保持明示；不暗示自動發布。

- [ ] **Step 6: 提交及更新追蹤**

只stage本任務檔案與必要遷移/測試，建議commit：`feat(workspace): surface actionable maintenance and run freshness`。把candidate SHA、命令、fixture、結果與證據填入矩陣；尚缺UI/live則待驗收。回退：獨立UIflag回退；不更動狀態語义

### T16 · 完成尚受方案、角色及資料限制的登入後UAT

**追蹤：** P1；F09;F10;F11;F12;F13;F14;F15；UC04;UC05;UC06;UC09;UC10;UC11;UC12;UC14;UC15；來源E08;E12;E13;E14;E15;E16;E17;E18。依賴：無。批次B4。

**Files:**

- Modify／重用：`tests/e2e/authenticated/owner-review.spec.ts`
- Modify／重用：`playwright.config.ts`
- Create／擬新增：`tests/e2e/authenticated/aiso-maintenance.spec.ts`
- Create／擬新增：`docs/runbooks/aiso-remediation-uat.md`

**Interfaces:** 使用隔離Free owner、Pro owner、獨立approver及account B；另備全新onboarding帳戶。每個UC/OP記candidateSha、environment、role、fixture、result、evidencePath與cleanup；fixture pass與live pass分欄。

- [ ] **Step 1: 建立本任務的證據清單**

按原UC01–UC19及OP01–OP63逐項重驗，新增case記新ID不得覆盖原證據。A讀寫B之entity/source/observation/work-item/prompt均404且無存在性洩漏；role撤銷後session不可繼續操作。

- [ ] **Step 2: 執行可取得的檢查／驗收**

補非空觀察、201來源、250觀察、部分失敗run及多頁草稿fixture，API provider全stub。登入只用授權正常方式；不要把正式Free帳戶改Pro或新增admin。已有auth capture流程只在executor自己的本機測試環境使用並保護gitignored session檔；本次Cloud Browser不匯出session。缺角色或資料只阻擋對應live驗收，其他修復繼續。

- [ ] **Step 3: 執行指定命令**

環境前置條件滿足才執行；讀完整exit code與結果。缺必要存取就受阻，不改成skip成功。

```bash
npm run test:integration -- __tests__/integration/feature-store-tenancy.test.ts __tests__/integration/second-approver.test.ts
npm run e2e:authenticated -- tests/e2e/authenticated/aiso-maintenance.spec.ts
```

- [ ] **Step 4: 核對完成門檻**

authenticated-mobile目前只在授權session檔存在時註冊；需桌面與360/390px時在此spec明設viewport並核對test discovery。gate拒絕/skip不能寫pass。來源撤回及永久刪除只用明確隔離可拋棄資料及所需確認。 已完成登入及Free可用範圍；取得Pro測試角色後驗問題庫、中文語言及可存取操作；第二覆核角色驗核准至交付；隔離新帳戶驗onboarding；A/B及大量資料驗租戶／游標。逐OP記錄實際證據，不以路由可達當功能通過；永久刪除及來源撤回另需特定確認。；核准後不自動啟用來源代理許可；csv與完整來源版本語義分開。

- [ ] **Step 5: 保存紀錄與狀態**

只提交已遮蔽runbook／測試及證據索引；建議commit：`test(uat): verify AISO roles and complete maintenance journeys`。未取得live證據保持待驗收或受阻。

**目前受阻：** Free方案阻擋問題庫；缺獨立覆核者、第二隔離租戶、新帳戶及有觀察／大量資料的測試環境。Google登入已完成。

### T17 · 修復後完整回歸與正式發布驗收

**追蹤：** P1；F01;F02;F03;F04;F05;F06;F07;F08;F09;F10;F11;F12;F13;F14;F15;F16;F17;F18;F19；UC01;UC02;UC03;UC04;UC05;UC06;UC07;UC08;UC09;UC10;UC11;UC12;UC13;UC14;UC15;UC16;UC17;UC18;UC19；來源E01-E20。依賴：T00;T01;T02;T03;T04;T05;T06;T07;T08;T09;T10;T11;T12;T13;T14;T15;T16;T18;T19;T20。批次B4。

**Files:**

- Modify／重用：`.github/workflows/pr-gate.yml`
- Modify／重用：`docs/runbooks/deploy-cron-worker.md`
- Create／擬新增：`docs/runbooks/aiso-remediation-release.md`

**Interfaces:** ReleaseEvidence={candidateSha,previewUrl,migrationManifest,static/unit/integration/e2e/workerResults,remainingBlockers,rollbackTarget,productionSha|null}。全量驗收逐項綁同一candidate SHA，不沿用舊main綠燈。

- [ ] **Step 1: 建立本任務的證據清單**

此任務是發布gate，不以新鏡像測試充數。缺migration、角色UAT、實際job coverage或deploy authorization時維持待驗收/受阻；程式已寫不代表正式完成。

- [ ] **Step 2: 執行可取得的檢查／驗收**

先完成候選branch與draft PR、preview、migration dry-run、rollback及所有可執行證據，再把具體SHA/環境/變更提供使用者批准正式migration、merge、app/worker部署及有限live job。只有明確部署授權後執行。全量release依賴全部T00–T20；可拆獨立UI hotfix發布，必須列清尚未交付範圍。

- [ ] **Step 3: 執行指定命令**

環境前置條件滿足才執行；讀完整exit code與結果。缺必要存取就受阻，不改成skip成功。

```bash
npm run lint
npm run typecheck
REQUIRE_INTEGRATION_TESTS=1 npm test
npm run build
npm --prefix cloudflare/cron-worker run test
npm --prefix cloudflare/cron-worker run typecheck
```

- [ ] **Step 4: 核對完成門檻**

同SHA在preview完成瀏覽器矩陣，授權production後比對alias/SHA、worker版本、DB binding與migration；新掃描、五工具、來源核准及一輪完整Pulse coverage重驗。trial email只到隔離收件箱，Search Console disabled/active明確。不以一次200當週job全完成。 候選單元與隔離整合過關；blocked=0或產品簽收具體例外；授權部署後alias/SHA相符；抽查新報告、五工具和至少一輪實際job成功覆蓋；未達門檻不標已驗證完成。

- [ ] **Step 5: 保存紀錄與狀態**

只提交已遮蔽runbook／測試及證據索引；建議commit：`docs(release): record AISO remediation acceptance and rollback`。未取得live證據保持待驗收或受阻。

## 8. 驗收層級與真實使用情境

以三個層級分開存證：L1為unit/contract/provider stubs；L2為隔離DB＋preview真實持久化與browser；L3為經授權的production同SHA／真實job。L1不能填成L3通過。完整矩陣見AISO_Codex_Verification_Matrix_2026-10-03.csv。

### 用戶情境

| 角色與目標 | 路徑 | 必須核對的結果 |
|---|---|---|
| 新香港品牌用戶 | 掃描→登入回原目的地→onboarding→中文問題→第一份來源 | 診斷不誤導；斷網可resume；沒有重建品牌／試用；新題context正確 |
| 日常內容維護員 | 今日工作→觀察詳情→改善機會→来源版本→私人草稿 | 來源先核准再獨立允許代理；原文與版本可追溯；保存新草稿後舊稿仍在 |
| 獨立覆核同事 | 已提交change-set→approve/request changes→匯出→人工交付記錄 | 提交者不能自批；未核准不可交付；匯出不算已交付；不偽造客戶成效 |
| 維運同事 | run coverage→失敗items→retry→翌日repair→週報 | 15個expected item全可追蹤；bad client不阻塞；跨週仍續原run |
| 大量內容同事 | 201来源分頁→200行CSV預覽→修正錯誤→重試→匯入 | 一次產生完整版本、不重複、不吞已成功行；250觀察有可見候選範圍 |
| 權限與手機使用者 | Free/Pro、tenant A/B、360/390px、keyboard/screenreader | 不越權、不繞過付費gate；可辨控件名稱／狀態，焦點與草稿可恢復 |

### 效能及準確度門檻

新性能目標是本計劃的候選驗收值，**不是聲稱現有SLA或已量得數據**：

- 隔離環境以201來源／250觀察、每頁50列、約定相同網絡量30次；記median與樣本p95，候選目標首屏API p95≤2秒、操作≤1秒出現pending。n=30尾部仍不穩定，報告不能推算全體使用者SLA。
- Source list不帶entries全文；重複翻頁不得重複載入所有source content；觀察detail按需載入。以payload結構及query plan證明改善，不能只以「快咗」描述。
- 初始Pulse route工作deadline45秒、保存餘量至少5秒；慢provider/429/5xx/timeout都有持久狀態，無漏item或失去成功答案。
- AI準確度先把R02/R03錯誤反例變為正確測試，再用120合成案例報每語言／類別的n與混淆矩陣。未做人手覆核的標籤不能宣稱gold set；沒有付費真實模型評測就明示未量度。
- 不為追求速度取消tenant predicate、授權、SSRF fetcher、版本檢查或既有覆核規則。不得做未經控制的正式負載測試。

## 9. 測試命令、CI與版本證據

單項改動執行該T-ID指定suite；不要每改一行重跑整repo。每批合併前跑受影響整合與相關UI。最终candidate只需一次有完整輸出的全量gate，若之後再改程式須補跑受影響gate。

```bash
npm run lint
npm run typecheck
REQUIRE_INTEGRATION_TESTS=1 npm test
npm run build
npm --prefix cloudflare/cron-worker run test
npm --prefix cloudflare/cron-worker run typecheck
```

Worker有自己的package/lockfile，首次執行前於該目錄`npm ci`；根目錄Vitest/lint不涵蓋它。DB integration沿用repo的隔離Neon branch harness，缺neonctl/授權時明確失敗；`npm test`一般模式可能skip integration，所以發布gate用`REQUIRE_INTEGRATION_TESTS=1`。

Browser先驗test discovery，再對明確local/preview target執行。普通CI fixture與真實登入UAT分開；預設不要设置LIVE_SCAN_TARGET向正式站產生付費掃描。

```bash
npm run e2e -- --list
BASE_URL=http://127.0.0.1:3000 START_DEV_SERVER=1 npm run e2e -- --project=chromium --project=mobile
```

真實登入驗收沿現有`npm run e2e:authenticated`，只在授權測試session與正確issuer存在時執行。不能繞過MFA、匯出此會話Cloud Browser的cookie，或把session檔提交git。缺session時記受阻，其他local工作繼續。

每項修復證據存`artifacts/aiso/Txx/`；至少有before、after、candidate SHA、命令與exit code、fixture說明、UI或DB讀回、清理結果。分享用證據包只保留已遮蔽内容；trace也可能有token/原文，未遮蔽不能上傳。

## 10. 正式發布與回退

發布不是本次寫計劃的授權。未來實作者先交付可審閱commit、draft PR、preview結果與migration dry-run，再讓使用者批准具體SHA、目標環境、schema操作及app/worker切換。不要在每一個可還原的本機步驟反覆問。

順序：

1. 核實目標Neon project/branch/role、當前migration ledger、前一READY部署及worker版本；T00未知部分解決。
2. 隔離DB驗新migration及權限；正式expand migration經批准後才執行，保留舊reader可用。
3. 部署相容app，FEATURE_PULSE_ATTEMPTS先不對正式全量開啟；source/UI功能逐項smoke。
4. 以明確授權的測試品牌與費用上限做一輪run，驗expected items、retry、persisted answer、summary與alerts gating。
5. 切換單一producer及worker repair，禁止舊delete-before-insert writer同時運作；觀察至少一輪weekly Pulse及一次daily分支的實際結果。若未等到真實週期，標待驗收，不能寫「所有排程已正常」。
6. 比對alias→app SHA、worker deployment、migration及flag；公開、五工具、角色、跨租戶及job evidence對到同一candidate。

回退：先停新工作接收／producer並保存未完lease/attempt，再回退相容app/UI；保留新表與不可變證據，不做破壞性down migration。新ledger啟用後不能直接重啟舊delete-before-insert Pulse writer；維持排程暫停，使用相容consumer或forward fix恢復。来源核准與歷史actor/time不能因回退被抹去。

如要先發布獨立hotfix，清楚列出只包含的T-ID與未交付項；T17「全量完成」仍須所有依賴通過或有明確簽收例外。

## 11. 現有測試資料、受阻項目與協作方式

原live品牌`ad73afa0-15ad-4790-8a7b-000f7efbec25`已有：

- 私人品牌識別資料：名稱AISO Dev Brand、aliases空白已還原；revision歷史保留。
- 網域驗證challenge與一次token_absent紀錄，仍未驗證；不可把challenge放進公開報告。
- `audit-20261002-source-approval`來源v1：明示AUDIT、未核准、未允許代理使用。
- `c1b45c68-b97f-4e75-a214-b5819b7a1524`私人FAQ草稿revision2：明示AUDIT、未提交審批。

不要為讓驗收綠燈把這些合成內容啟用給代理，也不要自動撤回／刪除。複製最小合成fixture到隔離環境測；正式不可逆操作需要具體確認。

| 缺少內容 | 阻擋的驗收 | 仍可先做 |
|---|---|---|
| Cloudflare已部署設定、DB job摘要、flag/schema證據 | T00、T17正式排程結論 | 所有local程式修復、worker stub與schema測試 |
| Pro測試角色 | 問題庫真實編輯／語言／a11y | T11/T13 fixture與API gate測試 |
| 獨立覆核者及account B | 完整交付與跨tenant UI | store/API隔離測試，不授予正式admin |
| 全新隔離帳戶 | Onboarding真實首用 | seed/network故障fixture及DB resume |
| 非空觀察與大量資料 | 原文詳情、分頁、效能 | 合成201 sources／250 observations／多週fixture |
| 正式部署及有限live job授權 | T17 production | 完成code、draft PR、preview與發布包再提出具體批准項 |

每批結束交接只需：完成／待驗收T-ID、commit SHA、實際命令及結果、證據位置、未解限制、下一批。不要以「已寫程式」「build成功」「PR merged」替代功能與排程證據。

## 12. 第一批直接執行提示與交付清單

將Implementation Pack與啟動指令交給Codex GPT‑6.1 Sol，要求從B0及B1開始並依賴持續推進全計劃。B1順序固定T04→T01→T02→T06→T10，每項完成最小可審閱commit；受阻項留精確證據缺口，繼續獨立項目。

交付包含：

- 本完整計劃Markdown與HTML。
- 21項任務CSV（原欄位、原ID、依賴、角色、估算、驗收與rollback）。
- 26組驗收矩陣（21個任務gate＋5個重要邊界），新candidate狀態不沿用原audit pass。
- 可直接貼入Codex的完整啟動指令。
- 原始證據ZIP、已展開的audit、來源hash與README；歷史v1仍在原包內。

本計劃自查：19 findings均有修復／調查任務；依賴無循環；所有既有路徑對到稽核SHA；新增路徑明示擬新增；local/live分開；F16保持unknown調查；沒有把計劃完成當成網站已修復。
