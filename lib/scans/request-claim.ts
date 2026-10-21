import 'server-only'
import { db } from '@/lib/db'
export type ScanClaimRow = {
  id: string; score: number | string | null; grade: string | null
  created_at: string; results: Record<string, unknown>
}
/** Separate READ COMMITTED statements after the lock see concurrent winners. */
export async function claimOwnedScan(input: {
  accountId: string; clientId: string; key: string; url: string; domain: string
  industry: string; region: string; results: Record<string, unknown>
}): Promise<{ row: ScanClaimRow; created: boolean }> {
  const sql = db()
  const identity = JSON.stringify([input.accountId, input.clientId, input.key])
  const filter = JSON.stringify({ _scan_request: { key: input.key } })
  const [, existing, inserted] = await sql.transaction([
    sql`select pg_advisory_xact_lock(hashtextextended(${identity},0))`,
    sql`select id,score,grade,created_at,results from scans
      where account_id=${input.accountId} and client_id=${input.clientId} and results @> ${filter}::jsonb
      order by created_at asc limit 1`,
    sql`insert into scans (url,domain,score,results,industry,region,grade,account_id,agent_status,client_id)
      select ${input.url},${input.domain},null,${JSON.stringify(input.results)}::jsonb,
        ${input.industry},${input.region},null,${input.accountId},null,${input.clientId}
      where exists(select 1 from clients where id=${input.clientId} and account_id=${input.accountId})
        and not exists(select 1 from scans where account_id=${input.accountId} and client_id=${input.clientId}
          and results @> ${filter}::jsonb)
      returning id,score,grade,created_at,results`,
  ], { isolationLevel: 'ReadCommitted' })
  const row = existing[0] ?? inserted[0]
  if (!row) throw new Error('SCAN_CLAIM_UNAVAILABLE')
  return { row: row as ScanClaimRow, created: inserted.length > 0 }
}
