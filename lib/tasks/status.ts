/**
 * The task vocabulary, shared by the server read (./list.ts) and the client
 * list. Pure: no database, so a client component can import it.
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
