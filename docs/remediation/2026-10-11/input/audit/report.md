# AISO 正式網站與程式碼審查

2026-10-11 · 香港時間 · 參照 Ansvisor 已登入介面

AISO 已具備掃描、模型回答、問題庫、競爭者、引用來源及私人草稿，但首次成果與日常改善流程仍未接通。最優先的工作是統一新增品牌、顯示部分完成、補足採集背景與可恢復執行，以及統一失敗掃描狀態。新增更多分頁應排在這些修復之後。

本輪提出 **13項發現：5項P1、8項P2**，對應12項可執行任務。這是有明確邊界的程式碼及正式站抽查，沒有宣稱所有功能、角色或按鈕均通過。所有修復目前為 proposed_not_implemented；本輪沒有修改、合併或部署產品程式碼。

## 基準與方法

| 項目 | 本輪確認 |
|---|---|
| AISO repository | YNWAforever/aiso，main `783e54e3fa99f8c14e4cab84a67b42b0b1513c3c` |
| AISO live | https://aiso-kappa.vercel.app/ ，production READY，deployment `dpl_8wUWAwt9GydS7fvhqj7oPU7AqLZR` 的 SHA 與上述一致 |
| AISO登入範圍 | 現有Pro帳戶、一個合成測試品牌、既有觀測與草稿；未建立新正式帳戶或品牌 |
| Ansvisor reference | 已完成Google登入，讀取 Insights、Prompts、回答、Citations、Action Center、Content、Audit、Traffic及Brand設定 |
| Ansvisor code | 本地snapshot `90c30ffb17b3300127385875fca18456b24e3ed0`；未確認與live部署相同，不作版本等同結論 |
| 核查方式 | 登入後直接UI讀取、有限表單預覽後取消、錯誤輸入驗證、近期程式碼追蹤、純合成測試及typecheck |

最近的 #73–84 涵蓋競爭者、SOV、E-E-A-T、grounding、citations、答案長度及app origin。production已包含#84；舊報告或仍開啟PR的描述不被當成現況。尤其無效URL驗證及首頁的API樣本限制已合理，下面只記錄仍可觀察的問題。

## 覆蓋與驗證結果

operations.csv 列出本輪選定的 **41個檢查項目**：**28項有live觀察、4項僅code核查、9項未測**。這是本輪明列檢查項的分母，不是全站所有控件的覆蓋率。讀取頁面成功只代表該次可讀，不能推論寫入或排程成功。

- `npm run typecheck`：通過。
- 3個已閱讀的純合成測試檔：**64/64通過**（share-of-voice、citation-sources、pulse-grounding）。使用CI network guard。
- 完整unit suite未取得通過結果：自動審核因偵測對不受信任host的HTTP存取、未能確認payload是合成或已授權而拒絕。沒有重試整套或繞過；改為上述安全的獨立測試。
- 沒有執行fresh付費模型工作、對外電郵/webhook、CMS發佈、收費操作、production migration或旗標改動。
- 未完成跨tenant/多角色寫入、完整新帳戶閉環、mobile/WCAG、負載測試、完整build/lint；因此本報告不是上線認證或安全認證。

## 優先發現

| ID | 優先 | 發現 | 證據層級 | 任務 |
|---|---|---|---|---|
| F38 | P1 | 兩條新增品牌流程產生不同的設定完成度 | live+code | T03 |
| F39 | P1 | 首次監測沒有清楚的啟動與等候流程 | live+code | T05 |
| F40 | P1 | 部分成功被呈現為沒有可用監測數據 | live+code | T02 |
| F41 | P1 | 相容寫入路徑未保留完整採集背景，且無法修復已有原文的未知分類 | live+code | T04 |
| F42 | P2 | 搜尋請求狀態被標示為已完成即時搜尋 | live+code | T06 |
| F43 | P1 | 失敗掃描在歷史卡片仍顯示分數與評級 | live+code | T01 |
| F44 | P2 | 引用報表先截斷50項，之後才篩選，CSV亦不完整 | live+code | T07 |
| F45 | P2 | 未設定競爭者仍顯示沒有競爭引用缺口 | live+code | T08 |
| F46 | P2 | 品牌選擇和啟用進度未導向首個可用結果 | live+code | T09 |
| F47 | P2 | 問題庫適合逐條修改，但欠缺批次營運與清晰市場背景 | live+code | T10 |
| F48 | P2 | 改善機會重複列出問題×平台，未形成可交付的行動組合 | live+code | T11 |
| F49 | P2 | 網域聚合採有限後綴表，有跨租戶合併風險 | code-only | T12 |
| F50 | P2 | 新增品牌的錯誤恢復及API型別驗證不足 | code-only | T03 |

