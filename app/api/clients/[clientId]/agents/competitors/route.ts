import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { markCompleteIfAllPresent } from '@/lib/agents'

export const dynamic = 'force-dynamic'

type Competitor = {
  platform: string
  competitorDomain: string
  competitorName?: string
  mentionRate: number
  yourRate: number
  gapAnalysis: string
}

/**
 * Read the secret, or null when it is missing or too short to be one.
 *
 * Compared against a known-present value, mirroring pulse/run's guard — an
 * unset var can never make an absent header match.
 */
function cronSecret(): string | null {
  const secret = process.env.CRON_SECRET
  if (!secret || secret.length < 16) return null
  return secret
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const { clientId } = await params

  const secret = cronSecret()
  if (!secret) {
    console.error('[agents/competitors] CRON_SECRET is unset or shorter than 16 characters')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  if (req.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { scanId?: string; competitors?: Competitor[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const { scanId, competitors } = body
  if (!scanId || !Array.isArray(competitors)) {
    return NextResponse.json({ error: 'scanId and competitors array required' }, { status: 400 })
  }

  const sql = db()

  // Scoped to both scanId and the URL's clientId — the pre-fence version only
  // checked scanId, so a stale/wrong client mapping would silently write into
  // the wrong place with no signal anything was off.
  let scanFound: boolean
  try {
    const rows = await sql`
      select id from scans where id = ${scanId} and client_id = ${clientId} limit 1
    `
    scanFound = rows.length > 0
  } catch (error) {
    // A failed lookup is a database incident, not "no such scan" — never let
    // an outage read as a 404.
    console.error('[agents/competitors] scan lookup failed:', error)
    return NextResponse.json({ error: 'Scan lookup failed' }, { status: 503 })
  }
  if (!scanFound) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (competitors.length === 0) return NextResponse.json({ count: 0 })

  try {
    for (const c of competitors) {
      await sql`
        insert into agent_competitors (scan_id, platform, competitor_domain, competitor_name, mention_rate, your_rate, gap_analysis)
        values (${scanId}, ${c.platform}, ${c.competitorDomain}, ${c.competitorName ?? null}, ${c.mentionRate}, ${c.yourRate}, ${c.gapAnalysis})
        on conflict (scan_id, platform, competitor_domain) do update set
          competitor_name = excluded.competitor_name,
          mention_rate = excluded.mention_rate,
          your_rate = excluded.your_rate,
          gap_analysis = excluded.gap_analysis
      `
    }
  } catch (error) {
    console.error('[agents/competitors] write failed:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  await markCompleteIfAllPresent(sql, scanId)

  return NextResponse.json({ count: competitors.length })
}
