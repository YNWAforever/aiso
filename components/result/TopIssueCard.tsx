'use client'
import { AlertTriangle } from 'lucide-react'
import { useLocale } from 'next-intl'
import type { ScanResults } from '@/lib/types'

interface IssueInfo {
  headline: string
  why: string
  fix: string
}

const ISSUE_MAP_EN: Record<string, IssueInfo> = {
  c1_robots: {
    headline: 'AI crawlers are blocked from your site',
    why: 'Your robots.txt actively blocks or doesn\'t explicitly allow AI crawlers like GPTBot, ClaudeBot, and PerplexityBot. These bots can\'t index your content — so you\'re invisible.',
    fix: 'Add explicit allow rules for AI crawlers in your robots.txt.',
  },
  c2_llms_txt: {
    headline: 'No llms.txt — AI has no idea what your site covers',
    why: 'Without an llms.txt file, language models visit your site with no structured summary of what you do, who you serve, or what you want to be cited for. They make up the narrative — or skip you entirely.',
    fix: 'Create a /llms.txt file that summarises your site\'s purpose, key topics, and preferred citations.',
  },
  c3_bot_access: {
    headline: 'AI bots can\'t access your pages',
    why: 'Your server is returning errors or blocks when AI crawlers request your pages. They give up and move on to your competitors.',
    fix: 'Ensure AI user-agents receive standard 200 responses — the same as a regular browser.',
  },
  c4_structured_data: {
    headline: 'No structured data — AI can\'t understand your content type',
    why: 'Without JSON-LD schema markup (Organization, Article, FAQ, etc.), AI models can\'t confidently categorise or cite your content. Unstructured pages are a last resort for citations.',
    fix: 'Add relevant Schema.org markup to your key pages.',
  },
  c5_extractability: {
    headline: 'Your page content can\'t be extracted cleanly',
    why: 'AI models chunk and extract sentences to cite. If your page is heavy JS, requires interaction, or has deeply nested DOM, models skip it in favour of simpler sources.',
    fix: 'Ensure key content is in semantic HTML — visible without JavaScript execution.',
  },
  c6_llms_full_txt: {
    headline: 'No llms-full.txt for deep AI indexing',
    why: 'Advanced AI agents look for a full-content version of your site in llms-full.txt. Without it, they only get a surface-level summary.',
    fix: 'Add /llms-full.txt with your complete site content map.',
  },
  c7_mcp_card: {
    headline: 'No MCP server card detected',
    why: 'AI agents increasingly use Model Context Protocol to discover tools and data sources. Without an MCP card, you\'re invisible to this new layer of AI discovery.',
    fix: 'Add a /.well-known/mcp.json card describing your available MCP endpoints.',
  },
  c8_sitemap: {
    headline: 'No XML sitemap found',
    why: 'AI crawlers rely on sitemaps to discover all your content. Without one, they only find pages that are explicitly linked — missing most of your content.',
    fix: 'Generate and submit an XML sitemap at /sitemap.xml.',
  },
  c9_meta_desc: {
    headline: 'Missing or poor meta descriptions',
    why: 'Meta descriptions are often used verbatim by AI models as the initial summary of your page. Missing or auto-generated descriptions reduce your citation quality.',
    fix: 'Write unique, factual meta descriptions for every key page.',
  },
  c10_headings: {
    headline: 'Poor heading structure',
    why: 'AI models use heading hierarchy (H1→H2→H3) to understand content structure and extract relevant chunks. A flat or broken heading structure makes chunking unreliable.',
    fix: 'Ensure every page has a single H1 and logical H2/H3 hierarchy.',
  },
  c11_faq: {
    headline: 'No FAQ schema detected',
    why: 'FAQ-structured content with JSON-LD markup is among the most-cited content format in AI answers. You\'re missing a high-value citation format.',
    fix: 'Add FAQ sections with FAQPage schema markup to key pages.',
  },
  c12_canonical: {
    headline: 'Canonical tag issues detected',
    why: 'Duplicate or missing canonical tags cause AI crawlers to index the wrong version of your pages — diluting your authority across multiple URLs.',
    fix: 'Ensure every page has a self-referencing canonical tag.',
  },
  c13_render: {
    headline: 'Content requires JavaScript to render',
    why: 'AI crawlers typically don\'t execute JavaScript. If your content only appears after JS runs, it\'s invisible to most AI indexing.',
    fix: 'Use server-side rendering or static generation for key content.',
  },
  c14_internal_links: {
    headline: 'Weak internal linking structure',
    why: 'Internal links help AI models discover related content and understand your topical authority. A thin internal link graph limits how much of your site gets indexed.',
    fix: 'Improve internal linking from pillar pages to cluster content.',
  },
  c15_entity: {
    headline: 'Weak entity signals on your pages',
    why: 'AI models look for named entities (people, organisations, locations, products) to understand context. Pages with few entities appear unspecific and are harder to cite.',
    fix: 'Mention specific people, organisations, and dates relevant to your content.',
  },
  c16_freshness: {
    headline: 'Content freshness signals are weak',
    why: 'AI models prefer citing recently updated content. Without visible dates or freshness signals, your content looks stale compared to competitors who publish regularly.',
    fix: 'Add publish and update dates to all key pages.',
  },
  c17_citation_density: {
    headline: 'Low-authority citations are hurting your credibility',
    why: 'AI models weigh the authority of sources you cite. Linking to low-quality or no-authority sources signals that your content itself may not be trustworthy.',
    fix: 'Replace weak citations with Tier 1 sources: academic, government, or well-known industry publications.',
  },
  c18_factual_density: {
    headline: 'Not enough facts, numbers, or data on your pages',
    why: 'AI models prefer citing content rich in specific claims — statistics, percentages, dates, named comparisons. Vague or opinion-heavy content rarely gets cited.',
    fix: 'Add specific data points, statistics with sources, and named comparisons to key pages.',
  },
  c19_topical_authority: {
    headline: 'Your site lacks topical depth in your niche',
    why: 'AI models assess topical authority by how comprehensively a site covers a subject. Without pillar pages and supporting clusters, you look like a generalist — not an authority.',
    fix: 'Build topic clusters: one in-depth pillar page + 5–10 supporting articles per core topic.',
  },
  c20_chunkability: {
    headline: 'Your content isn\'t structured for AI extraction',
    why: 'AI models extract content in \'chunks\' — short, self-contained passages. Long walls of text, or passages that require surrounding context to make sense, get skipped.',
    fix: 'Rewrite long sections into short, self-contained paragraphs with clear headers.',
  },
}

