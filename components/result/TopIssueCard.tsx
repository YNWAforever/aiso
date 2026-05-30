'use client'
import { AlertTriangle } from 'lucide-react'
import type { ScanResults } from '@/lib/types'

interface IssueInfo {
  headline: string
  why: string
  fix: string
}

const ISSUE_MAP: Record<string, IssueInfo> = {
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

const CORE_ORDER = ['c1_robots','c2_llms_txt','c3_bot_access','c4_structured_data','c5_extractability']
const EXT_ORDER  = ['c6_llms_full_txt','c7_mcp_card','c8_sitemap','c9_meta_desc','c10_headings','c11_faq','c12_canonical','c13_render','c14_internal_links','c15_entity','c16_freshness']
const GEO_ORDER  = ['c17_citation_density','c18_factual_density','c19_topical_authority','c20_chunkability']

interface Props {
  results: ScanResults & Record<string, unknown>
  failCount: number
}

export function TopIssueCard({ results, failCount }: Props) {
  const allKeys = [...CORE_ORDER, ...EXT_ORDER, ...GEO_ORDER]
  const topKey = allKeys.find(k => {
    const r = results[k] as { status: string } | undefined
    return r?.status === 'fail'
  }) ?? allKeys.find(k => {
    const r = results[k] as { status: string } | undefined
    return r?.status === 'warn'
  })

  if (!topKey) return null
  const issue = ISSUE_MAP[topKey]
  if (!issue) return null

  return (
    <div className="rounded-2xl border-2 border-red-200 bg-red-50 p-6">
      <div className="flex items-start gap-3 mb-3">
        <div className="size-9 rounded-xl bg-red-500 flex items-center justify-center shrink-0 mt-0.5">
          <AlertTriangle className="size-4 text-white" />
        </div>
        <div>
          <p className="text-xs font-bold text-red-500 tracking-widest mb-1">YOUR #1 AI VISIBILITY ISSUE</p>
          <h2 className="text-lg font-black text-slate-900 leading-snug">{issue.headline}</h2>
        </div>
      </div>
      <p className="text-sm text-slate-600 leading-relaxed mb-4 pl-12">{issue.why}</p>
      <div className="pl-12">
        <div className="flex items-center gap-1.5 text-xs text-slate-500 bg-white rounded-lg px-3 py-2 border border-red-100 inline-flex">
          <span className="font-semibold text-slate-700">Quick fix:</span> {issue.fix}
        </div>
      </div>
      {failCount > 1 && (
        <p className="pl-12 mt-4 text-xs text-red-600 font-semibold">
          + {failCount - 1} more issue{failCount - 1 > 1 ? 's' : ''} found — enter your email to see the full breakdown ↓
        </p>
      )}
    </div>
  )
}
