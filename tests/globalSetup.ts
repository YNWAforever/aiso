/**
 * Playwright globalSetup — seeds a test scan row in Supabase before E2E tests.
 *
 * The result page is SSR and fetches from Supabase server-side.
 * page.route() cannot intercept SSR calls, so we seed a real row.
 *
 * Requires migration 020_scans_public_select.sql to be applied so the
 * anon key can read the seeded row on the result page.
 */
import fs from 'fs'
import path from 'path'
import { TEST_SCAN_ID } from './constants'

export { TEST_SCAN_ID }

export default async function globalSetup() {
  // Load env vars from .env.local if not already in environment
  const envPath = path.join(process.cwd(), '.env.local')
  let serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  let supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

  if ((!serviceKey || !supabaseUrl) && fs.existsSync(envPath)) {
    const env = fs.readFileSync(envPath, 'utf-8')
    for (const line of env.split('\n')) {
      const eqIdx = line.indexOf('=')
      if (eqIdx < 0) continue
      const key = line.slice(0, eqIdx).trim()
      const val = line.slice(eqIdx + 1).trim()
      if (key === 'SUPABASE_SERVICE_ROLE_KEY' && !serviceKey) serviceKey = val
      if (key === 'NEXT_PUBLIC_SUPABASE_URL'  && !supabaseUrl) supabaseUrl = val
    }
  }

  if (!serviceKey || !supabaseUrl) {
    console.warn('[globalSetup] Missing Supabase credentials — email-gate E2E tests will skip.')
    return
  }

  const checksStub = buildChecksStub()

  const res = await fetch(`${supabaseUrl}/rest/v1/scans`, {
    method: 'POST',
    headers: {
      apikey:        serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer:        'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify([{
      id:         TEST_SCAN_ID,
      account_id: null,
      url:        'https://e2e-test.example.com',
      domain:     'e2e-test.example.com',
      score:      63.50,
      results:    checksStub,
      checks:     checksStub,
      lead_email: null,
      created_at: '2026-01-01T00:00:00.000Z',
    }]),
  })

  if (!res.ok) {
    console.warn(`[globalSetup] Could not seed test scan: ${res.status} ${await res.text()}`)
  } else {
    console.log(`[globalSetup] Test scan seeded — ID: ${TEST_SCAN_ID}`)
  }
}

function buildChecksStub() {
  const pass = (msg: string) => ({ status: 'pass', message: msg })
  const fail = (msg: string) => ({ status: 'fail', message: msg })
  const warn = (msg: string) => ({ status: 'warn', message: msg })
  return {
    c1_robots:             pass('robots_ai_allowed'),
    c2_llms_txt:           fail('llms_txt_missing'),
    c3_bot_access:         pass('bots_all_accessible'),
    c4_structured_data:    warn('structured_data_found'),
    c5_extractability:     pass('extractability_good'),
    c6_llms_full_txt:      fail('llms_full_txt_missing'),
    c7_mcp_card:           fail('mcp_card_missing'),
    c8_sitemap:            pass('sitemap_found'),
    c9_meta_description:   pass('meta_desc_good'),
    c10_headings:          pass('headings_ok'),
    c11_faq:               fail('faq_missing'),
    c12_canonical:         pass('canonical_ok'),
    c13_server_text:       pass('render_ok'),
    c14_internal_links:    warn('links_few'),
    c15_entity_signals:    pass('entities_ok'),
    c16_freshness:         warn('freshness_stale'),
    c17_citation_density:  { ...fail('citations_low'),  geoDetails: { qualityScore: 30, authorityBreakdown: { tier1: 0, tier2: 1, tier3: 2, other: 2 }, citationsPerK: 0.8, details: [] } },
    c18_factual_density:   { ...fail('factual_low'),    geoDetails: { qualityScore: 25, numberDensityPct: 0.3, hasComparisons: false } },
    c19_topical_authority: { ...warn('authority_thin'), geoDetails: { topicalCoverageScore: 40, totalClusters: 1, orphanPages: 3 } },
    c20_chunkability:      { ...pass('chunks_ok'),      geoDetails: { optimalChunkRatio: 0.6, totalChunks: 8, hasFaqStyle: false } },
  }
}
