# AISO 最新開發稽核與使用案例
日期：2026-10-12（Asia/Hong_Kong）。使用「網站稽核執行」；增量稽核，集中最新開發及先前失敗的主流程。

## 結論
品牌組合、觀察列表及 CSV 預覽已能讀取。AI 入門轉人工、重新載入及返回步驟能保留網址、語言及市場。**首次監測仍停用；AI 問題建議面板仍有鍵盤障礙；Super Admin 正向驗收尚欠已授權管理員。**

PR #92 最終 CI 全綠，但本輪額外中英文重現測試發現 **59.97/D 顯示為 60.0/D**，建議修正後再合併。這次只稽核及建立測試案例，沒有修改產品程式碼、合併／發布、開通 Admin、migration、啟動監測或發送郵件。

## 1. 版本基準

| 面向 | 本輪核實 |
|---|---|
| main／正式網站 | a7ab604e4b49a85e080e9cf447d2785c52b39968（PR91 merge） |
| 網站 | https://aiso-kappa.vercel.app ，根網址本輪導向 /zh-HK |
| 正式 deployment | dpl_84bNqzMXQm9s4dY4w4N3GtSoZDWq，READY；收尾再次核對同 SHA |
| PR90 | Open／draft，ee9a457a26b274fd099616a325817c70f709a833；問題建議面板修復未部署 |
| PR91 | Merged；request OIDC 限同部署匿名 Auth 自呼叫 |
| PR92 | Open／non-draft，03c7b806facfde73d20792f7ac2c121a72c9c18c；27檔改動 |
| PR92 CI merge | 399b35ff372ff4e1064fd1aa2dc31072b9236771 |
| 候選／CI tree | 均為1707abd9acd0c00b824014141562e5a4edf21128，Git已核對 |
| PR92 Preview | dpl_EYPgbwPoFbLXRVZRAuK5gcAuEnf4，READY；實際操作在Vercel登入交界受阻 |

