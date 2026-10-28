# Concept strings → conversationStudio i18n proposal

**設計示例，非產品數據 / design mock — not product data**

Source: [inner snapshot](concept-inner.html), its `templates`, render functions
and sidebar markup; copy priorities and honesty lines also come from the design
gap plan §3.4 dated 2026-10-29 HKT. This is a documentation proposal. Neither
[messages/zh-HK.json](../../../messages/zh-HK.json) nor
[messages/en.json](../../../messages/en.json) is edited here.

Every key below has the full `conversationStudio.` prefix. **Existing** means
that leaf already exists in both catalogs at base `0766bdf6`; it does not mean
that its present value equals the concept. **New** means a proposed leaf in that
same namespace. Existing `templates.{brief,competitors,pulse,report}.{label,prompt}`
names are retained; concept `monitor` maps to catalog `pulse`. Concept
`opportunity` and `improve` would add two template entries. Descriptions and
outcome chains would be new leaves. This naming proposal does not change the
existing template union or promise capabilities beyond saved evidence.

The Chinese column preserves written concept wording (甚麼／這個／還有), with
no Cantonese slang rewrite. English is draft copy. Decorative arrow icons are
not text. Product behavior must substantiate task/outcome wording; unsupported
work remains explicit. Sample-specific prompts, inspector values and controls
are reference copy only and require real context or a disabled/held action.

## Hero, composer and continuing work

| Concept wording | Suggested zh-HK key | English draft | Key at base |
| --- | --- | --- | --- |
| YOUR BRAND WORKSPACE | `conversationStudio.heroEyebrow` | YOUR BRAND WORKSPACE | New |
| 今日想為品牌完成甚麼？ | `conversationStudio.heroTitle` | What would you like to accomplish for your brand today? | New |
| 直接問，或選一個範本。把研究變成下一份有來源、可以交付的成果。 | `conversationStudio.description` | Ask directly, or choose a template. Turn research into your next sourced, deliverable result. | Existing |
| 你的工作目標 | `conversationStudio.composerLabel` | Your work goal | Existing |
| 例如：香港客人買這類產品前，還有哪些問題未被回答？ | `conversationStudio.composerPlaceholder` | For example: What questions do Hong Kong customers still need answered before buying this kind of product? | Existing |
| 開始討論 | `conversationStudio.send` | Start discussion | Existing |
| 選文件 | `conversationStudio.chooseDocuments` | Choose documents | New |
| 香港 · 繁中 | `conversationStudio.localeBadge` | Hong Kong · Traditional Chinese | New |
| 繼續這個討論 | `conversationStudio.followUpLabel` | Continue this discussion | New |
| 繼續追問，或把選定內容另開討論… | `conversationStudio.followUpPlaceholder` | Ask a follow-up, or start a new discussion with selected content… | New |
| 送出示例 | `conversationStudio.mock.followUpSend` | Send example | New |
| AISO 已保存資料 | `conversationStudio.savedDataLabel` | Data saved in AISO | New |
| Search Console · 示例已綁定 | `conversationStudio.mock.searchConsoleBinding` | Search Console · Example binding | New |
| 管理資料連接 | `conversationStudio.manageConnections` | Manage data connections | New |
| 從一個任務開始 | `conversationStudio.templatesTitle` | Start with a task | Existing |
| 每個範本都有明確成果 | `conversationStudio.templatesDescription` | Every template has a clear outcome | New |
| 繼續工作 | `conversationStudio.continueTitle` | Continue working | New |
| 所有討論 | `conversationStudio.allThreads` | All discussions | New |
| 這個品牌未有討論。從上方的工作目標開始。 | `conversationStudio.threadsEmpty` | This brand has no discussions yet. Start with a work goal above. | Existing |

## Category filters

| Concept wording | Suggested zh-HK key | English draft | Key at base |
| --- | --- | --- | --- |
| 全部 | `conversationStudio.filters.all` | All | New |
| 發現機會 | `conversationStudio.filters.discover` | Discover opportunities | New |
| 改善內容 | `conversationStudio.filters.improve` | Improve content | New |
| 觀察成效 | `conversationStudio.filters.monitor` | Monitor performance | New |
| 交付報告 | `conversationStudio.filters.report` | Deliver reports | New |

## Six templates (title, description, outcome and prompt)

