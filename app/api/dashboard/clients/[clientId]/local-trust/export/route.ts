import { db } from '@/lib/db'
import { findNewestMatchingScan, type RoiUnavailable } from '@/lib/localTrust'
import { authorizeLocalTrustClient } from '@/lib/localTrust/guard'
import { getLocalTrustProfile, getOrCreateLocalTrustSnapshot } from '@/lib/localTrust/store'
import type { AgentCompetitor, PulseMetric, PulseWeeklySummary, Scan } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * English only, like every other label in this CSV. The file is a spreadsheet
 * export rather than a rendered page — it has no locale — so these are written
 * here rather than pulled from the message catalogues.
 */
const UNAVAILABLE_NOTE: Record<RoiUnavailable, string> = {
  assumptions_missing: 'average lead value and close rate have not been entered',
  no_earlier_snapshot: 'no earlier month to compare against yet',
  no_increase: 'the Local Trust Score has not risen since the previous month',
  no_visibility_baseline: 'no scan or Pulse data to score against yet',
}

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

    const { snapshot, actions, roi } = await getOrCreateLocalTrustSnapshot({
      client,
      accountId: profile.account_id,
      latestScan,
      profile: localTrustProfile,
      pulseSummary: summary,
      missed,
      competitors,
    })

    const topAction = actions.find(action => action.status === 'open') ?? actions[0]
    const assumptions = snapshot.roi_estimate?.assumptions
    // A spreadsheet keeps the rows it was given and loses the panel around them.
    // With no figure, empty value cells read as a number that failed to arrive
    // rather than one deliberately not claimed, so the basis row says which.
    const basis = roi.unavailable
      ? `No estimate for this month: ${UNAVAILABLE_NOTE[roi.unavailable]}`
      : 'Estimated from the figures you entered — not an observed or measured result'
    const csv = csvRows([
      ['Metric', 'Value'],
      ['Local Trust Score', snapshot.local_trust_score],
      ['Snapshot Month', snapshot.snapshot_month],
      ['Top Action', topAction?.title ?? 'No open actions'],
      ['Estimated Value Low', snapshot.roi_estimate?.low ?? ''],
      ['Estimated Value High', snapshot.roi_estimate?.high ?? ''],
      // The CSV and the print button are the two artifacts that leave the
      // product. A bare "Estimated Value: 24000" in a spreadsheet, with no
      // currency and no basis, is the highest-risk commercial claim in this
      // feature: it reads as a measured result and travels without the panel
      // that qualifies it. These rows make the figure carry its own basis.
      ['Currency', snapshot.roi_estimate?.currency ?? ''],
      ['Assumed Average Lead Value', assumptions?.averageLeadValue ?? ''],
      ['Assumed Close Rate', assumptions?.closeRate ?? ''],
      ['Assumed Extra Enquiries Low', assumptions?.estimatedExtraEnquiriesLow ?? ''],
      ['Assumed Extra Enquiries High', assumptions?.estimatedExtraEnquiriesHigh ?? ''],
      // What the money is keyed to. Without these the reader cannot tell that the
      // figure answers a score movement at all, and the conversion from points to
      // enquiries — the one step nothing in this product measures — would travel
      // unstated. Rows written before the estimator required a real baseline carry
      // none of them.
      ['Compared To Month', assumptions?.comparedToMonth ?? ''],
      ['Previous Local Trust Score', assumptions?.previousScore ?? ''],
      ['Score Movement', assumptions?.scoreDelta ?? ''],
      ['Assumed Points Per Enquiry Low', assumptions?.pointsPerEnquiryLow ?? ''],
      ['Assumed Points Per Enquiry High', assumptions?.pointsPerEnquiryHigh ?? ''],
      ['Basis', basis],
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
