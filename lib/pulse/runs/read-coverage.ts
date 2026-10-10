import 'server-only'
import type { db } from '@/lib/db'
import { isFeatureEnabled } from '@/lib/flags'
import { isoDate } from '@/lib/iso-date'

/** Overlay real manifests only. Historical metrics have no invented denominator. */
export async function attachManifestCoverage(sql:ReturnType<typeof db>,accountId:string,clientIds:string[],observations:Record<string,unknown>[]) {
  if (!isFeatureEnabled('pulse_attempts') || !clientIds.length) return observations
  const coverage = await sql`select r.id as run_id,r.client_id,r.scan_week,i.platform,
    count(i.id)::int as expected_items,
    count(i.id) filter(where i.status = 'succeeded')::int as succeeded_items,
    count(i.id) filter(where i.status = 'failed')::int as failed_items,
    count(i.id) filter(where i.status in ('queued','running','retry_wait'))::int as pending_items,
    count(i.id) filter(where i.status = 'blocked')::int as blocked_items,
    count(i.id) filter(where i.classification_status = 'classified')::int as classified_items
    from pulse_runs r join clients c on c.id = r.client_id and c.account_id = r.account_id
    left join pulse_run_items i on i.run_id = r.id
    where r.account_id = ${accountId} and c.id = any(${clientIds}::uuid[])
      and r.scan_week >= current_date - interval '280 days'
    group by grouping sets ((r.id,r.client_id,r.scan_week,i.platform),(r.id,r.client_id,r.scan_week))`
  const key=(row:Record<string,unknown>)=>`${row.client_id ?? clientIds[0]}:${isoDate(row.scan_week as string|Date,'')}:${row.platform ?? 'aggregate'}`
  const result=new Map(observations.map(row=>[key(row),{...row}]))
  for(const row of coverage){const id=key(row);result.set(id,{...result.get(id),...row})}
  return [...result.values()]
}
