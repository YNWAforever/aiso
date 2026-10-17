import { after, NextRequest, NextResponse } from 'next/server'
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
import { type AgentRequirements } from '@/lib/agents'
import { generateImprove } from '@/lib/agents/generate'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { fetchPublicUrl, PublicUrlError } from '@/lib/security/public-url'
import { consumePublicScanRateLimit, rateLimitHeaders } from '@/lib/security/public-scan-rate-limit'
import { parseSitemapUrls } from '@/lib/security/sitemap-urls'
import { consumeAuthenticatedScanQuota, authenticatedScanQuotaHeaders, releaseAuthenticatedScanQuota } from '@/lib/security/authenticated-scan-quota'
import { GEO_PTS, assignGrade, calculateScore, calculateGeoScore, capScore } from '@/lib/scoring'
import { calculatePillarScores } from '@/lib/pillar-scores'
import { buildScanEvidence, CHECK_VERSIONS, type EvidenceCheckKey } from '@/lib/scan-evidence'
import { createScanEvidenceCapture } from '@/lib/scan-evidence-capture'
import { fetchSitemapPageUrls } from '@/lib/sitemap-fetch'
import { createSummaryReceipt } from '@/lib/n8n/schema'
import { dispatchScanSummary } from '@/lib/n8n/dispatch'

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/i

/**
 * Whether a hostname can name a public website at all: an IP literal, or a
 * dotted name with no empty label and an alphabetic (or punycode) TLD. This is
 * a shape check only; whether the address is public is fetchPublicUrl's job.
 */
