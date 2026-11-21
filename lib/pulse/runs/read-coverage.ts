import 'server-only'
import type { db } from '@/lib/db'
import { isoDate } from '@/lib/iso-date'

/** Overlay saved manifests even while collection is paused. Historical metrics have no invented denominator. */
export async function attachManifestCoverage(sql:ReturnType<typeof db>,accountId:string,clientIds:string[],observations:Record<string,unknown>[]) {
  if (!clientIds.length) return observations
  const coverage = await sql`select r.id as run_id,r.client_id,r.scan_week,i.platform,
     md5(r.manifest::text) as manifest_signature,
     jsonb_array_length(r.manifest->'items') as manifest_expected,
    (select exists(select 1 from pulse_metrics legacy where legacy.client_id=r.client_id and legacy.scan_week=r.scan_week and legacy.run_item_id is null)) as mixed_legacy,
    count(i.id)::int as expected_items,
    count(i.id) filter(where i.status = 'running')::int as running_items,
    count(i.id) filter(where i.status = 'succeeded')::int as succeeded_items,
    count(i.id) filter(where i.status = 'failed')::int as failed_items,
    count(i.id) filter(where i.status in ('queued','running','retry_wait'))::int as pending_items,
    count(i.id) filter(where i.status = 'blocked')::int as blocked_items,
    count(i.id) filter(where i.status = 'succeeded' and i.classification_status = 'classified')::int as classified_items
    from pulse_runs r join clients c on c.id = r.client_id and c.account_id = r.account_id
    left join pulse_run_items i on i.run_id = r.id and i.account_id = r.account_id and i.client_id = r.client_id
    where r.account_id = ${accountId} and c.id = any(${clientIds}::uuid[])
      and r.purpose='canonical' and r.scan_week >= current_date - interval '280 days'
    group by grouping sets ((r.id,r.client_id,r.scan_week,i.platform),(r.id,r.client_id,r.scan_week))`
  const key=(row:Record<string,unknown>)=>`${row.client_id ?? clientIds[0]}:${isoDate(row.scan_week as string|Date,'')}:${row.platform ?? 'aggregate'}`
  const result=new Map(observations.map(row=>[key(row),{...row}]))
  for (const row of coverage) {
    const id = key(row)
    const evidence = result.get(id)
    // A damaged or incomplete item ledger cannot authorize a complete sample.
    const ledgerMismatch = row.platform === null && row.manifest_expected != null && row.expected_items !== row.manifest_expected
    result.set(id, {
      ...evidence, ...row, ledger_mismatch: ledgerMismatch,
      observed_queries: evidence?.observed_queries ?? 0,
      collected_queries: evidence?.collected_queries ?? 0,
      observed_brand_mentions: evidence?.observed_brand_mentions ?? 0,
      successful_queries: evidence?.successful_queries ?? 0,
      successful_platform_count: evidence?.successful_platform_count ?? 0,
    })
  }
  return [...result.values()]
}
