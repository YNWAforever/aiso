# 給 Codex GPT-6.1 Sol 的執行提示

將本檔內容連同整個交接包提供給使用者指定的 Codex GPT-6.1 Sol。這是後續實作提示；產出此包的工作階段只完成計劃。

---

請根據 `docs/superpowers/plans/2026-10-13-aiso-development-plan.md` 繼續開發 AISO。

- Repo：[YNWAforever/aiso](https://github.com/YNWAforever/aiso)
- Live：[aiso-kappa.vercel.app](https://aiso-kappa.vercel.app/)
- 來源：`source/AISO-Audit-2026-10-12.zip`；解壓內容在 `docs/remediation/2026-10-12/source/`。
- 任務：`docs/remediation/2026-10-13/development-tasks.csv`。
- 新增測試：`docs/remediation/2026-10-13/additional-use-cases.csv`；原40案保持不變。

先讀完整計劃、原稽核報告、原任務／測試CSV、RED重現、repo的AGENTS.md及CLAUDE.md。使用網站稽核執行技能保持 finding→case→task→acceptance→evidence 的追蹤。使用 executing-plans 順序執行；沒有另行授權時不派遣子代理。

目標是完成首個品牌的低操作量流程，以及指定Super Admin的九類業務目錄。延伸現有架構及已寫功能；AI只提供可核對及可編輯草稿。不要新增通用聊天機器人、任意SQL console或繞過權限的管理入口。

**開始次序：**

1. T30核對當前main／PR90–92／deployment；保留工作區改動，使用隔離branch。稽核的SHA是历史證據，不是當前版本命令。
2. 立即做T25監測停用原因調查，記錄已證實及未知事項。
3. T20/T21/T22：修59.97/D被顯示60.0/D、小數區間、63.5/D錯fixture；真component與scorer測試必須通過。
4. T23：整合尚未合併的PR90/92，測drawer、safe-save、404/500及200%文字；候選存取受阻仍完成本機部分。
5. T24：CSV逐列修正指引、有效／重複／無效分開計數；有錯全批禁止套用，保留idempotency及版本衝突。
6. T29/T32/T28/T31/T33/T35：保留draft恢復、可審閱AI來源、安全建立一個品牌、監測可用性、主要下一步及最小量測。
7. T27先用隔離fixtures完成九類Admin功能；T26指定AISO身份後才做相應hosted正向驗收。
8. T34跨租戶與未知結果測試；T36組合CI、受控canary及release packet。

每個程式碼任務先用行為測試證明問題，再做最小修復、跑針對測試及lint/typecheck、更新證據、做聚焦commit。當前分支已有修復就驗證，不重寫。修改同檔案的任務順序執行，保留別人的工作。

重要契約：

- score/grade真實一致；不改grade去配合錯誤四捨五入。
- 語言／市場明確確認；AI輸入不可信；沿用SSRF安全fetch；無來源欄位留待補充。
- 同intent重試只建立一brand／一批更改／一run；unknown outcome先對賬，不新建intent盲重試。
- tenant SQL一律account_id scoping；Admin跨帳戶查詢必須經server guard；秘密不屬於「所有資料」目錄。
- 不把unknown當0、未分類當未提及、schema columns存在當全產品ready。
- 原測試2項RED、blocked與not-tested保留歷史。新20案起始全部not-tested；沒有執行就不要填pass。

外部操作邊界：本交接包不額外授權production寫入、grant、migration、provider費用、merge/deploy或cron啟用。先查看目前session已有適用授權；若沒有，完成具體候選、dry-run及操作清單後才處理該項授權。不要因單一blocker停掉其他本機工作。

先前Vercel預覽登入及production onboarding/readiness POST曾被自動審批拒絕。不得改通道、移除保護或借另一帳戶绕過；保留blocked，待相應授權可用。063–070不重跑；先核對ledger。不要從其他產品沿用Admin身份。

provider運輸canary與AI品質評估是兩個不同範圍：前者沿用runbook的專用限時USD1硬上限及5 answers＋5 classifiers；後者5網站×2次另需獨立預算。超額、無費用回報或未知結果即停止下一付費請求。

完成後交付：

1. 聚焦commits／可審查PR，清楚說明問題、改動及行為。
2. 本輪每個task/case的結果、候選SHA/tree、環境、證據及清理結果。
3. 同版本CI及hosted驗收的分母；失敗、skip、blocked分開列。
4. 尚欠身份／存取／費用／部署的具體操作清單，以及相容rollback。

沒有正式部署及live驗收證據時，結論只能是「候選已完成／待發布或驗收」，不可聲稱正式站已修好。
