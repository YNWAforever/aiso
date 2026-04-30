import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'

// Core checks
import { checkRobots }         from '@/lib/checks/robots'
import { checkLlmsTxt }        from '@/lib/checks/llmsTxt'
import { checkBotAccess }      from '@/lib/checks/botAccess'
import { checkStructuredData } from '@/lib/checks/structuredData'
import { checkExtractability } from '@/lib/checks/extractability'
// Extended checks
import { checkLlmsFullTxt }    from '@/lib/checks/llmsFullTxt'
import { checkMcpCard }        from '@/lib/checks/mcpCard'
import { checkSitemap }        from '@/lib/checks/sitemap'
import { checkMetaDescription } from '@/lib/checks/metaDescription'
import { checkHeadingStructure } from '@/lib/checks/headingStructure'
import { checkFaqDetection }   from '@/lib/checks/faqDetection'
import { checkCanonical }      from '@/lib/checks/canonical'
import { checkServerText }     from '@/lib/checks/serverText'
import { checkInternalLinks }  from '@/lib/checks/internalLinks'
import { checkEntitySignals }  from '@/lib/checks/entitySignals'
import { checkContentFreshness } from '@/lib/checks/contentFreshness'
// GEO checks
import { checkCitationDensity }  from '@/lib/checks/citationDensity'
import { checkFactualDensity }   from '@/lib/checks/factualDensity'
import { checkTopicalAuthority } from '@/lib/checks/topicalAuthority'
import { checkChunkability }     from '@/lib/checks/chunkability'

import { supabase }   from '@/lib/supabase'
import { getProfile } from '@/lib/auth'
import type { CheckResult, ScanResults, IndustryCode, RegionCode } from '@/lib/types'

// ── Scoring: Core 45 + Extended 30 + GEO 25 = 100 ────────────────
const CORE_PTS = {
  c1_robots:          12,
  c2_llms_txt:        10,
  c3_bot_access:      10,
  c4_structured_data:  7,
  c5_extractability:   6,
} as const // total 45

const EXT_PTS = {
  c6_llms_full_txt:    3,
  c7_mcp_card:         3,
  c8_sitemap:          3,
  c9_meta_desc:        2,
  c10_headings:        3,
  c11_faq:             3,
  c12_canonical:       2,
  c13_render:          3,
  c14_internal_links:  3,
  c15_entity:          3,
  c16_freshness:       2,
} as const // total 30

function scorePts(result: CheckResult, weight: number): number {
  return result.status === 'pass' ? weight : result.status === 'warn' ? weight * 0.5 : 0
}

