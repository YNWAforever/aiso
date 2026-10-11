# 使用者案例及驗收

以下是修復後的驗收規格，不代表本輪已完整執行。Live 實際覆蓋見 operations.csv。

| ID | 情境 | 預期完成條件 | 本輪狀態 |
|---|---|---|---|
| UC01 | 香港新用戶第一次設定品牌 | 確認品牌、網域、香港市場、語言、問題及競爭者，啟動一次可見的監測工作；可返回繼續 | 正式入口及code已看；建立到首次run未測 |
| UC02 | Pro用戶新增第二品牌 | 與首次設定使用同一資料驗證及種子邏輯；完成即進新品牌下一步 | live兩步表單至取消；未提交 |
| UC03 | 40項觀測，31分類完成、9未完成 | 顯示31/40及partial；原文可閱讀；未完項有原因/重試；0提及只來自明確negative | live部分狀態已重現 |
| UC04 | 已有raw answer但classification unknown | 只重跑分類；不重付採集費；不覆寫原文；可追溯每次attempt | code-only；production旗標未知 |
| UC05 | 無效網址與歷史失敗掃描 | 表單拒絕；所有卡片、詳情及匯出統一顯示失敗而非F或0分 | 表單/詳情pass；卡片fail |
| UC06 | 要求web search但無provider citation | 清楚顯示requested而非confirmed；無記錄與empty分開 | live標籤及code已核對 |
| UC07 | 60網域、長尾第51項為review | 完整總數；review篩選找到長尾；CSV可匯出完整scope；可回原回答 | 限制code確認；production長尾數量未獨立量度 |
| UC08 | 0競爭者或只有名稱無網域 | 尚未設定、不足以比較，提示加入網域；不說沒有gap | 0競爭者live重現 |
| UC09 | Pro從portfolio進品牌工具 | 先選品牌有明確CTA；不顯示方案鎖；啟用next step可点 | live重現 |
| UC10 | 香港營運人員管理24至50題 | 可批次確認市場語言、啟停、匯入；每題連結果；變更前確認scope | 8題live；較大清單未測 |
| UC11 | 同一問題在5平台未提及 | 一件行動附5個證據、目標頁、owner/due及可量度完成條件 | live重複候選及既有草稿已看 |
| UC12 | 不同租戶在同一hosting suffix | 各自來源身份分開；不得污染owned/competitor分類 | code-only |
| UC13 | 建品牌時斷線、非JSON500或重複點擊 | loading解除、可恢復、明確欄位錯誤、只建立一品牌 | code-only |
