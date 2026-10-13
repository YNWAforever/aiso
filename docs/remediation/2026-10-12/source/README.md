# 使用方法
1. 先讀 AISO-Audit-2026-10-12.md。
2. 用 AISO-Use-Cases-2026-10-12.csv 執行／覆核40個案例；不要把blocked當pass。
3. AISO-Remediation-Tasks-2026-10-12.csv 列10項依賴有序工作。
4. evidence-index.csv 與 operation-inventory.csv 串起證據及操作。
5. synthetic-*.csv 只供預覽或隔離環境；不應直接套用正式資料。
6. repro/audit-score-boundary.test.tsx 是2項預期失敗的精度重現（PR92 03c7b806）。
7. evidence/ 保存下載CI摘要、匿名GET及本機測試結果；不含session、token、私有回答全文或瀏覽器截圖。
8. evidence-checksums.json 記錄各檔sha256，便於驗收核對。

本次未修改或發布產品程式碼。既有GitHub測試全綠與新增audit重現失敗並存，沒有抹除失敗。

