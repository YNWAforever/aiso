import {buildScanEvidence} from './scan-evidence'
import type { Scan } from '@/lib/types'
import { assignGrade } from '@/lib/scoring'

export const E2E_FIXTURE_SCAN_ID = 'e2e00000-0000-4000-a000-000000000001'

const pass = (message: string) => ({ status: 'pass' as const, message })
const fail = (message: string) => ({ status: 'fail' as const, message })
const warn = (message: string) => ({ status: 'warn' as const, message })

// Derived, never typed: the fixture stored grade 'D' beside 63.5, a pairing
// assignGrade cannot produce (60-69 is 'C'), so the result page showed a
// grade the scorer would never assign.
const E2E_FIXTURE_SCORE = 63.5

export const E2E_FIXTURE_SCAN: Scan = {
  id: E2E_FIXTURE_SCAN_ID,
  url: 'https://e2e-test.example.com',
  domain: 'e2e-test.example.com',
  score: E2E_FIXTURE_SCORE,
  grade: assignGrade(E2E_FIXTURE_SCORE),

  industry: null,
  region: null,
  account_id: null,
  created_at: '2026-01-01T00:00:00.000Z',
  results: {
    // Declared synthetic successful page, used only behind E2E_FIXTURE_MODE.
    // An old numeric fixture without collection evidence is correctly unknown.
    evidence: buildScanEvidence({requestedUrl:'https://e2e-test.example.com',evaluatedUrl:'https://e2e-test.example.com',industry:null,region:null,sitemapSource:'unknown',checks:{},observations:[{check:'page',collection:'complete',httpStatus:200,target:{origin:'https://e2e-test.example.com'}}]}),
    c1_robots: pass('robots_ai_allowed'), c2_llms_txt: fail('llms_txt_missing'), c3_bot_access: pass('bots_all_accessible'), c4_structured_data: warn('structured_data_found'), c5_extractability: pass('extractability_good'),
    c6_llms_full_txt: fail('llms_full_txt_missing'), c7_mcp_card: fail('mcp_card_missing'), c8_sitemap: pass('sitemap_found'), c9_meta_description: pass('meta_desc_good'), c10_headings: pass('headings_ok'), c11_faq: fail('faq_missing'), c12_canonical: pass('canonical_ok'), c13_server_text: pass('render_ok'), c14_internal_links: warn('links_few'), c15_entity_signals: pass('entities_ok'), c16_freshness: warn('freshness_stale'),
    c17_citation_density: { ...fail('citations_low'), geoDetails: { qualityScore: 30, authorityBreakdown: { tier1: 0, tier2: 1, tier3: 2, other: 2 }, citationsPerK: 0.8, details: [] } },
    c18_factual_density: { ...fail('factual_low'), geoDetails: { qualityScore: 25, numberDensityPct: 0.3, hasComparisons: false } },
    c19_topical_authority: { ...warn('authority_thin'), geoDetails: { topicalCoverageScore: 40, totalClusters: 1, orphanPages: 3 } },
    c20_chunkability: { ...pass('chunks_ok'), geoDetails: { optimalChunkRatio: 0.6, totalChunks: 8, hasFaqStyle: false } },
  },
}

const PRECISION_SCORES = [49.97,59.97,69.97,79.97,89.97,63.5,0,50,60,70,80,90,100]
const precisionFixtureId = (index: number) => 'e2e00000-0000-4000-a000-'+String(index+2).padStart(12,'0')

export function getE2EScanFixture(id: string): Scan | null {
  if (process.env.E2E_FIXTURE_MODE !== '1') return null
  if (id === E2E_FIXTURE_SCAN_ID) return structuredClone(E2E_FIXTURE_SCAN)
  const index = PRECISION_SCORES.findIndex((_, index) => id === precisionFixtureId(index))
  if (index < 0) return null
  const score = PRECISION_SCORES[index]
  return { ...structuredClone(E2E_FIXTURE_SCAN), id, score, grade: assignGrade(score) }
}
