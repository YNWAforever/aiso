import { NextRequest, NextResponse } from 'next/server'
import { getProfile } from '@/lib/auth'
import { db } from '@/lib/db'
import type { ClientOverview, Scan, AgentRecommendation, AgentProgress, AgentCompetitor, PulseWeeklySummary, PulseMetric } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sql = db()

  try {
    const clientRows = await sql`
      select brand_name from clients
      where id = ${clientId} and account_id = ${profile.account_id}
      limit 1
    `
    if (!clientRows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Brand-scoped, not account-scoped — a workspace shows only its own scans.
    const latestRows = await sql`
      select * from scans
      where client_id = ${clientId} and account_id = ${profile.account_id}
      order by created_at desc limit 1
    `
    const latestScan = (latestRows[0] ?? null) as Scan | null
    const scanId = latestScan?.id ?? null

    const [scanHistory, recommendations, progress, competitors, pulseSummary, pulseMetrics] =
      await Promise.all([
        sql`
          select id, domain, score, grade, created_at from scans
          where client_id = ${clientId} and account_id = ${profile.account_id}
          order by created_at desc limit 10
        `,
        scanId
          ? sql`select * from agent_recommendations where scan_id = ${scanId}
                 order by priority, impact_score desc`
          : Promise.resolve([]),
        scanId
          ? sql`select * from agent_progress where scan_id = ${scanId}`
          : Promise.resolve([]),
        scanId
          ? sql`select * from agent_competitors where scan_id = ${scanId}
                 order by mention_rate desc`
          : Promise.resolve([]),
        sql`select * from pulse_weekly_summary
             where client_id = ${clientId} order by scan_week limit 40`,
        sql`select platform, question, competitors_mentioned, scan_week
             from pulse_metrics
             where client_id = ${clientId} and brand_mentioned = false
             order by scan_week desc limit 10`,
      ])

    const summary = pulseSummary as unknown as PulseWeeklySummary[]
    const latestWeek = summary.filter(d => !d.platform).at(-1)?.scan_week
    const kpiRow = summary.find(d => d.scan_week === latestWeek && !d.platform)
    const platformCount = [...new Set(
      summary.filter(d => d.scan_week === latestWeek && d.platform).map(d => d.platform)
    )].length

    const overview: ClientOverview = {
      client: { brand_name: clientRows[0].brand_name as string },
      latestScan,
      scanHistory: scanHistory as unknown as Pick<Scan, 'id' | 'domain' | 'score' | 'grade' | 'created_at'>[],
      recommendations: recommendations as unknown as AgentRecommendation[],
      progress: progress as unknown as AgentProgress[],
      competitors: competitors as unknown as AgentCompetitor[],
      pulseSummary: summary,
      pulseKpi: kpiRow ? {
        sovScore: kpiRow.sov_score,
        brandMentions: kpiRow.brand_mentions,
        totalQueries: kpiRow.total_queries,
        platformCount,
        scanWeek: kpiRow.scan_week,
      } : null,
      missedOpportunities: (pulseMetrics as unknown as PulseMetric[]).map(m => ({
        platform: m.platform,
        question: m.question,
        competitors_mentioned: m.competitors_mentioned,
        scan_week: m.scan_week,
      })),
    }

    return NextResponse.json(overview)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[overview] query failed:', message.replace(/postgresql:\/\/\S+/g, '[redacted]'))
    return NextResponse.json({ error: 'Failed to load overview' }, { status: 500 })
  }
}
