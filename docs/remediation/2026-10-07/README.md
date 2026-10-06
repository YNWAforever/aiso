# AISO Codex 執行包 — 2026-10-07

把本 ZIP 交給 Codex GPT-6.1 Sol，貼上 `AISO-Codex-kickoff-prompt-2026-10-07.txt`，即可從 B0 開始。

包含完整計劃、24 項任務執行表、36 項驗收矩陣，以及原封不動的 `input/AISO-audit-evidence-2026-10-07.zip`。技術計劃及啟動提示用英文，原有任務及稽核證據保留繁體中文。

第一批：沿用 PR #68；確認現有依賴修復；補 T21 核准里程碑、T23 GEO provider 失敗及假分數；驗收 T22 Auth 修復。之後完成 onboarding、五工具、每日/每週 job、角色與發布驗收。

本包只是實作計劃，沒有修改網站、重新跑產品測試或重新驗證 production。稽核狀態保留：19 待驗收、3 受阻、2 待開始。所有新 execution 欄位為未執行。原 AC01–AC26 的歷史欄位原樣保留；執行時使用新的 execution_commands 欄位，特別注意跨租戶測試需專用 wrapper。

原 ZIP SHA-256：`c5ba2f07aee65f1eb72fe4486d92205ab496302f24b7f4382e0540133141189d`。

解壓原 ZIP 後，參考根目錄為 `input/evidence/AISO-reaudit-2026-10-07/`。`SHA256SUMS` 對應本執行包檔案。版本或權限有差異時記錄 blocker 並繼續獨立工作；不要把歷史通過當成新版本驗收。
