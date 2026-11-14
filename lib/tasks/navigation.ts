import type { TaskRow } from './status'

/** The same saved-work destination in Tasks and Today; it grants no authority. */
export function taskHref(lang: string, clientId: string, task: Pick<TaskRow, 'id' | 'status'>): string {
  const base = `/${lang}/dashboard/${encodeURIComponent(clientId)}`
  const id = encodeURIComponent(task.id)
  return task.status === 'draft' ? `${base}/opportunities?draft=${id}` : `${base}/work-items/${id}/versions`
}