### F38 — 兩條新增品牌流程產生不同的設定完成度

**P1 · live+code · 證據 E02;E14**

Portfolio 的兩步 AddBrandWizard 只呼叫 clients API，儲存名稱、網域、行業及競爭者；正式四步 onboarding 才會產生24條問題、記錄市場語言及可恢復進度。兩步流程仍提示下次掃描自動開始。

影響：從常用入口新增品牌後可能沒有可執行的問題庫，亦沒有直接導向下一步。行業使用不同詞彙。

根因範圍：`components/dashboard/AddBrandWizard.tsx`、`app/api/dashboard/clients/route.ts`、`lib/onboarding/service.ts`、`lib/onboarding/store.ts`。修復任務：T03。

### F39 — 首次監測沒有清楚的啟動與等候流程

**P1 · live+code · 證據 E03;E05;E14;E17**

所檢視品牌總覽、監測、問題庫未見執行首次監測或局部重試的入口；下一次執行顯示未知。onboarding service 只完成問題種子；daily-work 的 nextDueAt 固定 null；pulse/run 由 cron secret 保護。

影響：新用戶完成設定仍不知道何時可看到第一個結果；有資料時亦無法判斷是否需等待或介入。

根因範圍：`lib/onboarding/service.ts`、`lib/view-models/daily-work.ts`、`app/api/pulse/run/route.ts`、`app/api/cron/pulse/route.ts`。修復任務：T05。

### F40 — 部分成功被呈現為沒有可用監測數據

**P1 · live+code · 證據 E03;E04;E15**

同一週 observations 有40筆、31成功、9未完整分類；監測主頁 KPI 不可用、圖表空白。projectObservedSummary 要求分母完全一致才給 KPI；PulseView 沒有 partial 狀態，亦捨棄 coverage。

影響：31筆可閱讀證據被空白總覽遮蔽，用戶難以分辨未執行、分類未完及實際零提及。

根因範圍：`lib/pulse/observed-summary.ts`、`lib/view-models/pulse.ts`、`lib/workspace/load-owned-pulse.ts`。修復任務：T02。

### F41 — 相容寫入路徑未保留完整採集背景，且無法修復已有原文的未知分類

**P1 · live+code · 證據 E04;E16**

所檢視回答缺實際模型、市場、收集時間等背景。callMultiPlatform 將 evidence 縮成 answer/citations/grounding；相容 writer 未寫採集背景。只傳 prompt.question；有非空 raw_answer 便阻止重寫，即使新一次分類成功。repair cron 只在 attempts flag 啟用時可用。

影響：缺乏可比較背景，重新執行可能花費模型費用卻不能修復原有未分類項目。

根因範圍：`lib/openrouter.ts`、`app/api/pulse/run/route.ts`、`app/api/cron/pulse/route.ts`。修復任務：T04。

### F42 — 搜尋請求狀態被標示為已完成即時搜尋

**P2 · live+code · 證據 E04;E06;E18**

groundingFor 在供應商返回前依平台與 webSearchAllowed 設定 web/native；UI 將 web 顯示為即時網絡搜尋。Gemini 抽樣回答有此標籤，但沒有 provider citations。來源頁另寫 Perplexity 一定會列出來源。

影響：使用者可能把「已要求搜尋」誤解為已驗證搜尋執行及引用完整；沒有引用不等於沒搜尋。

根因範圍：`lib/pulse/grounding.ts`、`lib/openrouter.ts`、`messages/zh-HK.json`。修復任務：T06。

### F43 — 失敗掃描在歷史卡片仍顯示分數與評級

**P1 · live+code · 證據 E01;E10;E19**

首頁 not-a-valid-url 紀錄顯示3.5/100及F；打開同一報告則明示未成功採集、不能提供可靠分數。RecentScans 無成功採集狀態欄位，直接渲染 score/grade。現行表單已正確拒絕此無效網址。

影響：同一結果在列表及詳情互相矛盾，會誤導用戶以失敗採集分數排優先次序。

根因範圍：`components/dashboard/RecentScans.tsx`、`lib/scan-input.ts`。修復任務：T01。

### F44 — 引用報表先截斷50項，之後才篩選，CSV亦不完整

**P2 · live+code · 證據 E06;E20**

buildCitationReport 先把domains及URLs切成TOP50；CitationExplorer 在這個子集上決定可用類型及篩選；CSV只輸出該report.domains。Live 顯示50網域及50URLs，沒有分頁或截斷提示。

影響：排在第51以後的來源不能透過類型篩選找回；匯出可能被誤當完整來源清單。

