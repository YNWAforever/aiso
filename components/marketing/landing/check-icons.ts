import {
  Bot, Braces, CalendarClock, FileCode2, FileText, Fingerprint, Heading, HelpCircle, Layers, Link2, ListTree,
  Map as MapIcon, MessageSquareQuote, Network, Quote, Rows3, ScanText, ScrollText, ShieldCheck, Sigma, type LucideIcon,
} from 'lucide-react'

/** One icon per check result key, so the pillar grids and sample heatmap read the same. */
export const CHECK_ICONS: Record<string, LucideIcon> = {
  c1_robots: ShieldCheck,
  c2_llms_txt: FileText,
  c3_bot_access: Bot,
  c4_structured_data: Braces,
  c5_extractability: ScanText,
  c6_llms_full_txt: ScrollText,
  c7_mcp_card: Fingerprint,
  c8_sitemap: MapIcon,
  c9_meta_desc: MessageSquareQuote,
  c10_headings: Heading,
  c11_faq: HelpCircle,
  c12_canonical: Link2,
  c13_render: FileCode2,
  c14_internal_links: Network,
  c15_entity: ListTree,
  c16_freshness: CalendarClock,
  c17_citation_density: Quote,
  c18_factual_density: Sigma,
  c19_topical_authority: Layers,
  c20_chunkability: Rows3,
}