function isScannableHost(hostname: string): boolean {
  if (IPV4.test(hostname) || hostname.startsWith('[')) return true
  // A fully qualified name may end in one dot ("example.com.").
  const labels = (hostname.endsWith('.') ? hostname.slice(0, -1) : hostname).split('.')
  return labels.length >= 2 && labels.every(Boolean) && TLD.test(labels[labels.length - 1]!)
}
import type { ScanResults, IndustryCode, RegionCode } from '@/lib/types'
import { normalizeScanUrl } from '@/lib/scan-input'
import { assessTrustSignals } from '@/lib/trust-signals'

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

  const { url, industry, region, sitemapUrls, clientId: requestedClientId, requestKey } =
    body as Record<string, unknown>
  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }
  if (requestKey !== undefined && requestKey !== null
    && (typeof requestKey !== 'string' || requestKey.length < 8 || requestKey.length > 128)) {
    return NextResponse.json({ error: 'Invalid requestKey' }, { status: 400 })
  }

  let baseUrl: string
  let domain: string
  try {
    const parsed = new URL(normalizeScanUrl(url))
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) {
      return NextResponse.json({ error: 'URL must use HTTP or HTTPS without credentials' }, { status: 400 })
    }
    baseUrl = parsed.origin
    domain = parsed.hostname
  } catch {
    return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 })
  }
  // A host that can never be a public website ("not-a-valid-url") is refused
  // here, before any rate limit or quota is spent. It used to reach the page
  // fetch, fail DNS, degrade every check and be saved with a grade.
  if (!isScannableHost(domain)) {
    return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 })
  }

  // Validated here, at the trust boundary, rather than where it is consumed:
  // everything between this point and the GEO batch — the session lookup, the
  // client-ownership query, rate-limit consumption, the blocking page fetch —
  // is work a malformed body should never buy. These URLs also reach an LLM
  // prompt in checkTopicalAuthority, on a route anonymous callers can reach.
  const parsedSitemapUrls = parseSitemapUrls(sitemapUrls)
  if (!parsedSitemapUrls.ok) {
    return NextResponse.json({ error: 'Invalid sitemapUrls' }, { status: 400 })
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
  const sql = db()
  let ownedClient: OwnedClient | null = null
  if (requestedClientId !== undefined && requestedClientId !== null && requestedClientId !== '') {
    if (typeof requestedClientId !== 'string') {
      return NextResponse.json({ error: 'Invalid clientId' }, { status: 400 })
    }
    if (!profile) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    try {
      // Filter by id only here — account ownership is verified explicitly
      // below so a not-found id (404) stays distinguishable from a client
      // that exists but belongs to another account (403).
      const rows = await sql`
        select id, account_id, webhook_url, brand_name
        from clients
        where id = ${requestedClientId}
        limit 1
      `
      const clientRow = rows[0] as OwnedClient | undefined
      if (!clientRow) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
      if (clientRow.account_id !== profile.account_id) {
        return NextResponse.json({ error: 'Client access forbidden' }, { status: 403 })
      }
      ownedClient = clientRow
    } catch (error) {
      console.error('[scan] client ownership verification failed:', (error as Error)?.message ?? String(error))
      return NextResponse.json({ error: 'Client lookup failed' }, { status: 500 })
    }
  }

  if (!process.env.DATABASE_URL) {
    console.error('[scan] DATABASE_URL is not configured')
    return NextResponse.json({ error: 'Server misconfiguration: missing DATABASE_URL' }, { status: 500 })
  }

  const account_id = profile?.account_id ?? null
  const clientId = ownedClient?.id
  const geoIndustry = ((industry as string | undefined) ?? 'general_b2c') as IndustryCode
  const geoRegion   = ((region   as string | undefined) ?? 'global')       as RegionCode

  // First-use scans are claimed before any check runs. The browser keeps one
  // requestKey per unchanged setup, so a double click, reload or Back resolves
  // to this row instead of paying for a second scan. The claim lives in the
  // existing scans row (results._scan_request) so no schema change is needed.
  const claimKey = ownedClient && account_id && typeof requestKey === 'string' ? requestKey : null
  const PROCESSING_CLAIM_TTL_MS = 2 * 60_000
  let claimId: string | null = null
  const claimResults = (state: 'processing' | 'failed' | 'complete', extra: Record<string, unknown> = {}) => ({
    _scan_request: {
      key: claimKey, state, startedAt: new Date().toISOString(), ...extra,
    },
  })
  const markClaimFailed = async (error: string, status: number) => {
    if (!claimId) return
    try {
      await sql`
        update scans
        set results = jsonb_set(results, '{_scan_request}',
          ${JSON.stringify(claimResults('failed', { error, status, finishedAt: new Date().toISOString() })._scan_request)}::jsonb, true)
        where id = ${claimId} and account_id = ${account_id}
      `
    } catch (markError) {
      console.error('[scan] claim failure marker failed:', (markError as Error)?.name ?? 'Error')
    }
  }
  if (claimKey) {
    try {
      const existing = await sql`
        select id, score, grade, created_at, results
        from scans
        where account_id = ${account_id} and client_id = ${clientId}
          and results @> ${JSON.stringify({ _scan_request: { key: claimKey } })}::jsonb
        order by created_at asc
        limit 1
      `
      const row = existing[0] as {
        id: string; score: number | string | null; grade: string | null
        created_at: string; results?: Record<string, unknown>
      } | undefined
      if (row) {
        const run = (row.results?._scan_request ?? {}) as Record<string, unknown>
        const savedScore = row.score === null ? null : Number(row.score)
        if (savedScore !== null && Number.isFinite(savedScore)) {
          return NextResponse.json({ id: row.id, score: savedScore, grade: row.grade, reused: true })
        }
        if (run.state === 'failed') {
          const status = typeof run.status === 'number' && run.status >= 400 && run.status <= 599 ? run.status : 502
          return NextResponse.json({
            error: typeof run.error === 'string' ? run.error : 'SCAN_FAILED',
            scanId: row.id, state: 'failed', reused: true,
          }, { status })
        }
        const started = typeof run.startedAt === 'string' ? run.startedAt : row.created_at
        const age = Date.now() - new Date(started).getTime()
        if (!Number.isFinite(age) || age < PROCESSING_CLAIM_TTL_MS) {
          return NextResponse.json({ id: row.id, state: 'processing', reused: true }, { status: 202 })
        }
        // The original request died mid-scan. Reuse its row instead of
        // inserting a second one; only one retry can win this conditional update.
        const takeover = await sql`
          update scans
          set results = jsonb_set(results, '{_scan_request}',
            ${JSON.stringify(claimResults('processing')._scan_request)}::jsonb, true)
          where id = ${row.id} and account_id = ${account_id}
            and results->'_scan_request'->>'state' = 'processing'
          returning id
        `
        if (!takeover[0]) return NextResponse.json({ id: row.id, state: 'processing', reused: true }, { status: 202 })
        claimId = row.id
      }
      if (!claimId) {
        const claimed = await sql`
          insert into scans (url, domain, score, results, industry, region, grade, account_id, agent_status, client_id)
          values (${baseUrl}, ${domain}, null, ${JSON.stringify(claimResults('processing'))}::jsonb,
                  ${geoIndustry}, ${geoRegion}, null, ${account_id}, null, ${clientId})
          returning id
        `
        const claimedRow = claimed[0] as { id: string } | undefined
        if (!claimedRow) return NextResponse.json({ error: 'Insert returned no data' }, { status: 500 })
        claimId = claimedRow.id
      }
    } catch (claimError) {
      console.error('[scan] request claim failed:', (claimError as Error)?.message ?? String(claimError))
      return NextResponse.json({ error: 'Scan request unavailable' }, { status: 503 })
    }
  }

  const entitlement = resolveCommercialEntitlement(profile?.accounts)
  let scanHeaders: Headers | undefined
  // Set once a monthly scan has been spent, so a scan that turns out to have
  // nothing to assess can give it back.
  let quotaSpentBy: string | null = null
  if (!profile || (entitlement.plan === 'free' && !ownedClient)) {
    try {
      const decision = await consumePublicScanRateLimit(req)
      scanHeaders = rateLimitHeaders(decision)
      if (!decision.allowed) {
        await markClaimFailed('Too many scan requests. Please try again later.', 429)
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
        await markClaimFailed('AUTHENTICATED_SCAN_LIMIT_REACHED', 429)
        return NextResponse.json(
          { error: 'AUTHENTICATED_SCAN_LIMIT_REACHED' },
          { status: 429, headers: scanHeaders },
        )
      }
      quotaSpentBy = profile.account_id
    } catch (error) {
      console.error('[scan] authenticated quota failed:', (error as Error)?.message ?? String(error))
      await markClaimFailed('Authenticated scan quota unavailable', 503)
      return NextResponse.json({ error: 'Authenticated scan quota unavailable' }, { status: 503 })
    }
  }

  // Fetch page HTML once — shared by extended checks + GEO checks.
  // The reusable boundary validates DNS and every redirect hop.
  const capture = createScanEvidenceCapture(fetchPublicUrl)
  // Nothing is saved on any refusal below, so the monthly scan it spent is
  // given back. A failed refund is logged, not surfaced: the refusal is still
  // the true answer.
  const refuse = async (error: string, status: number) => {
    await markClaimFailed(error, status)
    if (quotaSpentBy) {
      try {
        await releaseAuthenticatedScanQuota(quotaSpentBy)
      } catch (releaseError) {
        console.error('[scan] quota refund failed:', (releaseError as Error)?.name ?? 'Error')
      }
    }
    return NextResponse.json({ error }, { status, headers: scanHeaders })
  }
  let html = ''
  let htmlRes: Response
  try {
    htmlRes = await capture.forCheck('page')(baseUrl, {
      headers: { 'User-Agent': 'FimmickAISO/1.0' },
      signal: AbortSignal.timeout(15_000),
    })
  } catch (error) {
    if (error instanceof PublicUrlError) {
      await markClaimFailed('URL must resolve to a public HTTP or HTTPS address', 400)
      return NextResponse.json({ error: 'URL must resolve to a public HTTP or HTTPS address' }, {
        status: 400,
        headers: scanHeaders,
      })
    }
    // No HTTP response at all (DNS failure, refused connection, timeout): there
    // is no site to assess, so nothing is graded or saved.
    console.error('[scan] page unreachable:', (error as Error)?.name ?? 'Error')
    return refuse('SCAN_UNREACHABLE', 422)
  }
  // An access denial (401/403/429) is still scanned: refusing the scanner is
  // exactly what the bot-access check exists to report. Any other failed
  // status, a non-HTML body or an empty page gives no basis for scoring
  // content, so nothing is graded or saved.
  const accessDenied = [401, 403, 429].includes(htmlRes.status)
  const contentType = htmlRes.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
  if (!accessDenied && (!htmlRes.ok
    || (contentType && !['text/html', 'application/xhtml+xml', 'text/plain'].includes(contentType)))) {
    return refuse('SCAN_PAGE_UNAVAILABLE', 502)
  }
  let readFailed = false
  try {
    html = await htmlRes.text()
  } catch {
    // The site answered but its body could not be read: still a site, so
    // checks degrade on empty HTML as before.
    capture.failedRead('page')
    readFailed = true
  }
  if (!accessDenied && !readFailed && !html.trim()) {
    return refuse('SCAN_PAGE_UNAVAILABLE', 502)
  }

  // Run all 16 checks (5 core + 11 extended) in parallel
  const [c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12, c13, c14, c15, c16] =
    await Promise.allSettled([
      // Core (URL-fetch)
      checkRobots(baseUrl, capture.forCheck('c1_robots')),
      checkLlmsTxt(baseUrl, capture.forCheck('c2_llms_txt')),
      checkBotAccess(baseUrl, capture.forCheck('c3_bot_access')),
      checkStructuredData(baseUrl, capture.forCheck('c4_structured_data')),
      checkExtractability(baseUrl, capture.forCheck('c5_extractability')),
      // Extended — URL-fetch
      checkLlmsFullTxt(baseUrl, capture.forCheck('c6_llms_full_txt')),
      checkMcpCard(baseUrl, html, capture.forCheck('c7_mcp_card')),
      checkSitemap(baseUrl, capture.forCheck('c8_sitemap')),
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
  const geoContext  = { industry: geoIndustry, region: geoRegion, clientId: clientId }

  // Fetch sitemap URLs for c19 (Topical Authority) — reuse caller-supplied list or fetch /sitemap.xml
  let sitemapUrlsForGeo: string[] = parsedSitemapUrls.urls
  if (!sitemapUrlsForGeo.length) {
    try {
      // Follows a sitemap index one level, within the same 8s budget.
      sitemapUrlsForGeo = await fetchSitemapPageUrls(capture.forCheck('sitemap'), baseUrl, { timeoutMs: 8_000 })
    } catch { capture.failedRead('sitemap') /* sitemap unavailable — c19 reports it unassessable */ }
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
    // The diagnostic is kept so readers of the stored result (computeImpact's
    // quick wins) know a check could not measure, as calculateGeoScore did here.
    geoDetails[key] = {
      status: r.status, message: r.message, details: (r as { details?: unknown }).details,
      ...(r.diagnostic ? { diagnostic: r.diagnostic } : {}),
    }
    if ('geoDetails' in r && r.geoDetails) {
      geoDetails[`${key}_data`] = r.geoDetails
    }
  }

  const totalScore = capScore(score + geoScore)
  const grade = assignGrade(totalScore)

  // Dashboard behavior is enabled only for the already verified owned client.
  const isDashboardScan = !!ownedClient
  const agentRequirements: AgentRequirements = {
    agent_recs: entitlement.features.agent_recs,
    agent_progress: entitlement.features.agent_progress,
    agent_competitors: entitlement.features.agent_competitors,
  }
  const queueAgentAnalysis = isDashboardScan
    && Object.values(agentRequirements).some(Boolean)

  let scanId: string
  const summaryWebhook = process.env.N8N_SCAN_WEBHOOK_URL?.trim()
  let summaryDispatch: ReturnType<typeof createSummaryReceipt> | undefined
  try {
    // Trust signals are a diagnostic outside the score (lib/trust-signals.ts):
    // computed from the page already fetched, after scoring, so they cannot
    // move a grade. Omitted when there is no page body to read.
    const combinedResults = {
      ...results,
      ...geoDetails,
      ...(queueAgentAnalysis ? { _agent_requirements: agentRequirements } : {}),
      ...(html.trim() ? { trust_signals: assessTrustSignals(html, baseUrl) } : {}),
    }
    const evidence = buildScanEvidence({
      requestedUrl: /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : 'https://' + url,
      evaluatedUrl: baseUrl, industry: geoIndustry, region: geoRegion,
      sitemapSource: parsedSitemapUrls.urls.length ? 'caller' : 'fetched',
      checks: capture.checks([c1,c2,c3,c4,c5,c6,c7,c8,c9,c10,c11,c12,c13,c14,c15,c16,c17,c18,c19,c20], Object.keys(CHECK_VERSIONS) as EvidenceCheckKey[]),
      observations: capture.observations, limited: capture.limited, collectedAt: new Date().toISOString(),
    })
    const pillarScores = calculatePillarScores(combinedResults, evidence.checks)
    if (summaryWebhook) summaryDispatch = createSummaryReceipt({ domain, score: totalScore, grade, results: { ...combinedResults, evidence } })
    const persisted = {
      ...combinedResults,
      pillarScores,
      evidence,
      ...(summaryDispatch ? { _n8n: summaryDispatch.receipt } : {}),
      ...(claimKey ? { _scan_request: claimResults('complete', { finishedAt: new Date().toISOString() })._scan_request } : {}),
    }
    // The claim row created before the checks ran is finalised in place, so
    // every replay of this requestKey resolves to the same scan id.
    const rows = claimId
      ? await sql`
          update scans
          set url = ${baseUrl}, domain = ${domain}, score = ${totalScore},
              results = ${JSON.stringify(persisted)}::jsonb,
              industry = ${geoIndustry}, region = ${geoRegion}, grade = ${grade},
              agent_status = ${queueAgentAnalysis ? 'pending' : null}
          where id = ${claimId} and account_id = ${account_id}
          returning id
        `
      : await sql`
          insert into scans (url, domain, score, results, industry, region, grade, account_id, agent_status, client_id)
          values (${baseUrl}, ${domain}, ${totalScore}, ${JSON.stringify(persisted)}::jsonb,
                  ${geoIndustry}, ${geoRegion}, ${grade}, ${account_id},
                  ${queueAgentAnalysis ? 'pending' : null}, ${clientId ?? null})
          returning id
        `
    const inserted = rows[0] as { id: string } | undefined
    if (!inserted) return NextResponse.json({ error: 'Insert returned no data' }, { status: 500 })
    scanId = inserted.id
  } catch (dbErr) {
    console.error('[scan] DB insert failed:', (dbErr as Error)?.message ?? String(dbErr))
    await markClaimFailed('Database error — check Neon configuration', 500)
    return NextResponse.json({ error: 'Database error — check Neon configuration' }, { status: 500 })
  }

  // Exactly one producer owns the entitled scan: the configured webhook, or
  // the native grounded producer. Both recover against this retained scan ID.
  if (queueAgentAnalysis && ownedClient?.webhook_url) {
    const webhookUrl = ownedClient.webhook_url
    const platforms = entitlement.features.platform_access

    try {
      await sql`update scans set agent_platforms = ${platforms} where id = ${scanId} and account_id = ${account_id}`
    } catch { /* non-fatal — webhook payload still carries platforms */ }

    const dispatch = async () => {
      try {
        await fetchPublicUrl(webhookUrl, {
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
            agentRequirements,
            results: { ...results, ...geoDetails },
          }),
          signal: AbortSignal.timeout(5_000),
        })
      } catch (error) {
        console.error('[scan] webhook trigger failed:', error)
      }
    }

    try {
      after(dispatch)
    } catch (error) {
      console.error('[scan] webhook scheduling failed:', error)
      await dispatch()
    }
  } else if (queueAgentAnalysis && ownedClient && account_id) {
    const dispatch = async () => {
      await generateImprove({ accountId: account_id, clientId: ownedClient.id, scanId })
    }
    try { after(dispatch) } catch {
      // Direct fallback is still fenced by the same persisted native claim.
      await dispatch()
    }
  }

  // The capability hash and frozen input are already retained with this scan.
  // A durable dispatch claim prevents retries from repeating the provider work.
  if (summaryWebhook && summaryDispatch?.receipt.state === 'queued') {
    const prepared = summaryDispatch
    const dispatch = async () => {
      try {
        await dispatchScanSummary({ scanId, accountId: account_id, clientId: clientId ?? null },
          prepared.token, prepared.receipt, summaryWebhook)
      } catch {
        console.error('[scan] n8n receipt dispatch unavailable')
      }
    }

    try {
      after(dispatch)
    } catch {
      await dispatch()
    }
  }

  return NextResponse.json(
    { id: scanId, score: totalScore, grade },
    { headers: scanHeaders },
  )
}