根因範圍：`lib/citations/report.ts`、`components/dashboard/CitationExplorer.tsx`。修復任務：T07。

### F45 — 未設定競爭者仍顯示沒有競爭引用缺口

**P2 · live+code · 證據 E06;E07;E20**

競爭者0/10；來源頁顯示本週沒有此類問題。缺口偵測依已設定competitor domains，UI沒有未設定或不足以比較狀態。

影響：用戶可能把缺少設定當作已比較而没有差距；只填競爭者名稱亦不足以判斷其網站引用。

根因範圍：`lib/citations/report.ts`、`components/dashboard/CitationExplorer.tsx`、`lib/competitors/store.ts`。修復任務：T08。

### F46 — 品牌選擇和啟用進度未導向首個可用結果

**P2 · live+code · 證據 E01;E03;E08;E21**

Pro 組合頁把需選品牌的流程顯示為Locked；進度2/6下一步是核准來源，只有文字沒有連結。品牌頁與來源頁大量背景說明先於具體下一步。

影響：新手容易把選品牌條件當作付費限制，未看到監測結果便進入來源治理。

根因範圍：`components/dashboard/DashboardSidebar.tsx`、`components/dashboard/ActivationProgress.tsx`、`components/dashboard/PortfolioView.tsx`。修復任務：T09。

### F47 — 問題庫適合逐條修改，但欠缺批次營運與清晰市場背景

**P2 · live+code · 證據 E05;E22**

8/8啟用數重複展示；四組問題全部展開；既有問題為en及未指定市場；未見匯入、多選或批次市場語言編輯，亦沒有每題結果摘要或開始監測入口。

影響：24至50題時維護成本高；香港使用者難以快速確認及修正觀測範圍。

根因範圍：`components/pulse/PromptBankEditor.tsx`、`components/pulse/QuestionBankSection.tsx`。修復任務：T10。

### F48 — 改善機會重複列出問題×平台，未形成可交付的行動組合

**P2 · live+code · 證據 E08;E23**

同一問題的多平台未提及被分成多張相同標題卡。現有草稿可編輯標題、行動、備註及看版本；在所檢視入口未呈現目標頁、負責人、期限或再量度完成條件。

影響：閱讀清單很長，使用者仍需自行合併證據、判斷要改哪一頁，以及如何驗收。

根因範圍：`components/opportunities/OpportunityWorkspace.tsx`。修復任務：T11。

### F49 — 網域聚合採有限後綴表，有跨租戶合併風險

**P2 · code-only · 證據 E24**

registrableDomain 對不在手寫清單的host取最後兩段；例如不同的 *.github.io 會聚合為 github.io。分類按來源host進行，但聚合用registrable domain。

影響：獨立網站可能被合併，影響來源數及分類；本次未量度正式資料受影響筆數。

根因範圍：`lib/citations/normalize.ts`、`lib/citations/report.ts`。修復任務：T12。

### F50 — 新增品牌的錯誤恢復及API型別驗證不足

**P2 · code-only · 證據 E14**

submitStep2 缺 try/catch/finally，網絡reject或非JSON錯誤可令loading停留；API在try外解析JSON，只對brand_name做truthy/string檢查，未trim後再拒絕空白，domain可因非string觸發錯誤。

影響：暫時網絡錯誤會阻礙重試；異常輸入不能稳定返回可修正的欄位錯誤。

根因範圍：`components/dashboard/AddBrandWizard.tsx`、`app/api/dashboard/clients/route.ts`。修復任務：T03。

## 與 Ansvisor 的具體比較

參考的是可見的流程設計，而不是聲稱其模型數據更準確。0品牌提及及0品牌引用只是該次觀測結果，不能視為產品錯誤；沒有流量亦不能推論沒有價值。

| 工作 | AISO本輪現況 | Ansvisor本輪可見參考 | 對AISO的建議 |
|---|---|---|---|
| 瞭解KPI | API樣本限制有說明，但部分資料時總覽空白 | formula說明把mention/citation/position分開，顯示coverage | 先做好明確分母及partial；公式一鍵查看 |
| 管理問題 | 四組逐題開關與編輯；缺批次工具 | 清單有topic、狀態、metrics、runs、last run及bulk Analyze | 建一個可篩選清單，保留逐題編輯 |
| 深入證據 | observation modal原文可讀，metadata不足 | prompt→run→raw answer→source清楚；notes及target URLs | 補採集背景；由引用反查原回答及目標頁 |
| 引用分析 | source type及gap已有；TOP50且篩選維度少 | date/platform/region/topic/prompt及domains/URLs/gaps | 完整pagination與scope一致，先解決長尾遺失 |
| 內容行動 | 同問題各平台分多張泛化卡；私人草稿已有版本 | Content有action/type/impact/status，Action Center有tasks/owner/due | 合併證據成一件具體工作，設定驗收及重測 |
| 技術掃描 | 首頁20項website readiness，失敗詳情清楚 | Audit入口列47signal及剩餘quota | 不比較20與47誰較好；比較證據、可執行修復及失敗處理 |
| 真實成效 | 本輪未驗證流量或轉化閉環 | Traffic要求安裝snippet；現時無traffic | 先驗證追蹤有收數，再談AI引流和轉化；避免把API樣本變動當收入因果 |