來源：[PR90](https://github.com/YNWAforever/aiso/pull/90)、[PR91](https://github.com/YNWAforever/aiso/pull/91)、[PR92](https://github.com/YNWAforever/aiso/pull/92)、[CI](https://github.com/YNWAforever/aiso/actions/runs/38269270215)。

PR89最新討論表示063–070已執行，與repo舊progress.md「through062」快照不同。本輪沒有重查正式DB ledger及私人release receipts；**不再把舊through062當現況，也不因此關閉完整production acceptance**。本輪獨立證實部分資料讀取恢復；監測停用的確切條件仍待核實。

## 2. 覆蓋分母

建立40個案例 UC20–UC59：22 pass、7 fail、9 blocked、2 not-tested。詳見CSV，逐案列出角色、路由、資料、步驟、預期、實際、環境、證據及清理。

其中24案是本輪正式UI／HTTP／唯讀CSV預覽：**19 pass、5 fail**。另2個本機／規則失敗案例，2個本輪CI／本機通過案例，以及1個沿用PR90歷史CI的通過案例。Blocked與not-tested不算通過。

候選路由inventory：54個page.tsx、93個route.ts。只選了40個風險導向使用案例；不是全部路由、按鈕、角色或所有安全邊界的完整驗證。operation-inventory.csv的分母也只是這40案。

| 流程 | 本輪範圍 |
|---|---|
| 公開端 | 根路由、無效掃描、個人化、雙語範例、導覽Escape、定價、規劃中能力、404 |
| 日常工作 | 品牌組合→概覽→監測狀態→40觀察→9未知篩選→回答證據→問題庫→CSV預覽 |
| 支援 | AI轉人工、reload／返回恢復、租戶Admin拒絕、匿名GET邊界 |
| 最新功能 | PR91 OIDC、PR90面板、PR92分數／評級／公開頁及測試缺口 |

本輪瀏覽器桌面實測；手機、dark/light及多寬度證據來自CI fixtures，沒有當成正式手機實測。沿用有效一般Pro租戶session，沒有指定其為Admin。沒有新品牌建立、AI生成、CSV套用、跨租戶正式寫入、Admin正向操作、付款、CMS發布、排程或provider費用測量。

## 3. Findings與舊問題覆核

| ID | 優先 | 事實、影響及狀態 | 證據 |
|---|---|---|---|
| F51 | P1 | 首次監測停用；8×5=40及剩餘1500額度可讀。操作阻礙verified live，可能是刻意發布門檻，根因待核，不能猜為migration錯誤。 | E11 |
| F55 | P2 | AI→人工、第三步reload、返回第一步的背景保留通過。只有這些子項verified live；真AI timeout未執行。 | E10 |
| F56/F57 | P1 | Admin九視圖／診斷程式碼存在；一般租戶被拒、匿名管理API401；欠已授權Admin正向驗收，受阻。 | E08/E09/E20 |
| F58 | P2 | 面板打開後焦點留背景；Tab到CSV；Escape無效；關閉鈕無名。PR90修復未部署。verified live fail。 | E13/E21 |
| F59 | P1 | Preview READY不等於功能可用；本輪登入審批阻擋，未取得新runtime500證據，不沿用舊cookie-secret根因。 | E22 |
| F60 | P2 | 正式首頁74/B+，但assignGrade(74)=B。PR92已有修復，code-only，待發布驗收。 | E02/E04 |
| F61 | P2 | 新ScoreReveal toFixed(1)把59.97/D顯示成60.0/D，越過另一評級門檻。verified local-component，新發現。 | E15 |
| F62 | P2 | 新評級說明50–59、60–69等漏掉59.5、69.5等小數尾段；scorer正確給D/C/B/A。code-only＋函數核實。 | E16 |
| F63 | P2 | 正式zh-HK未知路由是英文預設404、無恢復連結、舊AEO標題。PR92新增頁尚待hosted驗收。 | E07 |
| F64 | P2 | E2E fixture為63.5/D（應C）；原ScoreReveal測試只測73整數。CI綠灯不保證分數語義一致。code-only。 | E24 |
| F65 | P2 | CSV顯示market/category及機器錯誤碼；重複列仍計入2修改／10啟用投影，雖儲存正確停用。SME難自助修正。verified live UX問題，沒有重複寫入證據。 | E14 |

PR92作者另報pricing在375px／200%文字約23px溢出；本輪未獨立重現，UC57保留not-tested，不當新verified finding。新500 boundary也未注入驗證。

## 4. 可執行重現：分數門檻

repro/audit-score-boundary.test.tsx使用真正calculateScore、calculateGeoScore、assignGrade及ScoreReveal，只mock locale。合成Core/Extended=44、GEO=15.97，合計59.97，評級D；render卻顯示60.0/100。EN與zh-HK兩項斷言均失敗。

在PR92指定SHA的乾淨checkout，把檔案放入__tests__/components/，執行：
`npx vitest run __tests__/components/audit-score-boundary.test.tsx`

**目前預期RED**；失敗JSON在evidence。稽核checkout已恢復乾淨，產品未修正。
建議保留契約允許兩位小數並去無用尾零（59.97、63.5、74）；畫面／分享／匯出一致，不為四捨五入顯示改儲存評級。區間用「70 ≤ score < 80」。測49.97、59.97、69.97、79.97、89.97及整數門檻。

## 5. 測試證據

| 驗證 | 結果 |
|---|---|
| PR92 unit-contract | 5,977 pass／0 skip，原始summary已下載 |
| PR92 E2E/accessibility | 958 pass＝240+240+239+239；0 unexpected／skip／flaky，分片JSON已核對 |
| PR92 disposable integration | 419 pass／0 skip，同399b35ff |
| Static、build、Worker | CI成功 |
| Aggregate gate | 6 required groups pass；run38269270215 completed/success |
| 本輪選定測試 | 7檔118 pass：OIDC、原ScoreReveal、catalogue、AI draft、Admin guard/store |
| 本輪新增重現 | 2 fail／0 pass，F61的有效失敗證據 |
| PR90歷史CI | 5993 unit、994 browser、419 integration pass；36新增面板案例，尚未部署 |

PR92的958與PR90的994是不同分支，並非刪除了36測試；合併兩項改動後仍需組合CI及正式驗收。CI fixtures不能證明real-provider品質、付款或production SQL流程。

## 6. 場景與AI降低操作量

**首個品牌：** 網站＋語言＋市場→AI草稿及來源／日期→編輯→明確確認→一個品牌及起始問題→下一個可執行工作。AI失敗立即人工接手，保留輸入／焦點。本輪只測確認前，不聲稱品牌成功建立。UC48驗同intent重送及遺失回應只建立一品牌；UC53用5網站×2次，人工逐句核來源，記錄模型、延遲、費用及錯誤，不能用文字流暢當正確。

**日常維護：** 品牌概覽→未完整回答→保留原文→來源覆核→私人草稿→人工核准→交付。已驗到原文及CSV預覽；沒有批准或發布。40=31+9且篩選後9；未知沒有當作未提及。

**Super Admin：** 九視圖users/accounts/brands/scans/prompts/observations/runs/sources/work，page size25、帳戶filter及搜尋。owner指定身份後，在隔離兩帳戶26+記錄驗正向、分頁、空白、錯誤重試、一般租戶403、匿名401、不顯示secret、schema三態不冒稱完整就緒。無需匯出全正式用戶資料作證據。

**CSV：** synthetic-invalid-market.csv的hk故意無效；synthetic-mixed.csv改HK並含重複與錯誤分類。先前測試輸入的hk問題和產品行為分開記錄。兩次都只preview；儲存停用，reload仍8/8。建議模板／合法代碼例子、中文逐列原因、可套用／重複／無效分開計數。

## 7. 效能與限制

匿名HTTP每端點n=1，經本執行環境端到端約6.2–9.9秒，包括代理、連線或冷啟動；不能當origin latency、p95或Core Web Vitals。各UC未作可靠計時，CSV已明示。沒有本輪AI幻覺率、成本或生成成功率。

未查正式DB全量指紋；8題不變由未套用＋reload支持，不等於所有資料絕對未變。既有回答原文只在瀏覽器內核對，没有匯出全文、個人資料、cookie或密鑰。

受阻：
- PR92 Preview跳往Vercel登入被自動審批拒絕，因未批准該帳戶頁面存取。未繞過、未改保護。
- 正式站匿名POST onboarding/readiness負向測試被自動審批拒絕，因可能寫入或產生AI費用；未重試／改通道執行。保留production結果未知，以本機測試完成可做部分。
- Admin正向、two-tenant writes、paid-provider、first-brand commit及完整監測仍需相应身份／隔離環境／明確執行範圍。
- 完整Google/magic-link新登入未測；沿用session不是新登入成功證據。

## 8. 首批修復次序

1. T20/T21修F61精度與F62小數區間；T22修fixture、補真元件邊界斷言。
2. T23驗PR92新404/500及pricing200%，再準備與PR90組合候選；依既有發布授權流程處理，發布後重測F58/F60/F63。
3. T24改善CSV中文錯誤／有效計數，保持權限與原子套用。
4. T25核對監測停用根因及release gate，完成已批准隔離canary後才考慮啟用。
5. T26/T27取得指定AISO Admin後驗九視圖及診斷；T28完成AI品質與第一品牌端到端。

任務CSV有依賴、角色、難度、驗收、回退、狀態及blocker。交予實作者：先讀AGENTS.md、CLAUDE.md及Next本地指南，重新核對SHA；按依賴做事；保留RED；逐案更新actual/result/evidence；不要把本稽核當作migration、admin grant、paid-provider或merge/deploy授權。

