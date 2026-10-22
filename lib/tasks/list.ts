import 'server-only'
import { db } from '@/lib/db'
import { TASK_LIMIT, taskStatus, type TaskRow } from './status'

/**
 * Every work item for one brand as a task with a single status, in one
 * statement. Read-only and account-scoped: the account filter sits on the work
 * item and every join repeats (account_id, client_id), the composite key all
 * four tables share, so nothing can join across tenants.
 *
 * Status, from the item's latest submitted version (lib/change-sets) and that
 * version's decision and delivery events (lib/delivery):
 *   draft              no version submitted yet
 *   in_review          latest version has no decision
 *   changes_requested  latest version's decision asked for changes
 *   approved           approved, no active attestation
 *   delivered          approved with an attestation that was not withdrawn
 *
 * Ordered and dated by the latest lifecycle activity: submitting, deciding and
 * delivering append rows elsewhere without touching the work item's own
 * updated_at, so that column alone would bury recently active tasks.
 *
 * "Measured" is not a status here: outcomes are evaluated per version in code
 * (lib/outcomes), so they stay on the task's own page.
 */

export { TASK_LIMIT, TASK_STATUSES, taskStatus, type TaskRow, type TaskStatus, type TaskStatusInput } from './status'

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  return typeof value === 'string' ? value : ''
}

/** Throws on a database failure, so the page can say "unavailable" rather than "no tasks". */
export async function listTasks(accountId: string, clientId: string): Promise<TaskRow[]> {
  const rows = await db()`
    select w.id, w.title, w.check_key,
      greatest(w.updated_at, v.submitted_at, d.decided_at, de.recorded_at) as updated_at,
      v.id as version_id, v.version_number,
      d.decision,
      exists (
        select 1 from work_item_delivery_events e
        where e.account_id = w.account_id and e.client_id = w.client_id and e.work_item_id = w.id
          and e.version_id = v.id and e.kind = 'attest'
          and not exists (
            select 1 from work_item_delivery_events x
            where x.account_id = e.account_id and x.client_id = e.client_id and x.work_item_id = e.work_item_id
              and x.version_id = e.version_id and x.target_attestation_id = e.id and x.kind = 'withdraw')
      ) as delivered
    from evidence_work_items w
    left join lateral (
      select lv.id, lv.version_number, lv.submitted_at from work_item_versions lv
      where lv.account_id = w.account_id and lv.client_id = w.client_id and lv.work_item_id = w.id
      order by lv.version_number desc limit 1
    ) v on true
    left join work_item_decisions d
      on d.account_id = w.account_id and d.client_id = w.client_id and d.work_item_id = w.id and d.version_id = v.id
    left join lateral (
      select max(le.recorded_at) as recorded_at from work_item_delivery_events le
      where le.account_id = w.account_id and le.client_id = w.client_id and le.work_item_id = w.id
    ) de on true
    where w.account_id = ${accountId} and w.client_id = ${clientId}
    order by greatest(w.updated_at, v.submitted_at, d.decided_at, de.recorded_at) desc, w.id desc
    limit ${TASK_LIMIT}
  `
  return rows.map(row => ({
    id: String(row.id),
    title: String(row.title),
    checkKey: typeof row.check_key === 'string' ? row.check_key : null,
    status: taskStatus({ versionId: row.version_id ? String(row.version_id) : null, decision: typeof row.decision === 'string' ? row.decision : null, delivered: row.delivered === true }),
    versionNumber: row.version_number == null ? null : Number(row.version_number),
    updatedAt: iso(row.updated_at),
  }))
}
