import 'server-only'
import { db } from '@/lib/db'
import { loadObservationDetail, loadObservationSnapshot } from '@/lib/observations/store'
import { parseObservationQuery } from '@/lib/observations/query'
import { safeEvidenceUrl } from '@/lib/pulse/provider-citations'
import { buildOwnedResultEvidence } from '@/lib/result-evidence'
import type { StudioEvidence, StudioObservation } from './types'

/** Read-only, account-scoped page snapshot. Never constructs a provider client. */
export async function loadStudioEvidence(accountId: string, clientId: string): Promise<StudioEvidence | null> {
  const snapshot = await loadObservationSnapshot(accountId, clientId, parseObservationQuery(new URLSearchParams('limit=8')))
  if (!snapshot) return null
  const details = await Promise.all(snapshot.items.map(item => loadObservationDetail(accountId, clientId, item.id)))
  const observations: StudioObservation[] = details.flatMap(item => item ? [{
    id: item.id, question: item.question, platform: item.platform, scanWeek: item.scanWeek,
    recordedAt: item.recordedAt, collectedAt: item.collectedAt, model: item.model, market: item.market,
    result: item.result, brandMentioned: item.brandMentioned,
    excerpt: item.rawAnswer ? Array.from(item.rawAnswer).slice(0, 900).join('') + (Array.from(item.rawAnswer).length > 900 ? '…' : '') : null,
    links: item.links.filter(link => safeEvidenceUrl(link.url)).slice(0, 5),
    searchEvidence: item.searchEvidence,
  }] : [])
  const [scan] = await db()`
    select s.id, to_char(s.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as recorded_at, s.results
    from scans s join clients c on c.id = s.client_id
    where c.id = ${clientId} and s.account_id = ${accountId} and c.account_id = ${accountId}
    order by s.created_at desc nulls last, s.id desc limit 1
  `
  const results = scan?.results as Record<string, unknown> | undefined
  const evidence = buildOwnedResultEvidence(results?.evidence, results)
  return {
    week: snapshot.selectedWeek, totalRecorded: snapshot.counts.recordedRows,
    truncated: snapshot.nextCursor !== null, observations,
    scan: scan && evidence ? { id: String(scan.id), recordedAt: scan.recorded_at as string | null, evidence } : null,
  }
}