| Concept wording | Suggested zh-HK key | English draft | Key at base |
| --- | --- | --- | --- |
| 找出香港內容機會 | `conversationStudio.templates.opportunity.label` | Find Hong Kong content opportunities | New |
| 找出未答好的購買問題，決定先改哪幾頁。 | `conversationStudio.templates.opportunity.description` | Find unanswered buying questions and decide which pages to improve first. | New |
| 機會清單 → 內容 brief | `conversationStudio.templates.opportunity.output` | Opportunity list → Content brief | New |
| 針對香港想買空氣清新機的人，我們有甚麼問題未答好？應該先改哪幾頁？ | `conversationStudio.templates.opportunity.prompt` | For people in Hong Kong buying an air purifier, which questions have we not answered well? Which pages should we improve first? | New |
| 改善一個現有頁面 | `conversationStudio.templates.improve.label` | Improve an existing page | New |
| 由頁面和證據開始，整理可以交付的修改建議。 | `conversationStudio.templates.improve.description` | Start with a page and evidence to prepare actionable changes. | New |
| 修改清單 → 工作項目 | `conversationStudio.templates.improve.output` | Change list → Work item | New |
| 幫我檢查產品比較頁，有甚麼內容需要補充？ | `conversationStudio.templates.improve.prompt` | Check our product comparison page. What content needs to be added? | New |
| 建立有來源的 brief | `conversationStudio.templates.brief.label` | Create a sourced brief | Existing |
| 結合品牌文件、內容缺口及真實來源。 | `conversationStudio.templates.brief.description` | Combine brand documents, content gaps and real sources. | New |
| brief → 待審版本 | `conversationStudio.templates.brief.output` | Brief → Version for review | New |
| 請根據產品資料與已核准事實，建立香港小型住宅選購指南 brief。 | `conversationStudio.templates.brief.prompt` | Using product information and approved facts, create a buying-guide brief for small Hong Kong homes. | Existing |
| 比較競爭對手的內容 | `conversationStudio.templates.competitors.label` | Compare competitor content | Existing |
| 看他們回答了甚麼，保留頁面與引用證據。 | `conversationStudio.templates.competitors.description` | See what they answer, retaining pages and citation evidence. | New |
| 內容差距 → 機會 | `conversationStudio.templates.competitors.output` | Content gaps → Opportunities | New |
| 比較我們和競爭對手對小型住宅空氣清新機的回答。 | `conversationStudio.templates.competitors.prompt` | Compare how we and our competitors answer questions about air purifiers for small homes. | Existing |
| 解釋本週能見度變化 | `conversationStudio.templates.pulse.label` | Explain this week’s visibility changes | Existing |
| 查看已保存的觀察、引用及未完成的測試。 | `conversationStudio.templates.pulse.description` | Review saved observations, citations and incomplete tests. | New |
| 觀察解讀 → 下一步 | `conversationStudio.templates.pulse.output` | Observation analysis → Next steps | New |
| 根據已保存的 Pulse 觀察，本週有甚麼改變？ | `conversationStudio.templates.pulse.prompt` | Based on saved Pulse observations, what changed this week? | Existing |
| 整理客戶報告 | `conversationStudio.templates.report.label` | Prepare a client report | Existing |
| 將研究、修改及結果整理成可審閱的版本。 | `conversationStudio.templates.report.description` | Turn research, changes and results into a version for review. | New |
| 報告草稿 → 審閱 | `conversationStudio.templates.report.output` | Report draft → Review | New |
| 把本月內容工作整理成一份有來源的客戶報告草稿。 | `conversationStudio.templates.report.prompt` | Organise this month’s content work into a sourced client report draft. | Existing |

## Navigation, sidebar chrome and view headings

