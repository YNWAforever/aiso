export interface CheckExplanation {
  /**
   * The plain-language thing this check is asking, in the user's locale.
   * Required, not optional: an optional field lets a check ship without one
   * and nothing notices until a user sees a blank row.
   */
  question: string
  why: string
  fix: { pass: string; warn: string; fail: string }
}

export const CHECK_EXPLANATIONS: Record<string, CheckExplanation> = {
  c1_robots: {
    question: 'Are public pages available to declared crawlers?',
    why: 'AI crawlers like GPTBot, ClaudeBot and PerplexityBot read robots.txt before fetching a page. Blocking rules there can prevent an allowed crawler from retrieving your content.',
    fix: {
      pass: 'AI bots are explicitly permitted — no action needed.',
      warn: 'Add explicit Allow rules for the major AI bots. The Fix Pack below includes a ready-to-use robots.txt patch.',
      fail: 'Create or update /robots.txt to permit AI crawlers. Use the Fix Pack below to generate the correct patch.',
    },
  },
  c2_llms_txt: {
    question: 'Is an optional concise site summary available?',
    why: 'llms.txt is an emerging content-map convention, not a ranking or citation requirement. Where it is read, it describes what your site covers and which pages matter most.',
    fix: {
      pass: 'Your llms.txt is present — no action needed.',
      warn: 'Your llms.txt exists but has no content. Add a title, description and key URLs using the Fix Pack below.',
      fail: 'Create /llms.txt at your domain root. The Fix Pack below generates a complete file tailored to your site.',
    },
  },
  c3_bot_access: {
    question: 'Do declared crawler requests receive a normal response?',
    why: 'Even if robots.txt allows bots, network-level blocks (Cloudflare, WAF rules, geo-fencing) can prevent AI crawlers from fetching your pages at all.',
    fix: {
      pass: 'All tested AI bots can access your site — no action needed.',
      warn: 'Some AI bots are being blocked at the network level. Check your CDN/WAF rules for bot-management settings and whitelist the affected user agents.',
      fail: 'AI bots cannot reach your site. Review your firewall, Cloudflare Bot Management, or server rules to allow GPTBot, ClaudeBot and PerplexityBot.',
    },
  },
  c4_structured_data: {
    question: 'Can systems identify the business, page and product type?',
    why: "JSON-LD schema markup gives AI models machine-readable context about your content — what type of page it is, who wrote it, and what it's about. Without it, that context has to be inferred from the prose.",
    fix: {
      pass: 'JSON-LD schema found — no action needed.',
      warn: 'Only microdata was found. Migrate to JSON-LD, the format this check looks for. The Fix Pack includes a FAQ JSON-LD starting point.',
      fail: 'No structured data found. Add JSON-LD schema to your pages. The Fix Pack below generates a FAQ schema to get you started.',
    },
  },
  c5_extractability: {
    question: 'Is the key customer answer present in page text?',
    why: 'AI models can only cite text they can read. If your content is locked inside JavaScript components that require execution to render, it may never be indexed.',
    fix: {
      pass: 'Content is extractable — no action needed.',
      warn: 'Limited extractable text was found. Move more content into server-rendered HTML rather than client-side JavaScript.',
      fail: 'Very little extractable text found. Your page likely relies heavily on JavaScript to render. Switch to server-side rendering (SSR) for key content.',
    },
  },
  c6_llms_full_txt: {
    question: 'Does the optional summary cover key pages?',
    why: 'A minimal llms.txt — the file with no real content — carries almost no information. A structured file with a description and multiple URL entries describes your site to any tool that reads it.',
    fix: {
      pass: 'Your llms.txt has good depth — no action needed.',
      warn: 'Your llms.txt exists but is sparse. Add a `#` title line, a `>` description block, and at least 5 key page URLs — 5 is where this check passes.',
      fail: 'No usable llms.txt content found. Use the Fix Pack below to generate a complete file.',
    },
  },
  c7_mcp_card: {
    question: 'Is optional machine-readable service metadata present?',
    why: 'Some emerging AI tools look for /.well-known/ai.json for structured information about your site. Adoption is early and the convention is not settled, so treat this as optional rather than foundational.',
    fix: {
      pass: 'AI metadata endpoint found — no action needed.',
      warn: 'AI meta tags were found but no formal endpoint. Create /.well-known/ai.json with your site name, description and contact.',
      fail: 'No AI metadata found. Create /.well-known/ai.json. See the Fimmick docs for a minimal template.',
    },
  },
  c8_sitemap: {
    question: 'Can systems discover the important public pages?',
    why: 'AI crawlers use your sitemap to discover and prioritise which pages to index. Without one, they may miss your most important content entirely.',
    fix: {
      pass: 'Sitemap found with good coverage — no action needed.',
      warn: 'Sitemap found but has very few URLs. Ensure all key pages are listed and the sitemap is referenced in robots.txt.',
      fail: 'No sitemap found. Generate /sitemap.xml and reference it in robots.txt with `Sitemap: https://yourdomain.com/sitemap.xml`.',
    },
  },
  c9_meta_desc: {
    question: 'Does each key page explain its purpose?',
    why: 'The meta description is the page summary you control. Search and AI tools may use it when presenting your page, so a concise, accurate description (50–160 characters) is worth writing deliberately.',
    fix: {
      pass: 'Meta description is well-formed — no action needed.',
      warn: 'Meta description length is outside the ideal range. Target 50–160 characters that clearly summarise the page\'s purpose.',
      fail: 'No meta description found. Add `<meta name="description" content="…">` to every key page.',
    },
  },
  c10_headings: {
    question: 'Can a customer scan the page and find the answer?',
    why: 'AI models use heading hierarchy to understand the structure of your content. One clear H1 and multiple H2 subheadings make it easy to extract distinct, citable chunks of information.',
    fix: {
      pass: 'Heading hierarchy is clear — no action needed.',
      warn: 'Heading structure is shallow. Add H2 subheadings to break your content into clearly labelled sections.',
      fail: 'No H1 found. Every page must have exactly one H1 that describes the page topic, followed by H2 section headings.',
    },
  },
  c11_faq: {
    question: 'Does the page answer common buying questions directly?',
    why: 'FAQPage JSON-LD marks a question and its answer as a discrete, machine-readable pair. That makes each answer easier to extract on its own, without a model having to infer where the answer starts and ends.',
    fix: {
      pass: 'FAQPage schema found — no action needed.',
      warn: 'FAQ content detected but no FAQPage JSON-LD schema. Add schema markup so each question and its answer form a discrete, machine-readable pair. The Fix Pack below generates the code.',
      fail: 'No FAQ content or schema found. Add a FAQ section and FAQPage JSON-LD to at least your homepage and key landing pages. Use the Fix Pack to generate the schema.',
    },
  },
  c12_canonical: {
    question: 'Is the intended page version unambiguous?',
    why: 'Canonical tags tell AI crawlers which version of a page is authoritative. Without them, crawlers may split authority across duplicate URLs (e.g. with/without trailing slash, http vs https).',
    fix: {
      pass: 'Canonical URL is correctly set — no action needed.',
      warn: 'Canonical tag points to a different origin. Verify this is intentional (e.g. cross-domain canonical). If not, update it to point to this page\'s URL.',
      fail: 'No canonical tag found. Add `<link rel="canonical" href="https://yourdomain.com/page">` to every page.',
    },
  },
  c13_render: {
    question: 'Is useful content available before complex scripts run?',
    why: 'AI crawlers typically do not execute JavaScript. If your page text only appears after JS runs, crawlers see a near-empty page and have nothing to cite.',
    fix: {
      pass: 'Content is rich in server-rendered HTML — no action needed.',
      warn: 'Moderate server-rendered text detected. Move more key content out of client-side components into SSR/SSG templates.',
      fail: 'Very little server-rendered text found. Switch to server-side rendering (Next.js SSR/SSG, Nuxt, etc.) for all content that should be indexed and cited.',
    },
  },
  c14_internal_links: {
    question: 'Do relevant pages lead customers to the intended answer?',
    why: 'Internal links are how a crawler moves between your pages. A page with no inbound internal link can only be found through the sitemap or an external link.',
    fix: {
      pass: 'Strong internal linking — no action needed.',
      warn: 'Few internal links found. Add contextual links between related pages, especially from high-traffic pages to deeper content.',
      fail: 'Very few internal links. Build a deliberate internal linking structure: this check passes at 10 or more links from your homepage to key pages. Cross-link related articles too.',
    },
  },
  c15_entity: {
    question: 'Is it clear which company and product the page describes?',
    why: 'Organization and Person schema states who is behind the content in a machine-readable form, rather than leaving authorship to be inferred from the page.',
    fix: {
      pass: 'Entity schema found — no action needed.',
      warn: 'Some entity signals found (og tags, author meta) but no JSON-LD. Upgrade to Organization or Person schema so authorship is stated in machine-readable form.',
      fail: 'No entity signals found. Add `<meta property="og:site_name">` and an Organization JSON-LD block to your site header.',
    },
  },
  c16_freshness: {
    question: 'Can customers tell whether the information is current?',
    why: 'dateModified and datePublished in your JSON-LD state when the content was last reviewed. Without them, age has to be guessed from the content itself.',
    fix: {
      pass: 'Content freshness signals confirmed — no action needed.',
      warn: 'Date signals found but content appears old. Update your dateModified field whenever you revise content, even minor updates.',
      fail: 'No date signals found. Add `datePublished` and `dateModified` to your Article/WebPage JSON-LD, and use `<meta property="article:modified_time">` as a fallback.',
    },
  },
  c17_citation_density: {
    question: 'Can important claims be traced to a credible source?',
    why: 'Citing authoritative external sources lets a reader — or a model — verify a claim. Citation density supports verification; it does not by itself produce an AI citation.',
    fix: {
      pass: 'Strong citation density — no action needed.',
      warn: 'Moderate citations found. Add more links to tier-1 sources (government, academic, major publications) and ensure statistics are attributed with inline source links.',
      fail: 'Very few or no external citations found. Every factual claim should link to an authoritative source. This check stops rewarding additional citations at roughly 2 per 1,000 words.',
    },
  },
  c18_factual_density: {
    question: 'Does the answer include useful facts rather than vague claims?',
    why: 'Concrete data — percentages, named entities, dates, comparative figures — can be checked against a source. Vague or superlative-heavy claims cannot, by anyone.',
    fix: {
      pass: 'Good factual density — no action needed.',
      warn: 'Some facts found but content could be more data-rich. Add specific numbers, date references, and comparative statements (e.g. "up 23% YoY from $3.4B to $4.2B").',
      fail: 'Content is too vague or opinion-heavy. Replace generalisations with specific data points, named studies, and measurable outcomes.',
    },
  },
  c19_topical_authority: {
    question: 'Does the site cover the main questions around the offer?',
    why: 'Covering a topic across a pillar page and linked supporting articles gives a reader more than one place to land, and makes the relationship between those pages explicit. A single isolated page states less about its own context.',
    fix: {
      pass: 'Strong topical cluster structure detected — no action needed.',
      warn: 'Partial topic coverage found. Identify your main topics and create a pillar page for each, with supporting articles linked to it.',
      fail: 'No clear topical clusters detected. Build content silos: one in-depth pillar page per key topic, surrounded by shorter cluster articles that link back to it.',
    },
  },
  c20_chunkability: {
    question: 'Can each section answer one question on its own?',
    why: 'AI models extract answers in chunks of roughly 100–1,500 tokens. Content organised under clear headings, with self-contained answer-first paragraphs, gives them a natural place to cut.',
    fix: {
      pass: 'Content is well-chunked for AI extraction — no action needed.',
      warn: 'Some sections are hard to extract as standalone answers. Start each H2 section with a direct answer sentence, keep each section self-contained, and avoid referencing "above" or "below".',
      fail: 'Content has few or no H2 headings, making chunked extraction impossible. Break your content into clearly labelled H2 sections, each answering one question directly.',
    },
  },
}

