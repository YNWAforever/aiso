import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { cronSecret, markCompleteIfAllPresent } from '@/lib/agents'

export const dynamic = 'force-dynamic'

type Recommendation = {
  platform: string
  priority: string
  recommendation: string
  category: string
  impactScore: number
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const { clientId } = await params

  const secret = cronSecret()
  if (!secret) {
    console.error('[agents/recommendations] CRON_SECRET is unset or shorter than 16 characters')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  if (req.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { scanId?: string; recommendations?: Recommendation[] }
  try {
    const parsed = await req.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    body = parsed
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const { scanId, recommendations } = body
  if (!scanId || !Array.isArray(recommendations)) {
    return NextResponse.json({ error: 'scanId and recommendations array required' }, { status: 400 })
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
    console.error('[agents/recommendations] scan lookup failed:', error)
    return NextResponse.json({ error: 'Scan lookup failed' }, { status: 503 })
  }
  if (!scanFound) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (recommendations.length === 0) return NextResponse.json({ count: 0 })

  try {
    for (const r of recommendations) {
      await sql`
        insert into agent_recommendations (scan_id, platform, priority, recommendation, category, impact_score)
        values (${scanId}, ${r.platform}, ${r.priority}, ${r.recommendation}, ${r.category}, ${r.impactScore})
        on conflict (scan_id, platform, category) do update set
          priority = excluded.priority,
          recommendation = excluded.recommendation,
          impact_score = excluded.impact_score
      `
    }
  } catch (error) {
    console.error('[agents/recommendations] write failed:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  // recommendations is the first of the three agent payloads to typically
  // arrive — flip agent_status to 'running' so the dashboard can show
  // progress, but only on the first write (never regress a scan already
  // marked 'complete', and don't touch any other in-flight status).
  try {
    await sql`
      update scans set agent_status = 'running'
      where id = ${scanId}
        and agent_status is distinct from 'complete'
        and (agent_status is null or agent_status = 'pending')
    `
  } catch (error) {
    // Best-effort, like markCompleteIfAllPresent below: the recommendations
    // themselves are already durably written by this point.
    console.error('[agents/recommendations] status update failed:', error)
  }

  await markCompleteIfAllPresent(sql, scanId)

  return NextResponse.json({ count: recommendations.length })
}
