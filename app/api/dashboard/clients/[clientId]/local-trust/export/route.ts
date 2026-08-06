import { db } from '@/lib/db'
import { findNewestMatchingScan } from '@/lib/localTrust'
import { authorizeLocalTrustClient } from '@/lib/localTrust/guard'
import { getLocalTrustProfile, getOrCreateLocalTrustSnapshot } from '@/lib/localTrust/store'
import type { AgentCompetitor, PulseMetric, PulseWeeklySummary, Scan } from '@/lib/types'

export const dynamic = 'force-dynamic'

function csvCell(value: unknown) {
  const text = String(value ?? '')
  // Formula injection: a cell opening with = + - @ is executed by Excel and
  // Sheets on open. Prefixing an apostrophe forces it to be read as text.
  const safeText = /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text
  const escaped = safeText.replaceAll('"', '""')
  return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped
}

function csvRows(rows: Array<[string, unknown]>) {
  return rows.map(row => row.map(csvCell).join(',')).join('\n')
}

function exportFilename(clientId: string) {
  const safeClientId = clientId
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)

  return `local-trust-${safeClientId || 'client'}.csv`
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const { clientId } = await params
  const access = await authorizeLocalTrustClient(clientId, 'local_trust_export')
  if (!access.ok) return access.response

  const { profile, client } = access

  try {
    const sql = db()

    // Account-scoped, then narrowed to this brand's domain in memory — the
    // client was proven owned above, so the pulse reads below inherit that.
    const scanRows = await sql`
      select * from scans
      where account_id = ${profile.account_id}
      order by created_at desc
      limit 25
    ` as unknown as Scan[]
    const latestScan = findNewestMatchingScan(scanRows, client.domain)

    const [summary, missed, competitors] = await Promise.all([
      sql`
        select * from pulse_weekly_summary
        where client_id = ${clientId}
        order by scan_week
        limit 40
      ` as unknown as Promise<PulseWeeklySummary[]>,
      sql`
        select * from pulse_metrics
        where client_id = ${clientId} and brand_mentioned = false
        order by scan_week desc
        limit 50
      ` as unknown as Promise<PulseMetric[]>,
      latestScan
        ? sql`
            select * from agent_competitors
            where scan_id = ${latestScan.id}
            order by mention_rate desc
          ` as unknown as Promise<AgentCompetitor[]>
        : Promise.resolve([] as AgentCompetitor[]),
    ])

    // Nothing to report on yet. A 409 rather than an empty CSV, so the UI can
    // tell "no baseline" apart from "score of zero".
    const hasAggregatePulseBaseline = summary.some(row => !row.platform)
    if (!latestScan && !hasAggregatePulseBaseline) {
      return Response.json({ error: 'LOCAL_TRUST_BASELINE_REQUIRED' }, { status: 409 })
    }

    const localTrustProfile = await getLocalTrustProfile(clientId, profile.account_id)

    const { snapshot, actions } = await getOrCreateLocalTrustSnapshot({
      client,
      accountId: profile.account_id,
      latestScan,
      profile: localTrustProfile,
      pulseSummary: summary,
      missed,
      competitors,
    })

    const topAction = actions.find(action => action.status === 'open') ?? actions[0]
    const csv = csvRows([
      ['Metric', 'Value'],
      ['Local Trust Score', snapshot.local_trust_score],
      ['Snapshot Month', snapshot.snapshot_month],
      ['Top Action', topAction?.title ?? 'No open actions'],
      ['Estimated Value Low', snapshot.roi_estimate?.low ?? ''],
      ['Estimated Value High', snapshot.roi_estimate?.high ?? ''],
    ])

    return new Response(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${exportFilename(clientId)}"`,
      },
    })
  } catch {
    return Response.json({ error: 'Export failed' }, { status: 500 })
  }
}