export const CHECK_EXPLANATIONS_ZH_HK: Record<string, CheckExplanation> = {
  c1_robots: {
    question: '搜尋系統是否獲准讀取公開頁面？',
    why: 'GPTBot、ClaudeBot 與 PerplexityBot 等 AI 爬蟲在讀取頁面前會先查看 robots.txt。當中的封鎖規則可能令獲准的爬蟲無法讀取你的內容。',
    fix: {
      pass: 'AI 爬蟲已獲明確允許 — 無需任何操作。',
      warn: '為主要 AI 爬蟲加入明確的 Allow 規則。下方的 Fix Pack 已包含可直接使用的 robots.txt 修補檔。',
      fail: '建立或更新 /robots.txt 以允許 AI 爬蟲存取。使用下方的 Fix Pack 生成正確的修補檔。',
    },
  },
  c2_llms_txt: {
    question: '網站是否提供可選的簡潔內容摘要？',
    why: 'llms.txt 是新興的內容地圖慣例，並非排名或引用的必要條件。在有讀取的情況下，它說明你的網站涵蓋什麼內容，以及哪些頁面最重要。',
    fix: {
      pass: '你的 llms.txt 已存在 — 無需任何操作。',
      warn: '你的 llms.txt 存在但沒有內容。使用下方的 Fix Pack 加入標題、描述及關鍵網址。',
      fail: '在你的網域根目錄建立 /llms.txt。下方的 Fix Pack 會為你的網站生成一份完整的客製化檔案。',
    },
  },
  c3_bot_access: {
    question: '申報的搜尋系統請求能否取得正常回應？',
    why: '即使 robots.txt 允許爬蟲存取，網絡層面的封鎖（Cloudflare、WAF 規則、地域限制）仍可能令 AI 爬蟲完全無法抓取你的頁面。',
    fix: {
      pass: '所有測試的 AI 爬蟲都能存取你的網站 — 無需任何操作。',
      warn: '部分 AI 爬蟲在網絡層面被封鎖。請檢查你的 CDN/WAF 規則中的爬蟲管理設定，並將受影響的 user agent 加入白名單。',
      fail: 'AI 爬蟲無法存取你的網站。請檢查防火牆、Cloudflare Bot Management 或伺服器規則，允許 GPTBot、ClaudeBot 及 PerplexityBot 存取。',
    },
  },
  c4_structured_data: {
    question: '系統能否分辨公司、頁面及產品類型？',
    why: 'JSON-LD schema 標記為 AI 模型提供關於你內容的機器可讀脈絡 — 頁面屬於甚麼類型、由誰撰寫、講述甚麼主題。沒有它，這些脈絡只能從文字中推斷。',
    fix: {
      pass: '已找到 JSON-LD schema — 無需任何操作。',
      warn: '只找到 microdata。請遷移至 JSON-LD，即本檢查所尋找的格式。Fix Pack 已包含 FAQ JSON-LD 範本作為起點。',
      fail: '未找到結構化資料。請為頁面加入 JSON-LD schema。下方的 Fix Pack 會生成 FAQ schema 助你開始。',
    },
  },
  c5_extractability: {
    question: '主要客戶答案是否直接出現在頁面？',
    why: 'AI 模型只能引用它讀得到的文字。如果你的內容被鎖在需要執行才能呈現的 JavaScript 元件之內，便可能永遠不會被索引。',
    fix: {
      pass: '內容可被提取 — 無需任何操作。',
      warn: '可提取的文字有限。請將更多內容放入伺服器端渲染的 HTML，而非依賴客戶端 JavaScript。',
      fail: '可提取的文字極少。你的頁面很可能高度依賴 JavaScript 渲染。請為關鍵內容改用伺服器端渲染（SSR）。',
    },
  },
  c6_llms_full_txt: {
    question: '可選網站摘要是否涵蓋主要頁面？',
    why: '一份只有檔案、沒有實質內容的 llms.txt 幾乎不帶任何資訊。一份結構完整、附有描述及多個網址條目的檔案，能向任何會讀取它的工具說明你的網站。',
    fix: {
      pass: '你的 llms.txt 內容充實 — 無需任何操作。',
      warn: '你的 llms.txt 存在但內容單薄。請加入 `#` 標題行、`>` 描述區塊，以及至少 5 個關鍵頁面網址 — 本檢查以 5 個為通過門檻。',
      fail: '未找到可用的 llms.txt 內容。使用下方的 Fix Pack 生成一份完整檔案。',
    },
  },
  c7_mcp_card: {
    question: '是否有機器可讀的服務資料？',
    why: '部分新興 AI 工具會檢查 /.well-known/ai.json 以取得你網站的結構化資訊。此慣例仍在早期階段、尚未定型，宜視為可選項目而非基礎工作。',
    fix: {
      pass: '已找到 AI 元資料端點 — 無需任何操作。',
      warn: '找到 AI meta 標籤但沒有正式端點。請建立 /.well-known/ai.json，包含你的網站名稱、描述及聯絡資訊。',
      fail: '未找到 AI 元資料。請建立 /.well-known/ai.json。參考 Fimmick 文件中的最簡範本。',
    },
  },
  c8_sitemap: {
    question: '系統能否找到重要公開頁面？',
    why: 'AI 爬蟲利用你的 sitemap 來發現頁面並決定索引的優先次序。沒有 sitemap，它們可能完全錯過你最重要的內容。',
    fix: {
      pass: '已找到 sitemap 且覆蓋良好 — 無需任何操作。',
      warn: '已找到 sitemap 但網址極少。請確保所有關鍵頁面都已列出，並在 robots.txt 中引用該 sitemap。',
      fail: '未找到 sitemap。請生成 /sitemap.xml，並在 robots.txt 中以 `Sitemap: https://yourdomain.com/sitemap.xml` 引用。',
    },
  },
  c9_meta_desc: {
    question: '每個主要頁面有否清楚說明用途？',
    why: 'Meta description 是你能自行控制的頁面摘要。搜尋及 AI 工具在呈現你的頁面時可能會採用它，因此值得認真撰寫一段簡潔準確的描述（50–160 字元）。',
    fix: {
      pass: 'Meta description 格式良好 — 無需任何操作。',
      warn: 'Meta description 長度超出理想範圍。請以 50–160 字元清楚概括頁面用途。',
      fail: '未找到 meta description。請為每個關鍵頁面加入 `<meta name="description" content="…">`。',
    },
  },
  c10_headings: {
    question: '客戶能否快速找到答案？',
    why: 'AI 模型靠標題層級理解你的內容結構。一個清晰的 H1 加上多個 H2 副標題，能讓 AI 輕鬆提取出獨立、可引用的資訊區塊。',
    fix: {
      pass: '標題層級清晰 — 無需任何操作。',
      warn: '標題結構過於單薄。請加入 H2 副標題，將內容分成標示清晰的段落。',
      fail: '未找到 H1。每個頁面必須有且只有一個描述頁面主題的 H1，其後配以 H2 段落標題。',
    },
  },
  c11_faq: {
    question: '頁面有否直接回答常見購買問題？',
    why: 'FAQPage JSON-LD 把問題與答案標記為獨立、機器可讀的一組。這讓每個答案更容易被單獨提取，模型無須自行推斷答案的起訖位置。',
    fix: {
      pass: '已找到 FAQPage schema — 無需任何操作。',
      warn: '偵測到 FAQ 內容但沒有 FAQPage JSON-LD schema。請加入 schema 標記，讓每組問題與答案成為獨立、機器可讀的一對。下方的 Fix Pack 會生成所需程式碼。',
      fail: '未找到 FAQ 內容或 schema。請至少在首頁及關鍵著陸頁加入 FAQ 部分及 FAQPage JSON-LD。使用 Fix Pack 生成 schema。',
    },
  },
  c12_canonical: {
    question: '哪個網址是主要版本是否清楚？',
    why: 'Canonical 標籤告訴 AI 爬蟲哪個頁面版本是權威版本。沒有它，爬蟲可能將權威分散到重複網址上（例如有/無結尾斜線、http 與 https）。',
    fix: {
      pass: 'Canonical 網址設定正確 — 無需任何操作。',
      warn: 'Canonical 標籤指向不同的來源網域。請確認這是刻意安排（例如跨網域 canonical）。如果不是，請將它更新為指向本頁網址。',
      fail: '未找到 canonical 標籤。請為每個頁面加入 `<link rel="canonical" href="https://yourdomain.com/page">`。',
    },
  },
  c13_render: {
    question: '毋須複雜程式是否已有實用內容？',
    why: 'AI 爬蟲通常不會執行 JavaScript。如果你的頁面文字只在 JS 執行後才出現，爬蟲看到的幾乎是一個空白頁面，根本無從引用。',
    fix: {
      pass: '伺服器端渲染的 HTML 內容豐富 — 無需任何操作。',
      warn: '偵測到中等程度的伺服器端渲染文字。請將更多關鍵內容從客戶端元件移至 SSR/SSG 範本。',
      fail: '伺服器端渲染的文字極少。請為所有需要被索引及引用的內容改用伺服器端渲染（Next.js SSR/SSG、Nuxt 等）。',
    },
  },
  c14_internal_links: {
    question: '相關頁面有否帶客戶前往正確答案？',
    why: '內部連結是爬蟲在你的頁面之間移動的途徑。一個沒有任何內部連結指向它的頁面，只能透過 sitemap 或外部連結被發現。',
    fix: {
      pass: '內部連結結構穩健 — 無需任何操作。',
      warn: '內部連結偏少。請在相關頁面之間加入上下文連結，尤其是由高流量頁面連到較深層的內容。',
      fail: '內部連結極少。請刻意建立內部連結結構：本檢查以由首頁連往關鍵頁面 10 條連結為通過門檻。相關文章之間亦應互相連結。',
    },
  },
  c15_entity: {
    question: '頁面有否清楚說明公司及產品？',
    why: 'Organization 及 Person schema 以機器可讀的方式說明內容背後是誰，而非讓署名資訊只能從頁面內容推斷。',
    fix: {
      pass: '已找到實體 schema — 無需任何操作。',
      warn: '找到部分實體訊號（og 標籤、author meta）但沒有 JSON-LD。請升級至 Organization 或 Person schema，以機器可讀的方式說明署名。',
      fail: '未找到實體訊號。請在網站 header 加入 `<meta property="og:site_name">` 及 Organization JSON-LD 區塊。',
    },
  },
  c16_freshness: {
    question: '客戶能否知道資料是否仍然有效？',
    why: 'JSON-LD 中的 dateModified 及 datePublished 說明內容最後審閱的時間。沒有這些欄位，內容的新舊只能從內文推斷。',
    fix: {
      pass: '內容新鮮度訊號已確認 — 無需任何操作。',
      warn: '找到日期訊號但內容似乎較舊。每次修訂內容時（即使是小改動）都應更新 dateModified 欄位。',
      fail: '未找到日期訊號。請在 Article/WebPage JSON-LD 中加入 `datePublished` 及 `dateModified`，並以 `<meta property="article:modified_time">` 作後備。',
    },
  },
  c17_citation_density: {
    question: '重要聲稱能否追溯到可信來源？',
    why: '引用權威外部來源，讓讀者或模型能夠核實論述。引用密度有助查證，但本身並不代表會獲 AI 引用。',
    fix: {
      pass: '引用密度良好 — 無需任何操作。',
      warn: '引用數量一般。請加入更多頂級來源連結（政府、學術機構、主要媒體），並確保所有統計數字都附有內文來源連結。',
      fail: '外部引用極少或完全沒有。每項事實陳述都應連結至權威來源。本檢查的評分在每 1,000 字約 2 個引用之後便不再提升。',
    },
  },
  c18_factual_density: {
    question: '答案有否提供實用事實而非空泛宣傳？',
    why: '具體資料 — 百分比、具名實體、日期、比較數字 — 可以對照來源查證。空泛或充斥誇張字眼的說法，任何人都無從核實。',
    fix: {
      pass: '事實密度良好 — 無需任何操作。',
      warn: '找到部分事實，但內容可以更數據化。請加入具體數字、日期參照及比較陳述（例如「按年上升 23%，由 34 億美元增至 42 億美元」）。',
      fail: '內容過於空泛或偏重個人意見。請以具體數據、具名研究及可量度的成果取代籠統說法。',
    },
  },
  c19_topical_authority: {
    question: '網站有否回答產品的主要問題？',
    why: '以支柱頁加上互相連結的支援文章覆蓋同一主題，能為讀者提供多個入口，也讓頁面之間的關係更明確。單一孤立的頁面能交代的脈絡較少。',
    fix: {
      pass: '偵測到穩健的主題群組結構 — 無需任何操作。',
      warn: '主題覆蓋不完整。請確定你的核心主題，為每個主題建立一個支柱頁，並配以互相連結的支援文章。',
      fail: '未偵測到清晰的主題群組。請建立內容專區：每個關鍵主題一個深入的支柱頁，周圍配以連結回支柱頁的較短群組文章。',
    },
  },
  c20_chunkability: {
    question: '每個分段能否獨立回答一個問題？',
    why: 'AI 模型以大約 100–1,500 個 token 為單位提取答案。內容若在清晰標題之下、以自成一體、答案先行的段落組織，便有自然的切分位置。',
    fix: {
      pass: '內容分塊結構良好，便於 AI 提取 — 無需任何操作。',
      warn: '部分段落難以作為獨立答案被提取。每個 H2 段落應以直接回答的句子開頭，內容自成一體，並避免使用「上文」、「下文」等指涉。',
      fail: '內容的 H2 標題極少或完全沒有，無法進行分塊提取。請將內容拆分為標示清晰的 H2 段落，每段直接回答一條問題。',
    },
  },
}

export function getCheckExplanations(locale: string) {
  return locale === 'zh-HK' ? CHECK_EXPLANATIONS_ZH_HK : CHECK_EXPLANATIONS
}
