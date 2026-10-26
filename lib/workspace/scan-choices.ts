import 'server-only'
import { db } from '@/lib/db'
import type { Scan } from '@/lib/types'
import { projectScanStatus } from '@/lib/view-models/scan-status'

export type ScanChoice = Pick<Scan, 'id' | 'domain' | 'score' | 'grade' | 'created_at'>

/** Ownership is independent of whether collection produced a usable score. */
export async function isOwnedWorkspaceScan({ accountId, clientId, scanId }: { accountId: string; clientId: string; scanId: string }): Promise<boolean> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(scanId)) return false
  const rows = await db()`
    select id from scans
    where account_id = ${accountId} and client_id = ${clientId} and id = ${scanId}
    limit 1
  `
  return rows.length > 0
}

/** Completed choices, scoped to the tenant and brand; evidence stays server-side. */
export async function loadOwnedScanChoices({ accountId, clientId }: { accountId: string; clientId: string }): Promise<ScanChoice[]> {
  const rows = await db()`
    select id, domain, score, grade, created_at, results->'evidence' as evidence from scans
    where account_id = ${accountId} and client_id = ${clientId} and score is not null
    order by created_at desc, id desc
  `
  return rows.flatMap(row => {
    const score = typeof row.score === 'string' ? Number(row.score) : row.score
    if (typeof score !== 'number' || !Number.isFinite(score)) return []
    if (projectScanStatus({ score, grade: row.grade ?? null, evidence: row.evidence }).score === null) return []
    return [{ id: row.id, domain: row.domain, score, grade: row.grade,
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at }]
  })
}