/** Exported for tests — computes score from a full results object */
export function calculateScore(results: ScanResults): number {
  const core = (Object.keys(CORE_PTS) as Array<keyof typeof CORE_PTS>)
    .reduce((s, k) => s + scorePts(results[k], CORE_PTS[k]), 0)
  const ext  = (Object.keys(EXT_PTS)  as Array<keyof typeof EXT_PTS>)
    .reduce((s, k) => s + scorePts((results as unknown as Record<string, CheckResult>)[k] ?? { status: 'fail', message: '' }, EXT_PTS[k]), 0)
  return core + ext
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { url, industry, region, clientId, sitemapUrls } = body
  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }

  let baseUrl: string
  let domain: string
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`)
    baseUrl = parsed.origin
    domain  = parsed.hostname
  } catch {
    return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 })
  }

  // Fetch page HTML once — shared by extended checks + GEO checks
  let html = ''
  try {
    const htmlRes = await fetch(baseUrl, {
      headers: { 'User-Agent': 'FimmickAISO/1.0' },
      signal: AbortSignal.timeout(15_000),
    })
    html = await htmlRes.text()
  } catch { /* continue without HTML — checks degrade gracefully */ }

  // Run all 16 checks (5 core + 11 extended) in parallel
  const [c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12, c13, c14, c15, c16] =
    await Promise.allSettled([
      // Core (URL-fetch)
      checkRobots(baseUrl),
      checkLlmsTxt(baseUrl),
      checkBotAccess(baseUrl),
      checkStructuredData(baseUrl),
      checkExtractability(baseUrl),
      // Extended — URL-fetch
      checkLlmsFullTxt(baseUrl),
      checkMcpCard(baseUrl, html),
      checkSitemap(baseUrl),
      // Extended — HTML parse (sync, wrapped so allSettled handles uniformly)
      Promise.resolve(checkMetaDescription(html, baseUrl)),
      Promise.resolve(checkHeadingStructure(html, baseUrl)),
      Promise.resolve(checkFaqDetection(html, baseUrl)),
      Promise.resolve(checkCanonical(html, baseUrl)),
      Promise.resolve(checkServerText(html, baseUrl)),
      Promise.resolve(checkInternalLinks(html, baseUrl)),
      Promise.resolve(checkEntitySignals(html, baseUrl)),
      Promise.resolve(checkContentFreshness(html, baseUrl)),
    ])

  const err = { status: 'fail' as const, message: 'check_error' }
  const get = <T>(r: PromiseSettledResult<T>, fallback: T): T =>
    r.status === 'fulfilled' ? r.value : fallback

  const coreResults = {
    c1_robots:          get(c1,  err),
    c2_llms_txt:        get(c2,  err),
    c3_bot_access:      get(c3,  err),
    c4_structured_data: get(c4,  err),
    c5_extractability:  get(c5,  err),
  }
  const extResults = {
    c6_llms_full_txt:   get(c6,  err),
    c7_mcp_card:        get(c7,  err),
    c8_sitemap:         get(c8,  err),
    c9_meta_desc:       get(c9,  err),
    c10_headings:       get(c10, err),
    c11_faq:            get(c11, err),
    c12_canonical:      get(c12, err),
    c13_render:         get(c13, err),
    c14_internal_links: get(c14, err),
    c15_entity:         get(c15, err),
    c16_freshness:      get(c16, err),
  }

  const results: ScanResults = { ...coreResults, ...extResults }

  const coreScore = (Object.keys(CORE_PTS) as Array<keyof typeof CORE_PTS>)
    .reduce((s, k) => s + scorePts(coreResults[k], CORE_PTS[k]), 0)
  const extScore  = (Object.keys(EXT_PTS)  as Array<keyof typeof EXT_PTS>)
    .reduce((s, k) => s + scorePts(extResults[k],  EXT_PTS[k]),  0)
  const score = coreScore + extScore   // 0–75 before GEO

  // GEO checks — only when industry + region context provided
  let geoScore = 0
  const geoDetails: Record<string, unknown> = {}

  if (industry && region) {
    const context = { industry: industry as IndustryCode, region: region as RegionCode, clientId }

    const [c17, c18, c19, c20] = await Promise.allSettled([
      checkCitationDensity(html, baseUrl, context),
      checkFactualDensity(html, context),
      checkTopicalAuthority(sitemapUrls ?? [], clientId ?? '', context.industry),
      checkChunkability(html, context),
    ])

    const geoChecks  = [c17, c18, c19, c20]
    const geoWeights = [7, 6, 7, 5]
    geoChecks.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        geoScore += r.value.status === 'pass' ? geoWeights[i]! : r.value.status === 'warn' ? geoWeights[i]! * 0.5 : 0
        if ('geoDetails' in r.value && r.value.geoDetails) geoDetails[`c${17 + i}`] = r.value.geoDetails
      }
    })
  }

  const totalScore = Math.min(100, score + geoScore)
  const grade =
    totalScore >= 90 ? 'A+' :
    totalScore >= 80 ? 'A'  :
    totalScore >= 70 ? 'B'  :
    totalScore >= 60 ? 'C'  :
    totalScore >= 50 ? 'D'  : 'F'

  // Attach to user account if logged in
  let account_id: string | null = null
  try {
    const profile = await getProfile()
    account_id = profile?.account_id ?? null
  } catch { /* no auth — continue */ }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    console.error('[scan] NEXT_PUBLIC_SUPABASE_URL is not configured')
    return NextResponse.json({ error: 'Server misconfiguration: missing Supabase URL' }, { status: 500 })
  }

  const { data, error } = await supabase
    .from('scans')
    .insert({
      url: baseUrl, domain,
      score: totalScore,
      results: { ...results, ...geoDetails },
      industry: industry ?? null,
      region:   region   ?? null,
      grade,
      account_id,
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: 'Database error', detail: error.message }, { status: 500 })

  return NextResponse.json({ id: data.id, score: totalScore, grade, results: { ...results, ...geoDetails } })
}
