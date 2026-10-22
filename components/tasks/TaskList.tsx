'use client'
import { useState } from 'react'
import Link from 'next/link'
import { ChevronRight, CircleCheck, CircleDashed, CircleDot, PackageCheck, RotateCcw, type LucideIcon } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { EmptyState } from '@/components/ui/empty-state'
import { cn } from '@/lib/utils'
import { TASK_STATUSES, type TaskRow, type TaskStatus } from '@/lib/tasks/status'

const STATUS_STYLE: Record<TaskStatus, { icon: LucideIcon; className: string }> = {
  draft: { icon: CircleDashed, className: 'bg-neutral-3 text-foreground' },
  in_review: { icon: CircleDot, className: 'bg-tone-info-soft text-tone-info-fg' },
  changes_requested: { icon: RotateCcw, className: 'bg-tone-warning-soft text-tone-warning-fg' },
  approved: { icon: CircleCheck, className: 'bg-tone-success-soft text-tone-success-fg' },
  delivered: { icon: PackageCheck, className: 'bg-tone-success-soft text-tone-success-fg' },
}

type Filter = 'all' | TaskStatus

/**
 * Tasks with one status each and a filter per status (with counts). A row
 * opens the task's existing review page; a draft opens that draft in
 * Opportunities, where drafts are edited. Null tasks means the list could not be read: say so and
 * offer a retry, never an empty list.
 */
export function TaskList({ lang, clientId, tasks, limited }: { lang: string; clientId: string; tasks: TaskRow[] | null; limited: boolean }) {
  const t = useTranslations('dashboard.tasks')
  const format = useFormatter()
  const [filter, setFilter] = useState<Filter>('all')
  const base = `/${lang}/dashboard/${clientId}`

  if (tasks === null) {
    return (
      <EmptyState
        illustration="error"
        title={t('unavailable')}
        action={<Link href={`${base}/tasks`} className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">{t('retry')}</Link>}
      />
    )
  }
  if (tasks.length === 0) {
    return (
      <EmptyState
        illustration="tasks"
        title={t('empty_title')}
        description={t('empty_body')}
        action={<Link href={`${base}/opportunities`} className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">{t('empty_action')}</Link>}
      />
    )
  }

  const count = (status: TaskStatus) => tasks.filter(task => task.status === status).length
  const visible = filter === 'all' ? tasks : tasks.filter(task => task.status === filter)

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label={t('filters')} className="flex flex-wrap gap-2">
        {(['all', ...TASK_STATUSES] as const).filter(f => f === 'all' || count(f) > 0).map(f => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={cn(
              'min-h-9 rounded-full border px-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
              filter === f ? 'border-foreground bg-foreground text-background' : 'border-border bg-card text-foreground hover:bg-neutral-3',
            )}
          >
            {f === 'all' ? t('all', { count: tasks.length }) : t(`filter.${f}`, { count: count(f) })}
          </button>
        ))}
      </div>

      {visible.length === 0
        ? <p className="text-sm text-muted-foreground">{t('empty_filter')}</p>
        : (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-card" data-testid="task-list">
            {visible.map(task => {
              const style = STATUS_STYLE[task.status]
              const Icon = style.icon
              const href = task.status === 'draft' ? `${base}/opportunities?draft=${encodeURIComponent(task.id)}` : `${base}/work-items/${task.id}/versions`
              const updated = task.updatedAt ? format.dateTime(new Date(task.updatedAt), { dateStyle: 'medium' }) : null
              return (
                <li key={task.id}>
                  <Link href={href} className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-neutral-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-foreground">{task.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {task.versionNumber === null ? t('not_submitted') : t('version', { number: task.versionNumber })}
                        {updated ? ` · ${t('updated', { date: updated })}` : ''}
                      </span>
                    </span>
                    <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold', style.className)}>
                      <Icon aria-hidden="true" className="size-3.5" />{t(`status.${task.status}`)}
                    </span>
                    <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      {limited && <p className="text-xs text-muted-foreground">{t('limit', { count: tasks.length })}</p>}
    </div>
  )
}
