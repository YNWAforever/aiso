import {parseCitationQuery} from '@/lib/citations/query'
import { db } from '@/lib/db'
import { getProfile } from '@/lib/auth'
import { citationReportCsv, readCitationReport } from '@/lib/citations/report'

export const dynamic = 'force-dynamic'

/**
 * Which sites AI answers cite for one brand: JSON by default, `?format=csv`
 * for the per-site table.
 *
 * Signed-in and owned, no plan gate: it reads the same stored Pulse answers
 * the observations and Pulse pages show every plan.
 */
export async function GET(req: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params
  const format = new URL(req.url).searchParams.get('format') ?? 'json'
  if (format !== 'json' && format !== 'csv') return Response.json({ error: 'Invalid format' }, { status: 400 })

  let query;try{query=parseCitationQuery(new URL(req.url).searchParams)}catch{return Response.json({error:'Invalid citation filters'},{status:400})}
  // Not wrapped: a session-store outage must surface as a 500, not a 401.
  const profile = await getProfile()
  if (!profile) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let report
  try {
    report = await readCitationReport(db(), profile.account_id, clientId,query,format==='csv')
  } catch(error) {
    if(error instanceof Error&&error.message==='CITATION_SCOPE_TOO_LARGE')return Response.json({error:'Scope exceeds 2000 answers; narrow dates, platform or run. No export was truncated.'},{status:409})
    // A failed lookup must never read as "not yours".
    return Response.json({ error: 'Citation lookup failed' }, { status: 503 })
  }
  if (!report) return Response.json({ error: 'Not found' }, { status: 404 })

  if (format === 'csv') {
    const filename = `cited-sources-${clientId.replace(/[^a-zA-Z0-9-]/g, '')}.csv`
    return new Response(`﻿${citationReportCsv(report)}`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  }
  return Response.json({ report }, { headers: { 'Cache-Control': 'no-store' } })
}
