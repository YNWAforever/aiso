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

import { supabase }         from '@/lib/supabase'
import { getProfile }       from '@/lib/auth'
import { getPlanFeatures }  from '@/lib/tier'
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

  // GEO checks — always run, default to general_b2c / global when not specified
  const geoIndustry = ((industry as string | undefined) ?? 'general_b2c') as IndustryCode
  const geoRegion   = ((region   as string | undefined) ?? 'global')       as RegionCode
  const geoContext  = { industry: geoIndustry, region: geoRegion, clientId: clientId ?? undefined }

  // Fetch sitemap URLs for c19 (Topical Authority) — reuse caller-supplied list or fetch /sitemap.xml
  let sitemapUrlsForGeo: string[] = (sitemapUrls as string[] | undefined) ?? []
  if (!sitemapUrlsForGeo.length) {
    try {
      const sitemapRes = await fetch(`${baseUrl}/sitemap.xml`, {
        headers: { 'User-Agent': 'FimmickAISO/1.0' },
        signal: AbortSignal.timeout(8_000),
      })
      if (sitemapRes.ok) {
        const sitemapXml = await sitemapRes.text()
        const locMatches = sitemapXml.match(/<loc>([^<]+)<\/loc>/g) ?? []
        sitemapUrlsForGeo = locMatches
          .map(m => m.replace(/<\/?loc>/g, '').trim())
          .slice(0, 200)
      }
    } catch { /* sitemap unavailable — c19 will return warn/fail */ }
  }

  let geoScore = 0
  const geoDetails: Record<string, unknown> = {}

  const [c17, c18, c19, c20] = await Promise.allSettled([
    checkCitationDensity(html, baseUrl, geoContext),
    checkFactualDensity(html, geoContext),
    checkTopicalAuthority(sitemapUrlsForGeo, clientId ?? '', geoContext.industry),
    checkChunkability(html, geoContext),
  ])

  const geoKeys    = ['c17_citation_density', 'c18_factual_density', 'c19_topical_authority', 'c20_chunkability'] as const
  const geoChecks  = [c17, c18, c19, c20]
  const geoWeights = [7, 6, 7, 5]
  geoChecks.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      geoScore += r.value.status === 'pass' ? geoWeights[i]! : r.value.status === 'warn' ? geoWeights[i]! * 0.5 : 0
      // Store both the CheckResult (for status/message) and the rich geoDetails under named keys
      const key = geoKeys[i]!
      geoDetails[key] = { status: r.value.status, message: r.value.message, details: r.value.details }
      if ('geoDetails' in r.value && r.value.geoDetails) {
        geoDetails[`${key}_data`] = r.value.geoDetails
      }
    }
  })

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

  // Determine if this is a dashboard-triggered scan (has clientId)
  const isDashboardScan = !!clientId

  const insertPayload: Record<string, unknown> = {
    url: baseUrl, domain,
    score: totalScore,
    results: { ...results, ...geoDetails },
    industry: geoIndustry,
    region:   geoRegion,
    grade,
    account_id,
  }

  if (isDashboardScan) {
    insertPayload.agent_status = 'pending'
  }

  let insertResult: { data: { id: string } | null; error: unknown } = await supabase
    .from('scans')
    .insert(insertPayload)
    .select('id')
    .single()

  // columns from newer migrations may not exist yet on all databases
  if (insertResult.error) {
    // This could fail if agent_status column doesn't exist
    if (isDashboardScan && insertPayload.agent_status) {
      delete insertPayload.agent_status
      insertResult = await supabase
        .from('scans')
        .insert(insertPayload)
        .select('id')
        .single()
    }
  }

  const { data, error } = insertResult
  if (error) return NextResponse.json({ error: 'Database error', detail: (error as { message: string }).message }, { status: 500 })

  // Fire agent webhook if dashboard scan and client has webhook configured
  if (isDashboardScan) {
    const { data: clientData } = await supabase
      .from('clients').select('webhook_url,brand_name').eq('id', clientId).single()

    const webhookUrl = clientData?.webhook_url

    if (webhookUrl) {
      // Determine which platforms to include based on plan
      const plan = account_id
        ? (await supabase.from('accounts').select('plan').eq('id', account_id).single()).data?.plan ?? 'basic'
        : 'basic'
      const features = getPlanFeatures(plan)
      const platforms = features.platform_access

      // Record which platforms were triggered (silently skip if column missing)
      try {
        if (data) {
          await supabase.from('scans')
            .update({ agent_platforms: platforms })
            .eq('id', data.id)
        }
      } catch { /* agent_platforms column may not exist yet */ }

      // Validate webhook URL
      let safe = false
      try {
        const parsed = new URL(webhookUrl)
        safe = parsed.protocol === 'https:' &&
               parsed.hostname !== 'localhost' &&
               !parsed.hostname.startsWith('127.') &&
               !parsed.hostname.startsWith('169.254.') &&
               !parsed.hostname.startsWith('10.') &&
               !parsed.hostname.match(/^172\.(1[6-9]|2\d|3[01])\./) &&
               !parsed.hostname.startsWith('192.168.')
      } catch { /* invalid URL */ }

      if (safe && data) {
        fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId,
            brandName: clientData?.brand_name ?? '',
            domain,
            industry: geoIndustry,
            scanId: data.id,
            score: totalScore,
            grade,
            platforms,  // only the platforms the user paid for
            results: { ...results, ...geoDetails },
          }),
          signal: AbortSignal.timeout(5_000),
        }).catch(err => console.error('[scan] webhook trigger failed:', err))
      } else {
        console.error('[scan] invalid webhook URL:', webhookUrl)
      }
    }
  }

  if (!data) return NextResponse.json({ error: 'Insert returned no data' }, { status: 500 })

  // Fire n8n AISO Scan Webhook (fire-and-forget — never blocks the response)
  const n8nWebhook = process.env.N8N_SCAN_WEBHOOK_URL
  if (n8nWebhook) {
    fetch(n8nWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scanId:   data.id,
        clientId: clientId ?? null,
        domain,
        score:    totalScore,
        grade,
        results:  { ...results, ...geoDetails },
      }),
      signal: AbortSignal.timeout(5_000),
    }).catch(err => console.error('[scan] n8n webhook failed:', err))
  }

  return NextResponse.json({ id: data.id, score: totalScore, grade, results: { ...results, ...geoDetails } })
}
