import type { Scan } from '@/lib/types'

export const E2E_FIXTURE_SCAN_ID = 'e2e00000-0000-4000-a000-000000000001'

const pass = (message: string) => ({ status: 'pass' as const, message })
const fail = (message: string) => ({ status: 'fail' as const, message })
const warn = (message: string) => ({ status: 'warn' as const, message })

export const E2E_FIXTURE_SCAN: Scan = {
  id: E2E_FIXTURE_SCAN_ID,
  url: 'https://e2e-test.example.com',
  domain: 'e2e-test.example.com',
  score: 63.5,
  grade: 'D',
  industry: null,
  region: null,
  account_id: null,
  created_at: '2026-01-01T00:00:00.000Z',
  results: {
    c1_robots: pass('robots_ai_allowed'), c2_llms_txt: fail('llms_txt_missing'), c3_bot_access: pass('bots_all_accessible'), c4_structured_data: warn('structured_data_found'), c5_extractability: pass('extractability_good'),
    c6_llms_full_txt: fail('llms_full_txt_missing'), c7_mcp_card: fail('mcp_card_missing'), c8_sitemap: pass('sitemap_found'), c9_meta_description: pass('meta_desc_good'), c10_headings: pass('headings_ok'), c11_faq: fail('faq_missing'), c12_canonical: pass('canonical_ok'), c13_server_text: pass('render_ok'), c14_internal_links: warn('links_few'), c15_entity_signals: pass('entities_ok'), c16_freshness: warn('freshness_stale'),
    c17_citation_density: { ...fail('citations_low'), geoDetails: { qualityScore: 30, authorityBreakdown: { tier1: 0, tier2: 1, tier3: 2, other: 2 }, citationsPerK: 0.8, details: [] } },
    c18_factual_density: { ...fail('factual_low'), geoDetails: { qualityScore: 25, numberDensityPct: 0.3, hasComparisons: false } },
    c19_topical_authority: { ...warn('authority_thin'), geoDetails: { topicalCoverageScore: 40, totalClusters: 1, orphanPages: 3 } },
    c20_chunkability: { ...pass('chunks_ok'), geoDetails: { optimalChunkRatio: 0.6, totalChunks: 8, hasFaqStyle: false } },
  },
}

export function getE2EScanFixture(id: string): Scan | null {
  if (process.env.E2E_FIXTURE_MODE !== '1' || id !== E2E_FIXTURE_SCAN_ID) return null
  return structuredClone(E2E_FIXTURE_SCAN)
}
