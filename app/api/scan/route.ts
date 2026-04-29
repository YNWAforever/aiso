import { NextRequest, NextResponse } from 'next/server'
import { checkRobots }         from '@/lib/checks/robots'

export const dynamic = 'force-dynamic'
import { checkLlmsTxt }        from '@/lib/checks/llmsTxt'
import { checkBotAccess }      from '@/lib/checks/botAccess'
import { checkStructuredData } from '@/lib/checks/structuredData'
import { checkExtractability } from '@/lib/checks/extractability'
import { checkCitationDensity } from '@/lib/checks/citationDensity'
import { checkFactualDensity }  from '@/lib/checks/factualDensity'
import { checkTopicalAuthority } from '@/lib/checks/topicalAuthority'
import { checkChunkability }    from '@/lib/checks/chunkability'
import { supabase }            from '@/lib/supabase'
import { getProfile }          from '@/lib/auth'
import type { ScanResults, IndustryCode, RegionCode } from '@/lib/types'

const WEIGHTS = {
  c1_robots:          0.175,
  c2_llms_txt:        0.175,
  c3_bot_access:      0.300,
  c4_structured_data: 0.175,
  c5_extractability:  0.175,
}
const SCORES = { pass: 100, warn: 50, fail: 0 } as const

export function calculateScore(results: ScanResults): number {
  return (Object.keys(WEIGHTS) as Array<keyof typeof WEIGHTS>).reduce((total, key) => {
    return total + SCORES[results[key].status] * WEIGHTS[key]
  }, 0)
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

  const [c1, c2, c3, c4, c5] = await Promise.allSettled([
    checkRobots(baseUrl),
    checkLlmsTxt(baseUrl),
    checkBotAccess(baseUrl),
    checkStructuredData(baseUrl),
    checkExtractability(baseUrl),
  ])

  const err = { status: 'fail' as const, message: 'check_error' }
  const get = <T>(r: PromiseSettledResult<T>, fallback: T): T =>
    r.status === 'fulfilled' ? r.value : fallback

  const results: ScanResults = {
    c1_robots:          get(c1, err),
    c2_llms_txt:        get(c2, err),
    c3_bot_access:      get(c3, err),
    c4_structured_data: get(c4, err),
    c5_extractability:  get(c5, err),
  }

  const score = calculateScore(results)

  // GEO checks — only run if industry + region context provided
  let geoScore = 0
  const geoDetails: Record<string, unknown> = {}
  let grade = 'F'

  if (industry && region) {
    const context = { industry: industry as IndustryCode, region: region as RegionCode, clientId }
    let html = ''
    try {
      const htmlRes = await fetch(baseUrl, {
        headers: { 'User-Agent': 'FimmickAISO/1.0' },
        signal: AbortSignal.timeout(15_000),
      })
      html = await htmlRes.text()
    } catch {}

    const [c17, c18, c19, c20] = await Promise.allSettled([
      checkCitationDensity(html, baseUrl, context),
      checkFactualDensity(html, context),
      checkTopicalAuthority(sitemapUrls ?? [], clientId ?? '', context.industry),
      checkChunkability(html, context),
    ])

    const geoChecks = [c17, c18, c19, c20]
    const geoWeights = [7, 6, 7, 5]   // 25 pts total matching spec
    geoChecks.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        const pts = r.value.status === 'pass' ? geoWeights[i]! : r.value.status === 'warn' ? geoWeights[i]! * 0.5 : 0
        geoScore += pts
        if ('geoDetails' in r.value && r.value.geoDetails) geoDetails[`c${17 + i}`] = r.value.geoDetails
      }
    })
  }

  const totalScore = Math.min(100, score + geoScore)
  grade =
    totalScore >= 90 ? 'A+' :
    totalScore >= 80 ? 'A'  :
    totalScore >= 70 ? 'B'  :
    totalScore >= 60 ? 'C'  :
    totalScore >= 50 ? 'D'  : 'F'

  // Attach to user's account if they are logged in
  const profile = await getProfile()
  const account_id = profile?.account_id ?? null

  const { data, error } = await supabase
    .from('scans')
    .insert({
      url: baseUrl, domain,
      score: totalScore,
      results: { ...results, ...geoDetails },
      industry: industry ?? null,
      region:   region ?? null,
      grade,
      account_id,
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: 'Database error' }, { status: 500 })

  return NextResponse.json({ id: data.id, score: totalScore, grade, results: { ...results, ...geoDetails } })
}
