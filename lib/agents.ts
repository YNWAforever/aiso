import type { NeonQueryFunction } from '@neondatabase/serverless'

type Sql = NeonQueryFunction<false, false>

/**
 * Read the secret, or null when it is missing or too short to be one.
 *
 * Compared against a known-present value, mirroring pulse/run's guard — an
 * unset var can never make an absent header match.
 */
export function cronSecret(): string | null {
  const secret = process.env.CRON_SECRET
  if (!secret || secret.length < 16) return null
  return secret
}

/**
 * Sets scans.agent_status = 'complete' once agent_recommendations, agent_progress,
 * and agent_competitors each have at least one row for this scan.
 *
 * Best-effort, deliberately: whichever route calls this has already persisted
 * its own payload successfully by the time this runs. A failure here means
 * agent_status lags reality, not that the caller's actual data was lost — so
 * it logs and returns rather than turning an already-successful write into an
 * error response.
 */
export async function markCompleteIfAllPresent(sql: Sql, scanId: string): Promise<void> {
  try {
    const [recs, progress, competitors] = await Promise.all([
      sql`select 1 from agent_recommendations where scan_id = ${scanId} limit 1`,
      sql`select 1 from agent_progress where scan_id = ${scanId} limit 1`,
      sql`select 1 from agent_competitors where scan_id = ${scanId} limit 1`,
    ])

    if (recs.length > 0 && progress.length > 0 && competitors.length > 0) {
      await sql`update scans set agent_status = 'complete' where id = ${scanId}`
    }
  } catch (error) {
    console.error('[lib/agents] markCompleteIfAllPresent failed:', error)
  }
}
