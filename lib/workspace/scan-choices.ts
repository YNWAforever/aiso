import 'server-only'
import { db } from '@/lib/db'
import type { Scan } from '@/lib/types'

export type ScanChoice = Pick<Scan, 'id' | 'domain' | 'score' | 'grade' | 'created_at'>

/** Metadata only, scoped to the current tenant and brand; never a domain match. */
export async function loadOwnedScanChoices({ accountId, clientId }: { accountId: string; clientId: string }): Promise<ScanChoice[]> {
  const rows = await db()`
    select id, domain, score, grade, created_at from scans
    where account_id = ${accountId} and client_id = ${clientId} and score is not null
    order by created_at desc, id desc
  `
  return rows.flatMap(row => {
    const score = typeof row.score === 'string' ? Number(row.score) : row.score
    if (typeof score !== 'number' || !Number.isFinite(score)) return []
    return [{ id: row.id, domain: row.domain, score, grade: row.grade,
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at }]
  })
}
