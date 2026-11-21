import 'server-only'
import { db } from '@/lib/db'
import { collectionReason } from '@/lib/pulse/runs/collection-reason'
import type { ObservationRun } from './types'

export type RunItemFilter = 'all' | 'failed' | 'pending' | 'unclassified'
type RunItem = {
  id: string; question: string; platform: string; model: string; status: string; classification: string
  attempts: number; observationId: string | null; reason: ReturnType<typeof collectionReason> | null
}
export type RunTroubleshooting = {
  runId: string; week: string; purpose: ObservationRun['purpose']; expected: number; succeeded: number
  failed: number; pending: number; blocked: number; classified: number; total: number; items: RunItem[]
  nextCursor: string | null
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function loadRunTroubleshooting(
  accountId: string, clientId: string, runId: string, filter: RunItemFilter, cursor: string | null = null, includeItems = true,
): Promise<RunTroubleshooting | null> {
  if (!uuid.test(runId) || (cursor !== null && !uuid.test(cursor)) || !['all', 'failed', 'pending', 'unclassified'].includes(filter)) {
    throw new Error('INVALID_RUN_QUERY')
  }
  const [row] = await db()`with owned as (
    select r.id, r.scan_week, r.purpose, jsonb_array_length(r.manifest->'items') as expected
    from pulse_runs r join clients c on c.id = r.client_id and c.account_id = r.account_id
    where r.account_id = ${accountId} and r.client_id = ${clientId} and r.id = ${runId}
  ), items as materialized (
    select i.id, i.snapshot->>'question' as question, i.platform, i.model_id as model,
      i.status, i.classification_status as classification, i.attempt_count as attempts
    from pulse_run_items i join owned r on r.id = i.run_id
    where i.account_id = ${accountId} and i.client_id = ${clientId}
  ), filtered as (
    select * from items where ${filter} = 'all'
      or (${filter} = 'failed' and status in ('failed','blocked'))
      or (${filter} = 'pending' and status in ('queued','running','retry_wait'))
      or (${filter} = 'unclassified' and status = 'succeeded' and classification <> 'classified')
  ), page as (
    select i.* from filtered i
    where ${includeItems}::boolean and (${cursor}::uuid is null or i.id > ${cursor}::uuid)
    order by i.id limit 51
  ), details as (
    select p.*, m.id as "observationId", a.error_code as "errorCode"
    from page p join owned r on true
    left join pulse_metrics m on m.run_item_id = p.id and m.client_id = ${clientId} and m.scan_week = r.scan_week
    left join pulse_item_attempts a on a.item_id = p.id and a.account_id = ${accountId}
      and a.client_id = ${clientId} and a.attempt_number = p.attempts and p.status in ('failed','blocked','retry_wait')
  ), counts as (
    select count(*)::int as actual, count(*) filter (where status = 'succeeded')::int as succeeded,
      count(*) filter (where status = 'failed')::int as failed,
      count(*) filter (where status in ('queued','running','retry_wait'))::int as pending,
      count(*) filter (where status = 'blocked')::int as blocked,
      count(*) filter (where status = 'succeeded' and classification = 'classified')::int as classified
    from items
  )
  select r.id, r.scan_week::text as week, r.purpose, r.expected, counts.*,
    (select count(*)::int from filtered) as total,
    coalesce((select jsonb_agg(d order by d.id) from details d), '[]'::jsonb) as items
  from owned r cross join counts`
  if (!row) return null
  if (Number(row.actual) !== Number(row.expected)) throw new Error('RUN_EVIDENCE_UNAVAILABLE')
  const records = row.items as (Omit<RunItem, 'reason'> & { errorCode: string | null })[]
  const items = records.slice(0, 50).map<RunItem>(({ errorCode, ...item }) => ({
    ...item, reason: errorCode ? collectionReason(errorCode) : null,
  }))
  return {
    runId: String(row.id), week: String(row.week), purpose: row.purpose as ObservationRun['purpose'],
    expected: Number(row.expected), succeeded: Number(row.succeeded), failed: Number(row.failed),
    pending: Number(row.pending), blocked: Number(row.blocked), classified: Number(row.classified),
    total: Number(row.total), items, nextCursor: records.length > 50 ? items.at(-1)?.id ?? null : null,
  }
}