| Concept wording | Suggested zh-HK key | English draft | Key at base |
| --- | --- | --- | --- |
| 開始工作 | `conversationStudio.title` | Start work | Existing |
| 討論串 | `conversationStudio.threadsTitle` | Discussions | Existing |
| 討論 | `conversationStudio.discussionTitle` | Discussion | New |
| 文件與成果 | `conversationStudio.nav.documents` | Documents & outputs | New |
| 資料連接 | `conversationStudio.nav.connections` | Data connections | New |
| 全部 AISO 工具 | `conversationStudio.nav.tools` | All AISO tools | New |
| 目前品牌 | `conversationStudio.brandLabel` | Current brand | New |
| 開始新討論 | `conversationStudio.newThread` | Start a new discussion | Existing |
| 最近討論 · 私人 | `conversationStudio.recentThreadsTitle` | Recent discussions · Private | New |
| 品牌範圍內工作 | `conversationStudio.sidebarScope` | Work within this brand | New |
| 討論 → 證據 → 可審閱成果 | `conversationStudio.sidebarFlow` | Discussion → Evidence → Reviewable outputs | New |
| 香港 · 繁體中文 | `conversationStudio.localeLabel` | Hong Kong · Traditional Chinese | New |
| 開啟導航 | `conversationStudio.openNavigation` | Open navigation | New |
| 品牌工作室導航 | `conversationStudio.sidebarLabel` | Brand workspace navigation | New |
| 主要功能 | `conversationStudio.mainNavigationLabel` | Main features | New |
| 這個品牌未有討論 | `conversationStudio.recentThreadsEmpty` | This brand has no discussions yet | New |
| 設計概念 · 全部為示例資料 | `conversationStudio.mock.designBadge` | Design concept · All data is illustrative | New |
| 每件工作，各有脈絡 | `conversationStudio.views.threads.title` | Every task has its own context | New |
| 討論只屬於目前品牌。核准成果可另行分享。 | `conversationStudio.mock.threadsDescription` | Discussions belong to the current brand. Approved outputs can be shared separately. | New |
| 資料與成果，都找得到 | `conversationStudio.views.documents.title` | Find your data and outputs in one place | New |
| 輸入資料有版本，交付成果有自己的審閱流程。 | `conversationStudio.views.documents.description` | Inputs are versioned; deliverables have their own review process. | New |
| 讓答案有資料依據 | `conversationStudio.views.connections.title` | Give answers a basis in data | New |
| 每個連接都有範圍、擁有人與資料日期。以下為示例狀態。 | `conversationStudio.mock.connectionsDescription` | Every connection has a scope, owner and data date. The states below are examples. | New |
| 原有功能，繼續直接使用 | `conversationStudio.views.tools.title` | Keep using the existing tools directly | New |
| 對話協助開始與解讀；專業操作保留在原有工作畫面。 | `conversationStudio.views.tools.description` | Conversations help you get started and interpret results; specialist work stays in the existing tools. | New |

## Discussion, evidence inspector and connector labels

| Concept wording | Suggested zh-HK key | English draft | Key at base |
| --- | --- | --- | --- |
| AISO · 示範回答 | `conversationStudio.mock.answerLabel` | AISO · Example answer | New |
| 研究步驟 · 示例流程 | `conversationStudio.mock.stepsTitle` | Research steps · Example flow | New |
| 查看證據 | `conversationStudio.evidence.open` | View evidence | New |
| 另開 brief 討論 | `conversationStudio.branchBrief` | Start a separate brief discussion | New |
| 保存為工作項目草稿 | `conversationStudio.saveWorkItemDraft` | Save as a work item draft | New |
| 來源詳情 | `conversationStudio.evidence.sourceDetails` | Source details | New |
| 證據詳情 | `conversationStudio.evidence.inspectorLabel` | Evidence details | New |
| 本次證據 | `conversationStudio.evidence.panelTitle` | Evidence for this discussion | Existing |
| 關閉 | `conversationStudio.evidence.close` | Close | New |
| 品牌文件 | `conversationStudio.evidence.brandDocuments` | Brand documents | New |
| Search Console | `conversationStudio.evidence.searchConsole` | Search Console | New |
| DataForSEO | `conversationStudio.evidence.dataForSeo` | DataForSEO | New |
| Firecrawl | `conversationStudio.evidence.firecrawl` | Firecrawl | New |
| AI 引用 | `conversationStudio.evidence.aiCitations` | AI citations | New |
| 示例結構；沒有執行外部查詢。 | `conversationStudio.mock.inspectorDescription` | Example structure; no external queries were run. | New |
| 已選版本 · 示例核准狀態 | `conversationStudio.mock.documentVersion` | Selected version · Example approval state | New |
| 所選 property 的香港篩選 | `conversationStudio.evidence.propertyScope` | Hong Kong filter for the selected property | New |
| 期間與完整度需回讀 | `conversationStudio.evidence.periodCompleteness` | Read back the period and completeness | New |
| SERP／關鍵字端點 | `conversationStudio.evidence.serpEndpoint` | SERP / keyword endpoint | New |
| 香港／語言支援待確認 | `conversationStudio.evidence.marketSupportPending` | Hong Kong / language support pending confirmation | New |
| 公開頁面 URL、擷取時間、引用段落 | `conversationStudio.evidence.pageProvenance` | Public page URL, retrieval time and cited passages | New |
| 保留原問題、平台及測試時間；與搜尋成效分開 | `conversationStudio.evidence.aiCitationScope` | Retain the original question, platform and test time; keep separate from search performance | New |
| Google Search Console | `conversationStudio.connections.searchConsoleTitle` | Google Search Console | New |
| 已綁定 · 示例 | `conversationStudio.mock.bound` | Bound · Example | New |
| 香港端點待核實 | `conversationStudio.connections.hkEndpointPending` | Hong Kong endpoint pending verification | New |
| 未連接 · 示例 | `conversationStudio.mock.disconnected` | Not connected · Example | New |
| 資料完整度需驗證 | `conversationStudio.connections.completenessPending` | Data completeness requires verification | New |
| 查看連接範圍 | `conversationStudio.connections.viewScope` | View connection scope | New |
| 查看覆蓋限制 | `conversationStudio.connections.viewCoverage` | View coverage limits | New |
| 查看連接方式 | `conversationStudio.connections.viewMethod` | View connection method | New |