Ansvisor的內容cluster source保留群組identity、去重任務並把檢驗放在工作後；這可以作架構參考。但其live版本未與repo核實；未點擊Analyze、Run Audit、Send或發佈，不能將可見按鈕当成功執行證據。

**SOV需要釐清名稱，並非本輪確認的算式錯誤。** AISO的公式是「有提及該品牌的已分類回答／已分類回答」，屬於提及率，說明文案已有定義，各品牌合計可超過100%。Ansvisor公式說明中的SOV用「自身提及／自身加已追蹤競爭者提及」。兩者不能直接比較。建議AISO將前者命名為品牌提及率，若另加真正相對份額則用獨立指標及明確分母；不要直接搬用競品加權visibility分數。

## 建議的新手與日常流程

**新手主路徑：確認品牌／網址 → 確認市場語言與首批問題 → 啟動首次觀測 → 看可用結果與三項行動 → 完成一項改善後重測。**

1. 只保留一套新增品牌流程。網站資訊可先作建議，但品牌身份、香港市場、語言及競爭者由使用者確認；不可單靠品牌名稱推斷。
2. 首批先呈現5–10個可審閱問題，按品牌、比較、購買、問題解決意圖分組；完整24題可稍後開展。這是產品建議，仍需驗證樣本代表性及成本，並不是本次量得的最佳題數。
3. 啟動前顯示問題數×平台數及可用配額；啟動後顯示queued/running/partial/complete/failed，以及已完成數。等待頁可離開及返回；中斷可恢復，不重複收費。
4. 首頁先回答「今天完成多少、有甚麼發現、下一步做甚麼」。局部結果可用但必須標明覆蓋率；不能補0或偽稱完整。
5. 三项優先行動各自附問題、來源證據、建議修改頁、工作內容、預期驗收及下一次重測範圍。優先分數應解釋依據，不能單以技術掃描可回復分數當業務影響。
6. 已核准來源與交付審批保留在需要引用或交付時出現。首次監測不應把來源核准當作唯一下一步。細節限制放於可展開的證據區，主要頁面保留最影響決策的限制。

日常使用：先看執行健康及partial → 檢查真正變動的問題 → 開原回答與引用 → 合併成少量工作 → 記錄完成／發佈 → 用相同問題、市場、語言、平台及時間窗重測。重測仍屬觀測；沒有對照設計不能保證改善造成曝光上升。

## 修復順序與發布驗收

1. **先修顯示可信度**：T01失敗分數、T02部分結果、T06搜尋狀態、T08競爭者空狀態。這些可在不改動原始證據的情況下改善。
2. **再接通第一個成果**：T03統一建立 → T04採集與分類恢复 → T05首次工作及排程 → T09啟用導覽。不要只加Run按鈕卻仍走會丟背景的相容writer。
3. **最後提升日常產能**：T07完整來源、T12網域正規化、T10批次問題、T11合併行動及驗收。

tasks.csv 已列依賴、範圍、負責角色、粗估工作量、驗收、案例、證據、環境與回退。估算是規劃區間，不是承諾；沒有新增免費或付費排程。production flags、Worker實際部署及migration狀態需另以授權的operational evidence確認。

發布前至少完成UC01–UC09及UC13；含引用聚合／批次／行動的版本再加UC10–UC12。尤其要有新帳戶、已有品牌、部分provider失敗、unknown分類、重複點擊、網絡中斷、無競爭者及失敗掃描的完整案例。所有對外發佈與寄送仍由使用者明確觸發。

## 包內文件

- report.md：本報告。
- findings.csv：13項發現及code範圍。
- tasks.csv：12項修復任務、依賴、驗收及目前未實作狀態。
- operations.csv：41項本輪檢查及未測範圍。
- user-cases.md：13個修復驗收案例。
- evidence/manifest.json：可追溯的UI文字摘要及code檔案。
- evidence/verification.json：部署基準、typecheck、focused tests及完整suite限制。

沒有將客戶回答原文、登入秘密、追蹤識別碼或瀏覽器截圖存入交付。現有正式資料亦未被修改。
