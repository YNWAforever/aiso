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

import { db }               from '@/lib/db'
import { getProfile }       from '@/lib/auth'
import { getPlanFeatures }  from '@/lib/tier'
import { GEO_PTS, assignGrade, calculateScore, calculateGeoScore } from '@/lib/scoring'
import type { ScanResults, IndustryCode, RegionCode } from '@/lib/types'

// Re-exported for existing tests that import scoring from this route
export { assignGrade, calculateScore, calculateGeoScore }

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

  const score = calculateScore(results)   // 0–75 before GEO

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

  const geoDetails: Record<string, unknown> = {}

  const [c17, c18, c19, c20] = await Promise.allSettled([
    checkCitationDensity(html, baseUrl, geoContext),
    checkFactualDensity(html, geoContext),
    checkTopicalAuthority(sitemapUrlsForGeo, clientId ?? '', geoContext.industry),
    checkChunkability(html, geoContext),
  ])

  // Settle-with-fallback first, same pattern as coreResults/extResults above —
  // scoring and geoDetails extraction then both read from the same finished object.
  const geoResults = {
    c17_citation_density:  get(c17, err),
    c18_factual_density:   get(c18, err),
    c19_topical_authority: get(c19, err),
    c20_chunkability:      get(c20, err),
  }

  const geoScore = calculateGeoScore(geoResults)

  for (const key of Object.keys(GEO_PTS) as Array<keyof typeof GEO_PTS>) {
    const r = geoResults[key]
    // Store both the CheckResult (for status/message) and the rich geoDetails under named keys
    geoDetails[key] = { status: r.status, message: r.message, details: (r as { details?: unknown }).details }
    if ('geoDetails' in r && r.geoDetails) {
      geoDetails[`${key}_data`] = r.geoDetails
    }
  }

  const totalScore = Math.min(100, score + geoScore)
  const grade = assignGrade(totalScore)

  // Attach to user account if logged in
  let account_id: string | null = null
  try {
    const profile = await getProfile()
    account_id = profile?.account_id ?? null
  } catch { /* no auth — continue */ }

  if (!process.env.DATABASE_URL) {
    console.error('[scan] DATABASE_URL is not configured')
    return NextResponse.json({ error: 'Server misconfiguration: missing DATABASE_URL' }, { status: 500 })
  }

  // Determine if this is a dashboard-triggered scan (has clientId)
  const isDashboardScan = !!clientId

  const sql = db()
  let scanId: string
  try {
    const rows = await sql`
      insert into scans (url, domain, score, results, industry, region, grade, account_id, agent_status)
      values (${baseUrl}, ${domain}, ${totalScore},
              ${JSON.stringify({ ...results, ...geoDetails })}::jsonb,
              ${geoIndustry}, ${geoRegion}, ${grade}, ${account_id},
              ${isDashboardScan ? 'pending' : null})
      returning id
    `
    const inserted = rows[0] as { id: string } | undefined
    if (!inserted) return NextResponse.json({ error: 'Insert returned no data' }, { status: 500 })
    scanId = inserted.id
  } catch (dbErr) {
    console.error('[scan] DB insert failed:', (dbErr as Error)?.message ?? String(dbErr))
    return NextResponse.json({ error: 'Database error — check Neon configuration' }, { status: 500 })
  }

  // Fire agent webhook if dashboard scan and client has webhook configured
  if (isDashboardScan) {
    let clientData: { webhook_url: string | null; brand_name: string | null } | undefined
    try {
      const rows = await sql`select webhook_url, brand_name from clients where id = ${clientId} limit 1`
      clientData = rows[0] as typeof clientData
    } catch (err) {
      console.error('[scan] client lookup failed:', (err as Error)?.message ?? String(err))
    }

    const webhookUrl = clientData?.webhook_url

    if (webhookUrl) {
      // Determine which platforms to include based on plan
      let plan = 'basic'
      if (account_id) {
        try {
          const rows = await sql`select plan from accounts where id = ${account_id} limit 1`
          plan = (rows[0] as { plan: string } | undefined)?.plan ?? 'basic'
        } catch { /* default to basic */ }
      }
      const features = getPlanFeatures(plan)
      const platforms = features.platform_access

      // Record which platforms were triggered
      try {
        await sql`update scans set agent_platforms = ${platforms} where id = ${scanId}`
      } catch { /* non-fatal — webhook payload still carries platforms */ }

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

      if (safe) {
        fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId,
            brandName: clientData?.brand_name ?? '',
            domain,
            industry: geoIndustry,
            scanId,
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

  // Fire n8n AISO Scan Webhook (fire-and-forget — never blocks the response)
  const n8nWebhook = process.env.N8N_SCAN_WEBHOOK_URL
  if (n8nWebhook) {
    fetch(n8nWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scanId,
        clientId: clientId ?? null,
        domain,
        score:    totalScore,
        grade,
        results:  { ...results, ...geoDetails },
      }),
      signal: AbortSignal.timeout(5_000),
    }).catch(err => console.error('[scan] n8n webhook failed:', err))
  }

  return NextResponse.json({ id: scanId, score: totalScore, grade, results: { ...results, ...geoDetails } })
}