const ISSUE_MAP_ZH_HK: Record<string, IssueInfo> = {
  c1_robots: {
    headline: 'AI 爬蟲被你的網站拒諸門外',
    why: '你的 robots.txt 正在封鎖（或沒有明確允許）GPTBot、ClaudeBot、PerplexityBot 等 AI 爬蟲。這些爬蟲無法索引你的內容——你在 AI 世界等於隱形。',
    fix: '在 robots.txt 加入明確允許 AI 爬蟲的規則。',
  },
  c2_llms_txt: {
    headline: '沒有 llms.txt——AI 完全不知道你的網站講甚麼',
    why: '沒有 llms.txt 檔案，語言模型造訪你的網站時，完全沒有結構化摘要說明你做甚麼、服務誰、希望被引用甚麼。它們只能自行編造——或乾脆跳過你。',
    fix: '建立 /llms.txt 檔案，概述網站宗旨、核心主題及希望被引用的內容。',
  },
  c3_bot_access: {
    headline: 'AI 機械人無法存取你的頁面',
    why: 'AI 爬蟲請求你的頁面時，伺服器回傳錯誤或封鎖。它們會直接放棄，轉投你的競爭對手。',
    fix: '確保 AI user-agent 收到標準 200 回應——與一般瀏覽器一致。',
  },
  c4_structured_data: {
    headline: '沒有結構化數據——AI 無法理解你的內容類型',
    why: '缺少 JSON-LD schema 標記（Organization、Article、FAQ 等），AI 模型無法準確分類或引用你的內容。無結構的頁面只會是引用的最後選擇。',
    fix: '在重點頁面加入相關的 Schema.org 標記。',
  },
  c5_extractability: {
    headline: '你的頁面內容無法被乾淨提取',
    why: 'AI 模型會將內容切塊並提取句子作引用。如果頁面依賴大量 JS、需要互動，或 DOM 層級過深，模型會跳過你，改用更簡單的來源。',
    fix: '確保重點內容以語義化 HTML 呈現——毋須執行 JavaScript 亦可見。',
  },
  c6_llms_full_txt: {
    headline: '沒有 llms-full.txt 供 AI 深度索引',
    why: '進階 AI 代理會在 llms-full.txt 尋找你網站的完整內容版本。沒有它，AI 只能取得表面摘要。',
    fix: '加入 /llms-full.txt，提供完整的網站內容地圖。',
  },
  c7_mcp_card: {
    headline: '未偵測到 MCP 伺服器卡片',
    why: 'AI 代理越來越多透過 Model Context Protocol 發現工具和數據來源。沒有 MCP 卡片，你在這個全新的 AI 發現層完全隱形。',
    fix: '加入 /.well-known/mcp.json 卡片，描述你可用的 MCP 端點。',
  },
  c8_sitemap: {
    headline: '找不到 XML sitemap',
    why: 'AI 爬蟲依靠 sitemap 發現你的全部內容。沒有它，爬蟲只能找到有明確連結的頁面——錯過你大部分內容。',
    fix: '生成 XML sitemap 並放置於 /sitemap.xml。',
  },
  c9_meta_desc: {
    headline: 'meta description 缺失或質素欠佳',
    why: 'AI 模型經常直接引用 meta description 作為頁面的初步摘要。缺失或自動生成的描述會拉低你的引用質素。',
    fix: '為每個重點頁面撰寫獨特、符合事實的 meta description。',
  },
  c10_headings: {
    headline: '標題結構欠佳',
    why: 'AI 模型透過標題層級（H1→H2→H3）理解內容結構並提取相關段落。扁平或混亂的標題結構令內容切塊變得不可靠。',
    fix: '確保每頁只有一個 H1，並有清晰合理的 H2/H3 層級。',
  },
  c11_faq: {
    headline: '未偵測到 FAQ schema',
    why: '配備 JSON-LD 標記的 FAQ 內容，是 AI 答案中最常被引用的內容格式之一。你正錯失一個高價值的引用格式。',
    fix: '在重點頁面加入 FAQ 部分，並配上 FAQPage schema 標記。',
  },
  c12_canonical: {
    headline: '偵測到 canonical 標籤問題',
    why: 'canonical 標籤重複或缺失，會令 AI 爬蟲索引錯誤版本的頁面——你的權威被分散到多個網址。',
    fix: '確保每個頁面都有指向自身的 canonical 標籤。',
  },
  c13_render: {
    headline: '內容需要 JavaScript 才能呈現',
    why: 'AI 爬蟲一般不會執行 JavaScript。如果你的內容要等 JS 執行後才出現，對大部分 AI 索引而言等於不存在。',
    fix: '重點內容改用伺服器端渲染或靜態生成。',
  },
  c14_internal_links: {
    headline: '內部連結結構薄弱',
    why: '內部連結幫助 AI 模型發現相關內容、理解你的主題權威。內部連結網絡太薄弱，會限制網站被索引的範圍。',
    fix: '加強由支柱頁面到群組內容的內部連結。',
  },
  c15_entity: {
    headline: '頁面的實體訊號薄弱',
    why: 'AI 模型靠具名實體（人物、機構、地點、產品）理解上下文。實體太少的頁面顯得空泛，難以被引用。',
    fix: '在內容中提及與主題相關的具體人物、機構和日期。',
  },
  c16_freshness: {
    headline: '內容新鮮度訊號薄弱',
    why: 'AI 模型偏好引用近期更新的內容。沒有可見的日期或新鮮度訊號，相比定期發佈的競爭對手，你的內容會顯得過時。',
    fix: '在所有重點頁面加上發佈及更新日期。',
  },
  c17_citation_density: {
    headline: '低權威引用正在損害你的可信度',
    why: 'AI 模型會衡量你引用來源的權威性。連結到低質素或無權威的來源，等於暗示你的內容本身也未必可信。',
    fix: '以 Tier 1 來源取代薄弱引用：學術、政府或知名行業刊物。',
  },
  c18_factual_density: {
    headline: '頁面缺乏足夠的事實、數字和數據',
    why: 'AI 模型偏好引用具體論述豐富的內容——統計數字、百分比、日期、具名比較。空泛或側重個人意見的內容鮮少被引用。',
    fix: '在重點頁面加入具體數據、有出處的統計數字及具名比較。',
  },
  c19_topical_authority: {
    headline: '你的網站在自身領域欠缺主題深度',
    why: 'AI 模型以網站對某主題的覆蓋深度評估主題權威。沒有支柱頁面和支援群組，你看起來只是泛泛之輩——而非權威。',
    fix: '建立主題群組：每個核心主題一篇深度支柱頁面 + 5–10 篇支援文章。',
  },
  c20_chunkability: {
    headline: '你的內容結構不利於 AI 提取',
    why: 'AI 模型以「塊」提取內容——即簡短、自成一體的段落。冗長的文字牆，或需要上下文才看得懂的段落，都會被跳過。',
    fix: '將冗長章節改寫成簡短、自成一體的段落，並配以清晰標題。',
  },
}

