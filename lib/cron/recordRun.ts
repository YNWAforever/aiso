import { db } from '@/lib/db'

export type CronRunStatus = 'ok' | 'error'

/**
 * Insert the start row for a cron invocation and return its id.
 *
 * Returns null rather than throwing when the ledger write fails. Observability
 * must not take down a production job -- but note the cost, which is real: a
 * failed ledger write is indistinguishable from a run that never happened. It
 * is mitigated only by the fact that a database outage would fail the job's
 * actual work too.
 */
export async function startCronRun(route: string): Promise<string | null> {
  try {
    const sql = db()
    const rows = await sql`
      insert into cron_runs (route) values (${route}) returning id
    `
    return (rows[0]?.id as string | undefined) ?? null
  } catch (err) {
    console.error(`[cron-ledger] could not record start for ${route}:`, err)
    return null
  }
}

/**
 * Close out a run. No-ops when `id` is null, so a caller whose start row failed
 * does not need to branch.
 */
export async function finishCronRun(
  id: string | null,
  status: CronRunStatus,
  detail?: Record<string, unknown>,
  error?: string,
): Promise<void> {
  if (!id) return
  try {
    const sql = db()
    await sql`
      update cron_runs
         set finished_at = now(),
             status      = ${status},
             detail      = ${detail ? JSON.stringify(detail) : null}::jsonb,
             error       = ${error ?? null}
       where id = ${id}
    `
  } catch (err) {
    console.error(`[cron-ledger] could not record completion for ${id}:`, err)
  }
}
