import 'server-only'
import { db } from '@/lib/db'

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
 * "Measured" is not a status here: outcomes are evaluated per version in code
 * (lib/outcomes), so they stay on the task's own page.
 */

export const TASK_STATUSES = ['draft', 'in_review', 'changes_requested', 'approved', 'delivered'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export interface TaskRow {
  id: string
  title: string
  checkKey: string | null
  status: TaskStatus
  versionNumber: number | null
  updatedAt: string
}

export interface TaskStatusInput {
  versionId: string | null
  decision: string | null
  delivered: boolean
}

export function taskStatus({ versionId, decision, delivered }: TaskStatusInput): TaskStatus {
  if (!versionId) return 'draft'
  if (decision === 'changes_requested') return 'changes_requested'
  if (decision === 'approved') return delivered ? 'delivered' : 'approved'
  return 'in_review'
}

/** The most recent tasks first. Capped: a brand with more than this many items pages through Opportunities. */
export const TASK_LIMIT = 200

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  return typeof value === 'string' ? value : ''
}

/** Throws on a database failure, so the page can say "unavailable" rather than "no tasks". */
export async function listTasks(accountId: string, clientId: string): Promise<TaskRow[]> {
  const rows = await db()`
    select w.id, w.title, w.check_key, w.updated_at,
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
      select lv.id, lv.version_number from work_item_versions lv
      where lv.account_id = w.account_id and lv.client_id = w.client_id and lv.work_item_id = w.id
      order by lv.version_number desc limit 1
    ) v on true
    left join work_item_decisions d
      on d.account_id = w.account_id and d.client_id = w.client_id and d.work_item_id = w.id and d.version_id = v.id
    where w.account_id = ${accountId} and w.client_id = ${clientId}
    order by w.updated_at desc, w.id desc
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