const UI_EN = {
  label: 'YOUR #1 AI VISIBILITY ISSUE',
  quickFix: 'Quick fix:',
  severity: { warn: 'Warning', fail: 'Failed' },
  severityAria: (label: string) => `Severity: ${label}`,
  more: (n: number) =>
    `+ ${n} more issue${n > 1 ? 's' : ''} found — create a free account to see the full breakdown ↓`,
}

const UI_ZH_HK: typeof UI_EN = {
  label: '你的 #1 AI 可見度問題',
  quickFix: '快速修復：',
  severity: { warn: '警告', fail: '不及格' },
  severityAria: (label: string) => `嚴重程度：${label}`,
  more: (n: number) => `+ 還發現 ${n} 個問題——免費建立帳戶即可查看完整分析 ↓`,
}

const CORE_ORDER = ['c1_robots','c2_llms_txt','c3_bot_access','c4_structured_data','c5_extractability']
const EXT_ORDER  = ['c6_llms_full_txt','c7_mcp_card','c8_sitemap','c9_meta_desc','c10_headings','c11_faq','c12_canonical','c13_render','c14_internal_links','c15_entity','c16_freshness']
const GEO_ORDER  = ['c17_citation_density','c18_factual_density','c19_topical_authority','c20_chunkability']

interface Props {
  results: ScanResults & Record<string, unknown>
  failCount: number
}