## Honesty lines — concept and plan §3.4

| Concept wording | Suggested zh-HK key | English draft | Key at base |
| --- | --- | --- | --- |
| 搜尋需求：待核實 | `conversationStudio.honesty.searchDemandPending` | Search demand: pending verification | New |
| HK／繁中：DataForSEO 的 ChatGPT LLM Mentions 目前只標示美國／英文覆蓋，此處不顯示香港 ChatGPT 分數。 | `conversationStudio.honesty.mentionsCoverage` | HK / Traditional Chinese: DataForSEO’s ChatGPT LLM Mentions currently lists US / English coverage only. No Hong Kong ChatGPT score is shown here. | New |
| 不將沒有回應的問題計作零提及 | `conversationStudio.honesty.missingIsNotZero` | Do not count unanswered questions as zero mentions | New |
| 目前不足以形成完整週比較。不將沒有回應的問題計作零提及，也不以模型自評代替引用證據。 | `conversationStudio.honesty.incompleteComparison` | There is not enough evidence for a complete weekly comparison. Unanswered questions do not count as zero mentions, and model self-assessment does not replace citation evidence. | New |
| 缺少資料時顯示「待核實」，不填入推算數字。 | `conversationStudio.honesty.noEstimatedNumbers` | Show “Pending verification” when data is missing; do not fill in estimated figures. | New |
| 缺少資料時顯示『待核實』，不填入推算數字。 | `conversationStudio.honesty.noEstimatedNumbers` | Show “Pending verification” when data is missing; do not fill in estimated figures. | New |
| 待核實 | `conversationStudio.honesty.pending` | Pending verification | New |
| 未連接 | `conversationStudio.connections.disconnected` | Not connected | New |
| 未有紀錄 | `conversationStudio.evidence.unknown` | Not recorded | Existing |


The second `honesty.noEstimatedNumbers` row preserves the plan §3.4 C7 quote
variant; the first is the exact snapshot wording. They propose one key, not two
catalog entries. The short missing-is-not-zero row is the exact excerpt in
§3.4 C9; the following row preserves its full concept sentence. These coverage
sentences are captured design requirements, not a new vendor verification.

## Existing keys and product-specific guardrails

The current catalogs already contain `title`, `description`, `threadsTitle`,
`newThread`, `threadsEmpty`, `templatesTitle`, `composerLabel`,
`composerPlaceholder`, `send` and the eight existing template label/prompt leaves
marked above. Existing values often differ: for example `threadsTitle` is
“對話列表”, `newThread` is “新增對話”, and `composerLabel` is “你的訊息”. The
new proposal follows the same camelCase/nested namespace conventions.

Existing `evidence.panelTitle` is “證據及涵蓋範圍”; Stage 4 proposes the concept
“本次證據”. Existing `evidence.stepsTitle` is “步驟”; the plan §3.4 proposes
“研究步驟” (English draft “Research steps”) for that same existing key. The
snapshot’s full mock label remains separately recorded above. Likewise the
concept’s “AISO · 示範回答” remains in `mock.answerLabel`; the plan explicitly
requires product copy “AISO · 回答” (proposed new `conversationStudio.answerLabel`,
English “AISO · Answer”). “送出示例” is mock-only; a future real follow-up action
needs its own accurate label.

Preserve these **already-existing leaves in both catalogs** and their honesty
semantics when moving copy into notes/inspectors:

| Existing full key | Current zh-HK copy | English draft / meaning to retain |
| --- | --- | --- |
| `conversationStudio.privateLabel` | 預設私人 · 暫存 | Private by default · Temporary |
| `conversationStudio.privacyBody` | 訊息只暫存在此頁面的記憶體，離開或重新整理後便會消失。儲存、分享及私人存取權限功能將於日後提供。 | Messages stay in this page’s memory and disappear when you leave or refresh. Saving, sharing and private access controls are coming later. |
| `conversationStudio.evidence.comparisonLimit` | 現有證據不足以作可靠的競爭對手比較。以下已儲存觀察僅供參考，不能確立排名或整體市場可見度。 | Not enough evidence for a verified competitor comparison. Saved observations below are context only; they do not establish rankings or market-wide visibility. |
| `conversationStudio.evidence.summaryScope` | 此摘要只整理已儲存紀錄，並未核實歷史模型陳述是否仍屬實。 | This summary reports saved records only. It does not verify historical model statements as current facts. |
| `conversationStudio.evidence.boundedScope` | 範圍：最近保留的正式 Pulse 週次最多 8 則觀察，每則最多 900 字元及 5 個連結，另附最近一次屬於此帳戶的掃描。這並非品牌完整歷史；重新載入可讀取更新快照。 | Scope: at most 8 observations from the latest retained canonical Pulse week, up to 900 characters and 5 links per observation, plus the latest owned scan. This is not a complete brand history. Reload to read a newer snapshot. |
| `conversationStudio.evidence.coverageMeaning` | 「已有紀錄」表示回覆包含已儲存紀錄，不代表問題已獲完整解答。「缺失」表示此有限選取範圍未有資料，不等於零提及或沒有活動。 | Present means a saved record is included in this reply, not that the request is fully answered. Missing means absent from this bounded selection, not zero mentions or zero activity. |
| `conversationStudio.evidence.searchUnknown` | 未能確認；單憑引用或搜尋請求不能證明曾執行 | Unknown; citations or a search request alone do not prove execution |
| `conversationStudio.evidence.liveLimit` | 此處不支援即時來源：不會查詢 OpenRouter、Firecrawl 或 GSC，亦不會套用 GSC 香港篩選或太平洋時間日期範圍。不會查詢 DataForSEO ChatGPT LLM Mentions；其美國／英文涵蓋範圍不能證明支援香港／繁體中文。缺失資料絕不等於零提及。 | Live sources are unsupported here: OpenRouter, Firecrawl and GSC are not queried. No GSC HK filter or PT date bounds are applied. DataForSEO ChatGPT LLM Mentions is not queried; its US/EN coverage does not establish HK/zh-HK coverage. Missing data never means zero mentions. |
| `conversationStudio.live.unverified` | 即時模型輸出，未經核實 | Live model output, not verified |
| `conversationStudio.live.missing` | 此平台未有回答。缺少回答不代表零提及。 | No answer from this platform. Missing does not mean zero mentions. |
| `conversationStudio.live.searchUnknown` | 不明；引用或搜尋要求不代表已執行搜尋 | Unknown; citations and search requests do not prove execution |
| `conversationStudio.live.temporaryCap` | Preview 暫時限制：計數器各程序獨立，重啟後重設，亦不會跨執行個體共用。這並非永久儲存的帳戶配額。 | Temporary Preview limit: counters are per process, reset on restart, and are not shared across instances. This is not a durable account quota. |
| `conversationStudio.live.savedScope` | 此面板只使用已儲存證據。即時模型輸出會分開顯示。不會查詢 Firecrawl、GSC 或 DataForSEO Mentions，亦不宣稱支援香港／zh-HK Mentions 覆蓋。 | This panel uses saved evidence only. Any live model output appears separately. Firecrawl, GSC and DataForSEO Mentions are not queried; no HK/zh-HK Mentions coverage is claimed. |

These are existing product strings, not quotations invented for the concept.
In particular, live output stays unverified; citations/requests alone do not
prove search execution; B1 remains bounded saved evidence; B2’s cap remains
process-local. “私人” in the mock does not establish durable private ACL, sharing
or persistence. Keep the existing temporary-memory notice visible/reachable
until separately approved work changes the behavior. Never copy Harbour Home,
Harbour Tea, version IDs, fake bindings or research steps claiming queries that
did not occur into product fallbacks. Stage 6 save/attachment controls stay held.
