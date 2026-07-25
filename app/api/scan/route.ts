import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

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
import { resolveCommercialEntitlement } from '@/lib/tier'
import { createServiceSupabaseClient } from '@/lib/supabase-server'
import { fetchPublicUrl, PublicUrlError } from '@/lib/security/public-url'
import { consumePublicScanRateLimit, rateLimitHeaders } from '@/lib/security/public-scan-rate-limit'
import { consumeAuthenticatedScanQuota, authenticatedScanQuotaHeaders } from '@/lib/security/authenticated-scan-quota'
import { GEO_PTS, assignGrade, calculateScore, calculateGeoScore } from '@/lib/scoring'
import type { ScanResults, IndustryCode, RegionCode } from '@/lib/types'

// Re-exported for existing tests that import scoring from this route
export { assignGrade, calculateScore, calculateGeoScore }

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { url, industry, region, sitemapUrls, clientId: requestedClientId } =
    body as Record<string, unknown>
  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }

  let baseUrl: string
  let domain: string
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : 'https://' + url)
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) {
      return NextResponse.json({ error: 'URL must use HTTP or HTTPS without credentials' }, { status: 400 })
    }
    baseUrl = parsed.origin
    domain = parsed.hostname
  } catch {
    return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 })
  }

  let profile: Awaited<ReturnType<typeof getProfile>> = null
  let profileLookupFailed = false
  try {
    profile = await getProfile()
  } catch (error) {
    profileLookupFailed = true
    console.error('[scan] authentication lookup failed:', (error as Error)?.message ?? String(error))
  }
  if (profileLookupFailed) {
    return NextResponse.json({ error: 'Authentication service unavailable' }, { status: 503 })
  }

  type OwnedClient = {
    id: string
    account_id: string
    webhook_url: string | null
    brand_name: string | null
  }
  let ownedClient: OwnedClient | null = null
  if (requestedClientId !== undefined && requestedClientId !== null && requestedClientId !== '') {
    if (typeof requestedClientId !== 'string') {
      return NextResponse.json({ error: 'Invalid clientId' }, { status: 400 })
    }
    if (!profile) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    try {
      const service = await createServiceSupabaseClient()
      const { data, error } = await service
        .from('clients')
        .select('id, account_id, webhook_url, brand_name')
        .eq('id', requestedClientId)
        .maybeSingle()
      if (error) {
        console.error('[scan] client ownership lookup failed:', error.message)
        return NextResponse.json({ error: 'Client lookup failed' }, { status: 500 })
      }
      if (!data) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
      if (data.account_id !== profile.account_id) {
        return NextResponse.json({ error: 'Client access forbidden' }, { status: 403 })
      }
      ownedClient = data as OwnedClient
    } catch (error) {
      console.error('[scan] client ownership verification failed:', (error as Error)?.message ?? String(error))
      return NextResponse.json({ error: 'Client lookup failed' }, { status: 500 })
    }
  }

  if (!process.env.DATABASE_URL) {
    console.error('[scan] DATABASE_URL is not configured')
    return NextResponse.json({ error: 'Server misconfiguration: missing DATABASE_URL' }, { status: 500 })
  }

  const entitlement = resolveCommercialEntitlement(profile?.accounts)
  let scanHeaders: Headers | undefined
  if (!profile || (entitlement.plan === 'free' && !ownedClient)) {
    try {
      const decision = await consumePublicScanRateLimit(req)
      scanHeaders = rateLimitHeaders(decision)
      if (!decision.allowed) {
        return NextResponse.json(
          { error: 'Too many scan requests. Please try again later.' },
          { status: 429, headers: scanHeaders },
        )
      }
    } catch (error) {
      console.error('[scan] durable rate limiter failed:', (error as Error)?.message ?? String(error))
      return NextResponse.json({ error: 'Public scan temporarily unavailable' }, { status: 503 })
    }
  } else if (entitlement.plan === 'free') {
    return NextResponse.json({ error: 'AUTHENTICATED_SCAN_UPGRADE_REQUIRED' }, { status: 403 })
  } else if (entitlement.monthlyScanLimit !== null) {
    try {
      const decision = await consumeAuthenticatedScanQuota(profile.account_id)
      scanHeaders = authenticatedScanQuotaHeaders(decision)
      if (!decision.allowed) {
        return NextResponse.json(
          { error: 'AUTHENTICATED_SCAN_LIMIT_REACHED' },
          { status: 429, headers: scanHeaders },
        )
      }
    } catch (error) {
      console.error('[scan] authenticated quota failed:', (error as Error)?.message ?? String(error))
      return NextResponse.json({ error: 'Authenticated scan quota unavailable' }, { status: 503 })
    }
  }

  const account_id = profile?.account_id ?? null
  const clientId = ownedClient?.id

  // Fetch page HTML once — shared by extended checks + GEO checks.
  // The reusable boundary validates DNS and every redirect hop.
  let html = ''
  try {
    const htmlRes = await fetchPublicUrl(baseUrl, {
      headers: { 'User-Agent': 'FimmickAISO/1.0' },
      signal: AbortSignal.timeout(15_000),
    })
    html = await htmlRes.text()
  } catch (error) {
    if (error instanceof PublicUrlError) {
      return NextResponse.json({ error: 'URL must resolve to a public HTTP or HTTPS address' }, {
        status: 400,
        headers: scanHeaders,
      })
    }
    // Continue without HTML — checks degrade gracefully for ordinary network failures.
  }

  // Run all 16 checks (5 core + 11 extended) in parallel
  const [c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12, c13, c14, c15, c16] =
    await Promise.allSettled([
      // Core (URL-fetch)
      checkRobots(baseUrl, fetchPublicUrl),
      checkLlmsTxt(baseUrl, fetchPublicUrl),
      checkBotAccess(baseUrl, fetchPublicUrl),
      checkStructuredData(baseUrl, fetchPublicUrl),
      checkExtractability(baseUrl, fetchPublicUrl),
      // Extended — URL-fetch
      checkLlmsFullTxt(baseUrl, fetchPublicUrl),
      checkMcpCard(baseUrl, html),
      checkSitemap(baseUrl, fetchPublicUrl),
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
  const geoContext  = { industry: geoIndustry, region: geoRegion, clientId: clientId }

  // Fetch sitemap URLs for c19 (Topical Authority) — reuse caller-supplied list or fetch /sitemap.xml
  let sitemapUrlsForGeo: string[] = (sitemapUrls as string[] | undefined) ?? []
  if (!sitemapUrlsForGeo.length) {
    try {
      const sitemapRes = await fetchPublicUrl(new URL('/sitemap.xml', baseUrl), {
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

  // Dashboard behavior is enabled only for the already verified owned client.
  const isDashboardScan = !!ownedClient

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

  // Fire agent webhook only for the service-client-verified owned client.
  if (isDashboardScan && ownedClient) {
    const webhookUrl = ownedClient.webhook_url
    if (webhookUrl) {
      const features = entitlement.features
      const platforms = features.platform_access

      try {
        await sql`update scans set agent_platforms = ${platforms} where id = ${scanId}`
      } catch { /* non-fatal — webhook payload still carries platforms */ }

      void fetchPublicUrl(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          brandName: ownedClient.brand_name ?? '',
          domain,
          industry: geoIndustry,
          scanId,
          score: totalScore,
          grade,
          platforms,
          results: { ...results, ...geoDetails },
        }),
        signal: AbortSignal.timeout(5_000),
      }).catch(error => console.error('[scan] webhook trigger failed:', error))
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

  return NextResponse.json(
    { id: scanId, score: totalScore, grade },
    { headers: scanHeaders },
  )
}