export function TopIssueCard({ results, failCount }: Props) {
  const locale = useLocale()
  const isZh = locale === 'zh-HK'
  const issueMap = isZh ? ISSUE_MAP_ZH_HK : ISSUE_MAP_EN
  const ui = isZh ? UI_ZH_HK : UI_EN

  const allKeys = [...CORE_ORDER, ...EXT_ORDER, ...GEO_ORDER]
  const topKey = allKeys.find(k => {
    const r = results[k] as { status: string } | undefined
    return r?.status === 'fail'
  }) ?? allKeys.find(k => {
    const r = results[k] as { status: string } | undefined
    return r?.status === 'warn'
  })

  if (!topKey) return null
  const issue = issueMap[topKey]
  if (!issue) return null

  const topResult = results[topKey] as { status: 'warn' | 'fail' }
  const severity = topResult.status === 'warn' ? 'warn' : 'fail'
  const severityLabel = ui.severity[severity]
  const styles = severity === 'warn'
    ? {
        card: 'border-amber-200 bg-amber-50',
        icon: 'bg-amber-500',
        eyebrow: 'text-amber-600',
        badge: 'bg-amber-100 text-amber-800 ring-amber-200',
        quickFix: 'border-amber-100',
        more: 'text-amber-700',
      }
    : {
        card: 'border-red-200 bg-red-50',
        icon: 'bg-red-500',
        eyebrow: 'text-red-500',
        badge: 'bg-red-100 text-red-800 ring-red-200',
        quickFix: 'border-red-100',
        more: 'text-red-600',
      }

  return (
    <div data-severity={severity} className={`rounded-2xl border-2 p-6 ${styles.card}`}>
      <div className="flex items-start gap-3 mb-3">
        <div className={`size-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${styles.icon}`}>
          <AlertTriangle className="size-4 text-white" />
        </div>
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <p className={`text-xs font-bold tracking-widest ${styles.eyebrow}`}>{ui.label}</p>
            <span
              aria-label={ui.severityAria(severityLabel)}
              className={`rounded-full px-2 py-0.5 text-xs font-bold ring-1 ${styles.badge}`}
            >
              {severityLabel}
            </span>
          </div>
          <h2 className="text-lg font-black text-slate-900 leading-snug">{issue.headline}</h2>
        </div>
      </div>
      <p className="text-sm text-slate-600 leading-relaxed mb-4 pl-12">{issue.why}</p>
      <div className="pl-12">
        <div className={`flex items-center gap-1.5 text-xs text-slate-500 bg-white rounded-lg px-3 py-2 border inline-flex ${styles.quickFix}`}>
          <span className="font-semibold text-slate-700">{ui.quickFix}</span> {issue.fix}
        </div>
      </div>
      {failCount > 1 && (
        <p className={`pl-12 mt-4 text-xs font-semibold ${styles.more}`}>
          {ui.more(failCount - 1)}
        </p>
      )}
    </div>
  )
}
